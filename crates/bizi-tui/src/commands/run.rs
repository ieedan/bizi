//! Port of the TypeScript TUI's `commands/run.ts`.
//!
//! Starts (or attaches to) a task run, mirrors its aggregated logs to
//! stdout/stderr and exits with a code derived from the final run status.

use std::collections::HashSet;
use std::io::Write;

use anyhow::{Result, anyhow};
use tokio::sync::mpsc;
use tokio::time::{Duration, sleep};

use crate::api::{BiziApi, TaskRunLogsStreamMessage};
use crate::cli_task_runs::find_active_run_by_task_key;
use crate::model::{TaskRunLogLine, TaskRunTreeNode};
use crate::prompt::{self, PromptResult};

const SIGNAL_EXIT_CODE: i32 = 130;
const CANCEL_FALLBACK_MS: u64 = 3000;
const STATUS_POLL_MS: u64 = 500;
const SETTLE_ATTEMPTS: usize = 4;
const SETTLE_DELAY_MS: u64 = 180;

enum RunEvent {
    Log(TaskRunLogsStreamMessage),
    RunUpdate(TaskRunTreeNode),
    PollTick,
    Signal,
    CancelFallback,
}

struct RunSession<'a> {
    api: &'a BiziApi,
    run_id: String,
    seen_log_keys: HashSet<(String, u64)>,
    signal_exit_code: Option<i32>,
}

pub async fn run_command(
    api: &BiziApi,
    cwd: &str,
    task: &str,
    non_interactive: bool,
) -> Result<i32> {
    let interactive = prompt::is_interactive() && !non_interactive;

    let before_task_runs = api.list_task_runs(cwd).await?;
    let active_before_run_id =
        find_active_run_by_task_key(&before_task_runs, task).map(|run| run.id.clone());

    let run_id = api
        .run_task(task, cwd, None)
        .await
        .map_err(|_| anyhow!("failed to start task \"{task}\""))?;
    let started_by_session = active_before_run_id.as_deref() != Some(run_id.as_str());

    let (tx, mut rx) = mpsc::channel::<RunEvent>(1024);
    let mut tasks = Vec::new();

    tasks.push(tokio::spawn({
        let api = api.clone();
        let run_id = run_id.clone();
        let tx = tx.clone();
        async move {
            api.stream_task_logs(&run_id, true, tx, RunEvent::Log).await;
        }
    }));

    tasks.push(tokio::spawn({
        let api = api.clone();
        let run_id = run_id.clone();
        let tx = tx.clone();
        async move {
            api.stream_task_run(&run_id, tx, RunEvent::RunUpdate).await;
        }
    }));

    tasks.push(tokio::spawn({
        let tx = tx.clone();
        async move {
            loop {
                sleep(Duration::from_millis(STATUS_POLL_MS)).await;
                if tx.send(RunEvent::PollTick).await.is_err() {
                    break;
                }
            }
        }
    }));

    tasks.push(tokio::spawn({
        let tx = tx.clone();
        async move { forward_signals(tx).await }
    }));

    let mut session = RunSession {
        api,
        run_id: run_id.clone(),
        seen_log_keys: HashSet::new(),
        signal_exit_code: None,
    };

    let mut exit_code: Option<i32> = None;

    while let Some(event) = rx.recv().await {
        match event {
            RunEvent::Log(message) => match message {
                TaskRunLogsStreamMessage::Snapshot { logs, .. } => {
                    for line in logs {
                        session.emit_log(&line);
                    }
                }
                TaskRunLogsStreamMessage::Log { log } => session.emit_log(&log),
                TaskRunLogsStreamMessage::Error { message } => eprintln!("{message}"),
            },
            RunEvent::RunUpdate(snapshot) => {
                if let Some(code) = session.finalize_when_task_tree_settles(snapshot).await {
                    exit_code = Some(code);
                    break;
                }
            }
            RunEvent::PollTick => {
                if let Ok(snapshot) = api.get_task_run(&run_id).await
                    && let Some(code) = session.finalize_when_task_tree_settles(snapshot).await
                {
                    exit_code = Some(code);
                    break;
                }
            }
            RunEvent::Signal => {
                // Once a cancellation is in flight further signals are noise.
                if session.signal_exit_code.is_some() {
                    continue;
                }
                if let Some(code) = session
                    .handle_signal(task, interactive, started_by_session, tx.clone())
                    .await
                {
                    exit_code = Some(code);
                    break;
                }
            }
            RunEvent::CancelFallback => {
                exit_code = Some(SIGNAL_EXIT_CODE);
                break;
            }
        }
    }

    for handle in tasks {
        handle.abort();
    }

    Ok(exit_code.unwrap_or(1))
}

impl RunSession<'_> {
    fn emit_log(&mut self, log: &TaskRunLogLine) {
        if !self
            .seen_log_keys
            .insert((log.run_id.clone(), log.sequence))
        {
            return;
        }
        print_task_log_line(log);
    }

    /// Waits for the whole run tree to reach a terminal state, flushes any logs
    /// that landed in storage after the last websocket frame and returns the
    /// process exit code.
    async fn finalize_when_task_tree_settles(&mut self, snapshot: TaskRunTreeNode) -> Option<i32> {
        if !snapshot.status.is_terminal() {
            return None;
        }

        let settled_snapshot = self.wait_for_terminal_task_tree_to_settle(snapshot).await?;
        self.flush_run_logs_with_retries().await;
        Some(
            self.signal_exit_code
                .unwrap_or_else(|| settled_snapshot.status.exit_code()),
        )
    }

    async fn wait_for_terminal_task_tree_to_settle(
        &self,
        initial_snapshot: TaskRunTreeNode,
    ) -> Option<TaskRunTreeNode> {
        let mut latest_snapshot = initial_snapshot;
        // Child runs can be created shortly after a parent turns terminal,
        // so re-check the full tree before deciding to exit.
        for attempt in 0..SETTLE_ATTEMPTS {
            if has_active_runs_in_task_tree(&latest_snapshot) {
                return None;
            }
            if attempt == SETTLE_ATTEMPTS - 1 {
                break;
            }
            sleep(Duration::from_millis(SETTLE_DELAY_MS)).await;
            if let Ok(refreshed_snapshot) = self.api.get_task_run(&self.run_id).await {
                latest_snapshot = refreshed_snapshot;
            }
        }

        if has_active_runs_in_task_tree(&latest_snapshot) {
            None
        } else {
            Some(latest_snapshot)
        }
    }

    async fn flush_run_logs_with_retries(&mut self) {
        // Give logs a brief chance to catch up in storage after the task tree settles.
        for attempt in 0..SETTLE_ATTEMPTS {
            if let Ok(logs) = self.api.get_task_run_logs(&self.run_id, true).await {
                for log in logs {
                    self.emit_log(&log);
                }
            }
            if attempt == SETTLE_ATTEMPTS - 1 {
                break;
            }
            sleep(Duration::from_millis(SETTLE_DELAY_MS)).await;
        }
    }

    /// Returns `Some(exit_code)` when the process should exit immediately.
    async fn handle_signal(
        &mut self,
        task: &str,
        interactive: bool,
        started_by_session: bool,
        tx: mpsc::Sender<RunEvent>,
    ) -> Option<i32> {
        if interactive {
            let should_cancel = prompt_cancel_before_exit(task).await;
            if !should_cancel {
                return Some(SIGNAL_EXIT_CODE);
            }
            self.signal_exit_code = Some(SIGNAL_EXIT_CODE);
            let _ = self.api.cancel_task(&self.run_id).await;
            spawn_cancel_fallback(tx);
            return None;
        }

        if started_by_session {
            self.signal_exit_code = Some(SIGNAL_EXIT_CODE);
            let _ = self.api.cancel_task(&self.run_id).await;
            spawn_cancel_fallback(tx);
            return None;
        }

        Some(SIGNAL_EXIT_CODE)
    }
}

fn spawn_cancel_fallback(tx: mpsc::Sender<RunEvent>) {
    tokio::spawn(async move {
        sleep(Duration::from_millis(CANCEL_FALLBACK_MS)).await;
        let _ = tx.send(RunEvent::CancelFallback).await;
    });
}

async fn prompt_cancel_before_exit(task: &str) -> bool {
    let message = format!("Cancel task \"{task}\" before exiting?");
    let answer = tokio::task::spawn_blocking(move || prompt::confirm(&message, true)).await;
    match answer {
        Ok(Ok(PromptResult::Value(value))) => value,
        _ => false,
    }
}

fn print_task_log_line(log: &TaskRunLogLine) {
    let line = if log.line.ends_with('\n') {
        log.line.clone()
    } else {
        format!("{}\n", log.line)
    };

    if log.is_stderr {
        let mut stream = std::io::stderr();
        let _ = stream.write_all(line.as_bytes());
        let _ = stream.flush();
    } else {
        let mut stream = std::io::stdout();
        let _ = stream.write_all(line.as_bytes());
        let _ = stream.flush();
    }
}

fn has_active_runs_in_task_tree(run: &TaskRunTreeNode) -> bool {
    if run.status.is_active() {
        return true;
    }
    run.children.iter().any(has_active_runs_in_task_tree)
}

#[cfg(unix)]
async fn forward_signals(tx: mpsc::Sender<RunEvent>) {
    use tokio::signal::unix::{SignalKind, signal};

    let Ok(mut interrupt) = signal(SignalKind::interrupt()) else {
        return;
    };
    let Ok(mut terminate) = signal(SignalKind::terminate()) else {
        return;
    };

    loop {
        let received = tokio::select! {
            value = interrupt.recv() => value,
            value = terminate.recv() => value,
        };
        if received.is_none() {
            break;
        }
        if tx.send(RunEvent::Signal).await.is_err() {
            break;
        }
    }
}

#[cfg(not(unix))]
async fn forward_signals(tx: mpsc::Sender<RunEvent>) {
    while tokio::signal::ctrl_c().await.is_ok() {
        if tx.send(RunEvent::Signal).await.is_err() {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::TaskRunStatus;

    fn run(status: TaskRunStatus, children: Vec<TaskRunTreeNode>) -> TaskRunTreeNode {
        TaskRunTreeNode {
            id: "run".to_string(),
            task: "dev".to_string(),
            cwd: "/tmp".to_string(),
            parent_run_id: None,
            status,
            updated_at: 0,
            waiting_on: None,
            children,
        }
    }

    #[test]
    fn detects_active_children_under_a_terminal_parent() {
        let tree = run(
            TaskRunStatus::Success,
            vec![run(TaskRunStatus::Running, Vec::new())],
        );
        assert!(has_active_runs_in_task_tree(&tree));

        let settled = run(
            TaskRunStatus::Success,
            vec![run(TaskRunStatus::Success, Vec::new())],
        );
        assert!(!has_active_runs_in_task_tree(&settled));
    }

    #[test]
    fn maps_statuses_to_exit_codes() {
        assert_eq!(TaskRunStatus::Success.exit_code(), 0);
        assert_eq!(TaskRunStatus::Failed.exit_code(), 1);
        assert_eq!(TaskRunStatus::Cancelled.exit_code(), 1);
    }
}
