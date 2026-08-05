//! The interactive terminal UI. Port of the TypeScript TUI's `index.tsx`.

mod selection;
mod ui;

use std::io::{Stdout, stdout};

use anyhow::Result;
use crossterm::event::{
    DisableMouseCapture, EnableMouseCapture, Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers,
    KeyboardEnhancementFlags, MouseButton, MouseEventKind, PopKeyboardEnhancementFlags,
    PushKeyboardEnhancementFlags,
};
use crossterm::execute;
use crossterm::terminal::{
    EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode,
    supports_keyboard_enhancement,
};
use futures_util::StreamExt;
use ratatui::Terminal;
use ratatui::backend::CrosstermBackend;
use ratatui::layout::Rect;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio::time::{Duration, interval};

use crate::api::{BiziApi, TaskRunLogsStreamMessage};
use crate::cli::CliOptions;
use crate::keyboard::{
    IS_MACOS, is_jump_parents_backward_shortcut, is_jump_parents_forward_shortcut,
};
use crate::logs::resolve_task_log_color;
use crate::model::{
    DisplayTaskStatus, LogMode, TaskMap, TaskRow, TaskRunLogLine, TaskRunStatus, TaskRunTreeNode,
    TaskTreeNode,
};
use crate::task_runs::{
    DisplayStatusByTaskKey, RunByTaskKey, build_display_status_by_task_key, can_cancel_run,
    index_runs_by_task_key, upsert_run_tree_node,
};
use crate::task_structure::{
    build_task_tree, find_next_parent_task_index, find_previous_parent_task_index,
    flatten_task_rows, get_direct_child_task_keys,
};

use selection::Selection;

const REFRESH_RUNS_MS: u64 = 1200;
const CLOCK_TICK_MS: u64 = 250;
const COPY_TOAST_MS: u64 = 2000;

type Backend = CrosstermBackend<Stdout>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Pane {
    Tasks,
    Logs,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunAction {
    Run,
    Restart,
}

impl RunAction {
    fn label(self) -> &'static str {
        match self {
            RunAction::Run => "run",
            RunAction::Restart => "restart",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum QuitAction {
    CancelAll,
    ExitWithoutCancelling,
}

const QUIT_ACTIONS: [(&str, QuitAction); 2] = [
    ("Cancel All [y/q]", QuitAction::CancelAll),
    (
        "Exit without cancelling [n]",
        QuitAction::ExitWithoutCancelling,
    ),
];

pub struct RunningTaskRow {
    pub key: String,
    pub status: TaskRunStatus,
}

pub enum AppEvent {
    Term(Event),
    ClockTick,
    RefreshTick,
    TasksLoaded(Option<TaskMap>),
    RunsLoaded(Option<Vec<TaskRunTreeNode>>),
    RootRunUpdated(TaskRunTreeNode),
    SelectedRunPing,
    Logs(u64, TaskRunLogsStreamMessage),
    ToastExpired(u64),
    Quit,
}

pub struct App {
    api: BiziApi,
    cwd: String,
    events: mpsc::Sender<AppEvent>,

    tasks: TaskMap,
    task_runs: Vec<TaskRunTreeNode>,
    task_tree: Vec<TaskTreeNode>,
    task_rows: Vec<TaskRow>,
    run_by_task_key: RunByTaskKey,
    display_status_by_task_key: DisplayStatusByTaskKey,

    selected_index: usize,
    logs: Vec<TaskRunLogLine>,
    log_mode: LogMode,
    focused_pane: Pane,

    task_search_query: String,
    is_task_search_focused: bool,
    show_task_search_error: bool,

    show_quit_confirmation: bool,
    quit_action_index: usize,
    is_cancelling_before_exit: bool,

    error_message: Option<String>,
    copy_toast_message: Option<String>,
    copy_toast_generation: u64,

    // View state owned by the renderer but read back for input handling.
    task_scroll: usize,
    log_scroll: usize,
    log_follow: bool,
    log_viewport_height: usize,
    log_area: Rect,
    task_area: Rect,
    /// One `char` per terminal column for each rendered log row. ratatui resets
    /// its back buffer right after `draw`, so the copy path keeps its own copy
    /// of what the log view laid out.
    rendered_log_rows: Vec<Vec<char>>,
    selection: Option<Selection>,

    // Websocket bookkeeping.
    root_runs_key: String,
    root_run_handles: Vec<JoinHandle<()>>,
    log_subscription_key: Option<(String, bool)>,
    log_generation: u64,
    log_handles: Vec<JoinHandle<()>>,
    last_selected_run_status: Option<TaskRunStatus>,

    should_quit: bool,
}

impl App {
    fn new(api: BiziApi, cwd: String, events: mpsc::Sender<AppEvent>) -> Self {
        Self {
            api,
            cwd,
            events,
            tasks: TaskMap::new(),
            task_runs: Vec::new(),
            task_tree: Vec::new(),
            task_rows: Vec::new(),
            run_by_task_key: RunByTaskKey::new(),
            display_status_by_task_key: DisplayStatusByTaskKey::new(),
            selected_index: 0,
            logs: Vec::new(),
            log_mode: LogMode::Aggregate,
            focused_pane: Pane::Tasks,
            task_search_query: String::new(),
            is_task_search_focused: false,
            show_task_search_error: false,
            show_quit_confirmation: false,
            quit_action_index: 0,
            is_cancelling_before_exit: false,
            error_message: None,
            copy_toast_message: None,
            copy_toast_generation: 0,
            task_scroll: 0,
            log_scroll: 0,
            log_follow: true,
            log_viewport_height: 20,
            log_area: Rect::default(),
            task_area: Rect::default(),
            rendered_log_rows: Vec::new(),
            selection: None,
            root_runs_key: String::new(),
            root_run_handles: Vec::new(),
            log_subscription_key: None,
            log_generation: 0,
            log_handles: Vec::new(),
            last_selected_run_status: None,
            should_quit: false,
        }
    }

    // ---------------------------------------------------------------- derived

    fn rebuild_task_indexes(&mut self) {
        self.task_tree = build_task_tree(&self.tasks);
        self.task_rows = flatten_task_rows(&self.task_tree);
        self.run_by_task_key = index_runs_by_task_key(&self.task_runs);
        self.display_status_by_task_key =
            build_display_status_by_task_key(&self.tasks, &self.run_by_task_key);

        if self.task_rows.is_empty() {
            self.selected_index = 0;
        } else if self.selected_index >= self.task_rows.len() {
            self.selected_index = self.task_rows.len() - 1;
        }
    }

    fn selected_row(&self) -> Option<&TaskRow> {
        self.task_rows.get(self.selected_index)
    }

    fn selected_run(&self) -> Option<&TaskRunTreeNode> {
        let row = self.selected_row()?;
        self.run_by_task_key.get(&row.key)
    }

    fn selected_display_status(&self) -> Option<DisplayTaskStatus> {
        let row = self.selected_row()?;
        self.display_status_by_task_key
            .get(&row.key)
            .copied()
            .flatten()
    }

    fn selected_is_subtask(&self) -> bool {
        self.selected_row()
            .map(|row| row.depth > 0)
            .unwrap_or(false)
    }

    fn selected_command(&self) -> Option<&str> {
        let row = self.selected_row()?;
        self.tasks.get(&row.key)?.command.as_deref()
    }

    fn selected_has_children(&self) -> bool {
        let Some(row) = self.selected_row() else {
            return false;
        };
        !get_direct_child_task_keys(&self.tasks, &row.key).is_empty()
    }

    fn selected_has_command(&self) -> bool {
        self.selected_command().is_some()
    }

    fn selected_run_action(&self) -> RunAction {
        if self.selected_is_subtask() {
            return RunAction::Restart;
        }
        if self.selected_run().is_none() {
            return RunAction::Run;
        }
        match self.selected_display_status() {
            Some(DisplayTaskStatus::Run(TaskRunStatus::Success))
            | Some(DisplayTaskStatus::Run(TaskRunStatus::Failed)) => RunAction::Run,
            _ => RunAction::Restart,
        }
    }

    fn selected_footer_status(&self) -> Option<TaskRunStatus> {
        if self.selected_has_children() && !self.selected_has_command() {
            return match self.selected_display_status() {
                Some(DisplayTaskStatus::Run(status)) => Some(status),
                _ => None,
            };
        }
        self.selected_run().map(|run| run.status)
    }

    fn can_toggle_log_mode(&self) -> bool {
        self.selected_has_children() && self.selected_has_command()
    }

    fn selected_uses_aggregate_logs(&self) -> bool {
        if !self.selected_has_children() {
            return false;
        }
        if !self.selected_has_command() {
            return true;
        }
        self.log_mode == LogMode::Aggregate
    }

    fn can_cancel_selected(&self) -> bool {
        self.selected_run().map(can_cancel_run).unwrap_or(false)
    }

    fn running_task_rows(&self) -> Vec<RunningTaskRow> {
        self.task_rows
            .iter()
            .filter_map(|row| {
                let status = self.run_by_task_key.get(&row.key)?.status;
                if status.is_active() {
                    Some(RunningTaskRow {
                        key: row.key.clone(),
                        status,
                    })
                } else {
                    None
                }
            })
            .collect()
    }

    fn has_running_tasks(&self) -> bool {
        self.task_rows.iter().any(|row| {
            self.run_by_task_key
                .get(&row.key)
                .map(|run| run.status.is_active())
                .unwrap_or(false)
        })
    }

    fn log_task_tag_width(&self) -> usize {
        let longest = self
            .logs
            .iter()
            .map(|line| line.task.chars().count())
            .max()
            .unwrap_or(0);
        (longest + 3).clamp(10, 40)
    }

    fn log_color_for_task(&self, task_key: &str) -> Option<String> {
        resolve_task_log_color(self.tasks.get(task_key)?.color.as_deref())
    }

    fn is_log_view_focused(&self) -> bool {
        self.focused_pane == Pane::Logs
    }

    // ----------------------------------------------------------------- actions

    fn spawn_refresh_tasks(&self) {
        let api = self.api.clone();
        let cwd = self.cwd.clone();
        let events = self.events.clone();
        tokio::spawn(async move {
            let result = api.list_tasks(&cwd).await.ok();
            let _ = events.send(AppEvent::TasksLoaded(result)).await;
        });
    }

    fn spawn_refresh_runs(&self) {
        let api = self.api.clone();
        let cwd = self.cwd.clone();
        let events = self.events.clone();
        tokio::spawn(async move {
            let result = api.list_task_runs(&cwd).await.ok();
            let _ = events.send(AppEvent::RunsLoaded(result)).await;
        });
    }

    fn run_task_by_key(&self, task_key: String) {
        let api = self.api.clone();
        let cwd = self.cwd.clone();
        let events = self.events.clone();
        tokio::spawn(async move {
            let _ = api.run_task(&task_key, &cwd, None).await;
            let result = api.list_task_runs(&cwd).await.ok();
            let _ = events.send(AppEvent::RunsLoaded(result)).await;
        });
    }

    fn restart_run_by_id(&mut self, run_id: String) {
        self.logs.clear();
        let api = self.api.clone();
        let cwd = self.cwd.clone();
        let events = self.events.clone();
        tokio::spawn(async move {
            let _ = api.restart_task(&run_id).await;
            let result = api.list_task_runs(&cwd).await.ok();
            let _ = events.send(AppEvent::RunsLoaded(result)).await;
        });
    }

    fn cancel_selected_run(&self) {
        let Some(run) = self.selected_run() else {
            return;
        };
        if !can_cancel_run(run) {
            return;
        }
        let run_id = run.id.clone();
        let api = self.api.clone();
        let cwd = self.cwd.clone();
        let events = self.events.clone();
        tokio::spawn(async move {
            let _ = api.cancel_task(&run_id).await;
            let result = api.list_task_runs(&cwd).await.ok();
            let _ = events.send(AppEvent::RunsLoaded(result)).await;
        });
    }

    fn cancel_running_tasks_before_exit(&mut self) {
        if self.is_cancelling_before_exit {
            return;
        }
        self.is_cancelling_before_exit = true;

        let run_ids: Vec<String> = self
            .running_task_rows()
            .iter()
            .filter_map(|row| self.run_by_task_key.get(&row.key).map(|run| run.id.clone()))
            .collect();

        let api = self.api.clone();
        let events = self.events.clone();
        tokio::spawn(async move {
            futures_util::future::join_all(run_ids.iter().map(|run_id| api.cancel_task(run_id)))
                .await;
            let _ = events.send(AppEvent::Quit).await;
        });
    }

    fn show_copy_toast(&mut self, message: String) {
        self.copy_toast_message = Some(message);
        self.copy_toast_generation += 1;
        let generation = self.copy_toast_generation;
        let events = self.events.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(COPY_TOAST_MS)).await;
            let _ = events.send(AppEvent::ToastExpired(generation)).await;
        });
    }

    // ----------------------------------------------------------- subscriptions

    fn sync_subscriptions(&mut self) {
        self.sync_root_run_subscriptions();
        self.sync_log_subscription();
    }

    fn sync_root_run_subscriptions(&mut self) {
        let mut run_ids: Vec<String> = self.task_runs.iter().map(|run| run.id.clone()).collect();
        run_ids.sort();
        let key = run_ids.join("|");
        if key == self.root_runs_key {
            return;
        }
        self.root_runs_key = key;

        for handle in self.root_run_handles.drain(..) {
            handle.abort();
        }

        for run_id in run_ids {
            let api = self.api.clone();
            let events = self.events.clone();
            self.root_run_handles.push(tokio::spawn(async move {
                api.stream_task_run(&run_id, events, AppEvent::RootRunUpdated)
                    .await;
            }));
        }
    }

    /// Resubscribes the log stream when the selected run changes, when the log
    /// mode flips, or when the run starts a fresh execution (restart), which is
    /// when the server has a new snapshot for us.
    fn sync_log_subscription(&mut self) {
        let selected_run = self.selected_run().map(|run| (run.id.clone(), run.status));
        let Some((run_id, status)) = selected_run else {
            if self.log_subscription_key.is_some() {
                self.log_subscription_key = None;
                self.last_selected_run_status = None;
                for handle in self.log_handles.drain(..) {
                    handle.abort();
                }
                self.logs.clear();
            }
            return;
        };

        let include_children = self.selected_uses_aggregate_logs();
        let key = (run_id.clone(), include_children);
        let restarted = self
            .last_selected_run_status
            .map(|previous| previous.is_terminal() && status.is_active())
            .unwrap_or(false);

        if Some(&key) == self.log_subscription_key.as_ref() && !restarted {
            self.last_selected_run_status = Some(status);
            return;
        }

        self.log_subscription_key = Some(key);
        self.last_selected_run_status = Some(status);
        self.log_generation += 1;
        let generation = self.log_generation;

        for handle in self.log_handles.drain(..) {
            handle.abort();
        }

        self.log_follow = true;

        let api = self.api.clone();
        let events = self.events.clone();
        let logs_run_id = run_id.clone();
        self.log_handles.push(tokio::spawn(async move {
            api.stream_task_logs(&logs_run_id, include_children, events, move |message| {
                AppEvent::Logs(generation, message)
            })
            .await;
        }));

        let api = self.api.clone();
        let events = self.events.clone();
        self.log_handles.push(tokio::spawn(async move {
            api.stream_task_run(&run_id, events, |_| AppEvent::SelectedRunPing)
                .await;
        }));
    }

    // ------------------------------------------------------------------ events

    async fn handle_event(&mut self, event: AppEvent) {
        match event {
            AppEvent::Term(Event::Key(key)) => self.handle_key(key),
            AppEvent::Term(Event::Mouse(mouse)) => self.handle_mouse(mouse),
            AppEvent::Term(_) => {}
            AppEvent::ClockTick => {}
            AppEvent::RefreshTick => {
                self.spawn_refresh_runs();
                if self.tasks.is_empty() {
                    self.spawn_refresh_tasks();
                }
            }
            AppEvent::TasksLoaded(result) => match result {
                Some(tasks) => {
                    self.error_message = None;
                    self.tasks = tasks;
                    self.rebuild_task_indexes();
                }
                None => self.error_message = Some("failed to load tasks".to_string()),
            },
            AppEvent::RunsLoaded(result) => match result {
                Some(task_runs) => {
                    self.error_message = None;
                    self.task_runs = task_runs;
                    self.rebuild_task_indexes();
                }
                None => self.error_message = Some("failed to load task runs".to_string()),
            },
            AppEvent::RootRunUpdated(run) => {
                upsert_run_tree_node(&mut self.task_runs, run);
                self.rebuild_task_indexes();
            }
            AppEvent::SelectedRunPing => self.spawn_refresh_runs(),
            AppEvent::Logs(generation, message) => {
                if generation != self.log_generation {
                    return;
                }
                match message {
                    TaskRunLogsStreamMessage::Snapshot { logs, .. } => self.logs = logs,
                    TaskRunLogsStreamMessage::Log { log } => self.logs.push(log),
                    TaskRunLogsStreamMessage::Error { message } => {
                        self.error_message = Some(message)
                    }
                }
            }
            AppEvent::ToastExpired(generation) => {
                if generation == self.copy_toast_generation {
                    self.copy_toast_message = None;
                }
            }
            AppEvent::Quit => self.should_quit = true,
        }
    }

    // -------------------------------------------------------------- key input

    fn handle_key(&mut self, key: KeyEvent) {
        if key.kind != KeyEventKind::Press {
            return;
        }

        if self.show_quit_confirmation {
            self.handle_quit_confirmation_keys(key);
            return;
        }
        if self.handle_copy_selection_key(key) {
            return;
        }
        if is_quit_key(key) {
            self.request_quit();
            return;
        }
        if self.handle_task_search_shortcut(key) {
            return;
        }
        if self.is_task_search_focused {
            self.handle_task_search_input_keys(key);
            return;
        }
        if self.handle_pane_navigation(key) {
            return;
        }
        if self.task_rows.is_empty() {
            return;
        }
        if self.handle_task_navigation(key) {
            return;
        }
        self.handle_action_keys(key);
    }

    fn handle_quit_confirmation_keys(&mut self, key: KeyEvent) {
        if self.is_cancelling_before_exit {
            return;
        }

        match key.code {
            KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                self.confirm_quit(QuitAction::CancelAll)
            }
            KeyCode::Char('y') | KeyCode::Char('q') => self.confirm_quit(QuitAction::CancelAll),
            KeyCode::Char('n') => self.confirm_quit(QuitAction::ExitWithoutCancelling),
            KeyCode::Left | KeyCode::Char('[') => {
                self.quit_action_index = if self.quit_action_index == 0 {
                    QUIT_ACTIONS.len() - 1
                } else {
                    self.quit_action_index - 1
                };
            }
            KeyCode::Right | KeyCode::Char(']') => {
                self.quit_action_index = (self.quit_action_index + 1) % QUIT_ACTIONS.len();
            }
            KeyCode::Enter => {
                let action = QUIT_ACTIONS[self.quit_action_index].1;
                self.confirm_quit(action);
            }
            _ => {}
        }
    }

    fn confirm_quit(&mut self, action: QuitAction) {
        match action {
            QuitAction::CancelAll => self.cancel_running_tasks_before_exit(),
            QuitAction::ExitWithoutCancelling => self.should_quit = true,
        }
    }

    fn request_quit(&mut self) {
        if self.has_running_tasks() {
            self.show_quit_confirmation = true;
            self.quit_action_index = 0;
            return;
        }
        self.should_quit = true;
    }

    fn handle_copy_selection_key(&mut self, key: KeyEvent) -> bool {
        if key.code != KeyCode::Char('c') {
            return false;
        }
        // Ctrl covers every platform. Super/Alt covers the terminals that
        // forward Cmd+C (Kitty, Ghostty, WezTerm with the kitty protocol).
        if !(key.modifiers.contains(KeyModifiers::CONTROL)
            || key.modifiers.contains(KeyModifiers::SUPER)
            || key.modifiers.contains(KeyModifiers::META))
        {
            return false;
        }
        self.copy_selection_to_clipboard()
    }

    fn copy_selection_to_clipboard(&mut self) -> bool {
        let Some(active_selection) = self.selection.clone() else {
            return false;
        };
        let text =
            selection::selected_text(&self.rendered_log_rows, self.log_area, &active_selection);
        if text.is_empty() {
            return false;
        }

        let copied = selection::copy_to_clipboard(&text);
        let line_count = text.lines().count().max(1);
        let lines_label = if line_count == 1 {
            "1 line".to_string()
        } else {
            format!("{line_count} lines")
        };
        self.show_copy_toast(if copied {
            format!("Copied {lines_label} to clipboard")
        } else {
            "Copy failed (no clipboard available)".to_string()
        });
        self.selection = None;
        true
    }

    fn handle_task_search_shortcut(&mut self, key: KeyEvent) -> bool {
        if key.code != KeyCode::Char('/') || self.is_task_search_focused {
            return false;
        }
        self.focus_task_search();
        true
    }

    fn focus_task_search(&mut self) {
        self.focused_pane = Pane::Tasks;
        self.is_task_search_focused = true;
    }

    fn clear_task_search(&mut self) {
        self.task_search_query.clear();
        self.show_task_search_error = false;
        self.is_task_search_focused = false;
    }

    fn handle_task_search_input_keys(&mut self, key: KeyEvent) {
        match key.code {
            // Matches the TypeScript TUI: down (and the vim-style `j`) leaves
            // the search box and drops into the task list.
            KeyCode::Down | KeyCode::Char('j') => {
                if !self.task_rows.is_empty() {
                    self.selected_index = 0;
                    self.is_task_search_focused = false;
                    self.focused_pane = Pane::Tasks;
                }
            }
            KeyCode::Char('/') => {}
            KeyCode::Esc => self.clear_task_search(),
            KeyCode::Enter => self.handle_task_search_submit(),
            KeyCode::Backspace => {
                self.task_search_query.pop();
                self.show_task_search_error = false;
            }
            KeyCode::Char(character) if !key.modifiers.contains(KeyModifiers::CONTROL) => {
                self.task_search_query.push(character);
                self.show_task_search_error = false;
            }
            _ => {}
        }
    }

    fn handle_task_search_submit(&mut self) {
        let exact_query = self.task_search_query.trim().to_string();
        if exact_query.is_empty() {
            self.show_task_search_error = false;
            return;
        }

        let Some(row_index) = self.task_rows.iter().position(|row| row.key == exact_query) else {
            self.show_task_search_error = true;
            return;
        };

        self.show_task_search_error = false;
        self.run_exact_task_search_match(row_index);
    }

    fn run_exact_task_search_match(&mut self, row_index: usize) {
        let Some(row) = self.task_rows.get(row_index).cloned() else {
            return;
        };
        self.selected_index = row_index;

        if self.resolve_row_action(&row.key, row.depth) == RunAction::Run {
            self.run_task_by_key(row.key);
            self.clear_task_search();
            return;
        }

        if let Some(run_id) = self.run_by_task_key.get(&row.key).map(|run| run.id.clone()) {
            self.restart_run_by_id(run_id);
            self.clear_task_search();
            return;
        }

        self.error_message = Some(
            if row.depth > 0 {
                "Cannot restart subtask without an existing parent-linked run."
            } else {
                "Cannot restart task because no existing run was found."
            }
            .to_string(),
        );
    }

    fn resolve_row_action(&self, task_key: &str, depth: usize) -> RunAction {
        if depth > 0 {
            return RunAction::Restart;
        }
        if !self.run_by_task_key.contains_key(task_key) {
            return RunAction::Run;
        }
        match self
            .display_status_by_task_key
            .get(task_key)
            .copied()
            .flatten()
        {
            Some(DisplayTaskStatus::Run(TaskRunStatus::Success))
            | Some(DisplayTaskStatus::Run(TaskRunStatus::Failed)) => RunAction::Run,
            _ => RunAction::Restart,
        }
    }

    fn handle_pane_navigation(&mut self, key: KeyEvent) -> bool {
        let is_right = matches!(key.code, KeyCode::Right | KeyCode::Char('l'));
        let is_left = matches!(key.code, KeyCode::Left | KeyCode::Char('h'));

        if is_right && !self.is_log_view_focused() {
            self.focused_pane = Pane::Logs;
            return true;
        }
        if is_left && self.is_log_view_focused() {
            self.focused_pane = Pane::Tasks;
            return true;
        }
        false
    }

    fn handle_task_navigation(&mut self, key: KeyEvent) -> bool {
        if self.is_log_view_focused() {
            return self.handle_log_scroll_keys(key);
        }

        if is_jump_parents_backward_shortcut(&key, IS_MACOS) {
            self.selected_index =
                find_previous_parent_task_index(&self.task_rows, self.selected_index);
            return true;
        }
        if matches!(key.code, KeyCode::Up | KeyCode::Char('k')) {
            if self.selected_index == 0 {
                self.focus_task_search();
                return true;
            }
            self.selected_index -= 1;
            return true;
        }
        if is_jump_parents_forward_shortcut(&key, IS_MACOS) {
            self.selected_index = find_next_parent_task_index(&self.task_rows, self.selected_index);
            return true;
        }
        if matches!(key.code, KeyCode::Down | KeyCode::Char('j')) {
            self.selected_index = (self.selected_index + 1).min(self.task_rows.len() - 1);
            return true;
        }
        false
    }

    fn handle_log_scroll_keys(&mut self, key: KeyEvent) -> bool {
        let viewport = self.log_viewport_height.max(1);
        match key.code {
            KeyCode::Up | KeyCode::Char('k') => {
                self.scroll_logs_by(-1);
                true
            }
            KeyCode::Down | KeyCode::Char('j') => {
                self.scroll_logs_by(1);
                true
            }
            KeyCode::PageUp => {
                self.scroll_logs_by(-(viewport as isize));
                true
            }
            KeyCode::PageDown => {
                self.scroll_logs_by(viewport as isize);
                true
            }
            KeyCode::Home => {
                self.log_follow = false;
                self.log_scroll = 0;
                true
            }
            KeyCode::End => {
                self.log_follow = true;
                true
            }
            _ => false,
        }
    }

    fn scroll_logs_by(&mut self, delta: isize) {
        let max_scroll = self
            .logs
            .len()
            .saturating_sub(self.log_viewport_height.max(1));
        let current = if self.log_follow {
            max_scroll
        } else {
            self.log_scroll.min(max_scroll)
        };
        let next = (current as isize + delta).clamp(0, max_scroll as isize) as usize;
        self.log_scroll = next;
        self.log_follow = next >= max_scroll;
    }

    fn handle_action_keys(&mut self, key: KeyEvent) -> bool {
        match key.code {
            KeyCode::Char('m') => {
                if self.can_toggle_log_mode() {
                    self.log_mode = match self.log_mode {
                        LogMode::Aggregate => LogMode::Selected,
                        LogMode::Selected => LogMode::Aggregate,
                    };
                }
                true
            }
            KeyCode::Char('r') => {
                if self.selected_run_action() == RunAction::Restart {
                    if let Some(run_id) = self.selected_run().map(|run| run.id.clone()) {
                        self.restart_run_by_id(run_id);
                    }
                } else if let Some(task_key) = self.selected_row().map(|row| row.key.clone()) {
                    self.run_task_by_key(task_key);
                }
                true
            }
            KeyCode::Char('c') => {
                self.cancel_selected_run();
                true
            }
            _ => false,
        }
    }

    // ------------------------------------------------------------ mouse input

    fn handle_mouse(&mut self, mouse: crossterm::event::MouseEvent) {
        let position = (mouse.column, mouse.row);
        match mouse.kind {
            MouseEventKind::Down(MouseButton::Left) => {
                self.selection = None;
                if selection::contains(self.log_area, position) {
                    self.selection = Some(Selection::new(self.log_area, position));
                }
            }
            MouseEventKind::Drag(MouseButton::Left) => {
                if let Some(active_selection) = self.selection.as_mut() {
                    active_selection.extend_to(position);
                }
            }
            MouseEventKind::ScrollUp => {
                if selection::contains(self.log_area, position) {
                    self.scroll_logs_by(-3);
                } else if selection::contains(self.task_area, position) {
                    self.task_scroll = self.task_scroll.saturating_sub(3);
                }
            }
            MouseEventKind::ScrollDown => {
                if selection::contains(self.log_area, position) {
                    self.scroll_logs_by(3);
                } else if selection::contains(self.task_area, position) {
                    self.task_scroll += 3;
                }
            }
            _ => {}
        }
    }
}

fn is_quit_key(key: KeyEvent) -> bool {
    match key.code {
        KeyCode::Char('q') => true,
        KeyCode::Char('c') => key.modifiers.contains(KeyModifiers::CONTROL),
        _ => false,
    }
}

pub async fn run_tui(options: CliOptions) -> Result<()> {
    let (tx, mut rx) = mpsc::channel::<AppEvent>(4096);
    let mut app = App::new(BiziApi::new(), options.cwd.clone(), tx.clone());

    let (mut terminal, keyboard_enhanced) = setup_terminal()?;

    app.spawn_refresh_tasks();
    app.spawn_refresh_runs();

    let forwarders = spawn_background_tasks(tx.clone());

    let result = event_loop(&mut app, &mut terminal, &mut rx).await;

    for handle in forwarders {
        handle.abort();
    }
    for handle in app.root_run_handles.drain(..) {
        handle.abort();
    }
    for handle in app.log_handles.drain(..) {
        handle.abort();
    }

    restore_terminal(&mut terminal, keyboard_enhanced)?;
    result
}

async fn event_loop(
    app: &mut App,
    terminal: &mut Terminal<Backend>,
    rx: &mut mpsc::Receiver<AppEvent>,
) -> Result<()> {
    loop {
        terminal.draw(|frame| ui::render(frame, app))?;

        let Some(event) = rx.recv().await else {
            break;
        };
        app.handle_event(event).await;

        // Coalesce bursts (log floods, websocket storms) into a single redraw.
        while !app.should_quit {
            match rx.try_recv() {
                Ok(event) => app.handle_event(event).await,
                Err(_) => break,
            }
        }

        if app.should_quit {
            break;
        }
        app.sync_subscriptions();
    }

    Ok(())
}

fn spawn_background_tasks(tx: mpsc::Sender<AppEvent>) -> Vec<JoinHandle<()>> {
    let mut handles = Vec::new();

    handles.push(tokio::spawn({
        let tx = tx.clone();
        async move {
            let mut reader = crossterm::event::EventStream::new();
            while let Some(Ok(event)) = reader.next().await {
                if tx.send(AppEvent::Term(event)).await.is_err() {
                    break;
                }
            }
        }
    }));

    handles.push(tokio::spawn({
        let tx = tx.clone();
        async move {
            let mut ticker = interval(Duration::from_millis(CLOCK_TICK_MS));
            loop {
                ticker.tick().await;
                if tx.send(AppEvent::ClockTick).await.is_err() {
                    break;
                }
            }
        }
    }));

    handles.push(tokio::spawn(async move {
        let mut ticker = interval(Duration::from_millis(REFRESH_RUNS_MS));
        loop {
            ticker.tick().await;
            if tx.send(AppEvent::RefreshTick).await.is_err() {
                break;
            }
        }
    }));

    handles
}

fn setup_terminal() -> Result<(Terminal<Backend>, bool)> {
    enable_raw_mode()?;
    let mut out = stdout();
    execute!(out, EnterAlternateScreen, EnableMouseCapture)?;

    // Ask for the kitty keyboard protocol. Without it Cmd+C never reaches us at
    // all — the terminal keeps it for its own copy binding — and Cmd+C is what
    // people actually press on macOS. opentui negotiated this for the
    // TypeScript TUI, which is why its `key.super` branch was ever reachable.
    let keyboard_enhanced = supports_keyboard_enhancement().unwrap_or(false);
    if keyboard_enhanced {
        let _ = execute!(
            out,
            PushKeyboardEnhancementFlags(KeyboardEnhancementFlags::DISAMBIGUATE_ESCAPE_CODES)
        );
    }

    let terminal = Terminal::new(CrosstermBackend::new(out))?;
    Ok((terminal, keyboard_enhanced))
}

fn restore_terminal(terminal: &mut Terminal<Backend>, keyboard_enhanced: bool) -> Result<()> {
    disable_raw_mode()?;
    if keyboard_enhanced {
        let _ = execute!(terminal.backend_mut(), PopKeyboardEnhancementFlags);
    }
    execute!(
        terminal.backend_mut(),
        LeaveAlternateScreen,
        DisableMouseCapture
    )?;
    terminal.show_cursor()?;
    Ok(())
}
