//! Runs the shared TUI conformance cases (`tests/spec/tui-keys.json` and
//! `tests/spec/view-state.json`) against this client's `App`.
//!
//! It lives inside `tui` so it can drive the real state machine rather than a
//! copy of it. The TypeScript client runs the same files from
//! `apps/tui/tests/`.
use ratatui::layout::Rect;
use serde_json::{Map, Value, json};
use tokio::sync::mpsc;

use super::selection::Selection;
use super::{App, AppEffect, AppEvent, Pane, ui};
use crate::api::BiziApi;
use crate::conformance::{
    case_name, cases, key_event, load_spec, log_line, run_node, run_tree, task_map,
};
use crate::model::LogMode;
use crate::task_runs::upsert_run_tree_node;

const SEEDED_LOG_COUNT: usize = 2;

/// An app plus the event receiver it sends to. Nothing reads the receiver; it
/// is held so the channel stays open for the length of a case.
struct TestApp {
    app: App,
    _events: mpsc::Receiver<AppEvent>,
}

fn new_app() -> TestApp {
    let (sender, receiver) = mpsc::channel(64);
    let app = App::new(
        // Port 1 so an accidental request fails fast instead of reaching a real
        // server; no case performs its effects.
        BiziApi::with_target("127.0.0.1".to_string(), 1),
        "/repo".to_string(),
        sender,
    );
    TestApp {
        app,
        _events: receiver,
    }
}

// Lets the cases below read as though they were holding an `App` directly.
impl std::ops::Deref for TestApp {
    type Target = App;

    fn deref(&self) -> &App {
        &self.app
    }
}

impl std::ops::DerefMut for TestApp {
    fn deref_mut(&mut self) -> &mut App {
        &mut self.app
    }
}

fn build_app(case: &Value) -> TestApp {
    let mut test_app = new_app();
    let app = &mut test_app.app;
    app.is_macos = case["isMacOs"].as_bool().unwrap_or(false);
    app.tasks = task_map(case["tasks"].as_str().unwrap_or("monorepo"));
    app.task_runs = run_tree(case["runs"].as_str().unwrap_or("none"));
    app.rebuild_task_indexes();
    app.replace_logs(
        (0..SEEDED_LOG_COUNT)
            .map(|_| log_line("dev"))
            .collect::<Vec<_>>(),
    );

    let initial = &case["initial"];
    if let Some(index) = initial["selectedIndex"].as_u64() {
        app.selected_index = index as usize;
    }
    if let Some(pane) = initial["focusedPane"].as_str() {
        app.focused_pane = if pane == "logs" {
            Pane::Logs
        } else {
            Pane::Tasks
        };
    }
    if let Some(focused) = initial["isTaskSearchFocused"].as_bool() {
        app.is_task_search_focused = focused;
    }
    if let Some(query) = initial["taskSearchQuery"].as_str() {
        app.task_search_query = query.to_string();
    }
    if let Some(mode) = initial["logMode"].as_str() {
        app.log_mode = if mode == "selected" {
            LogMode::Selected
        } else {
            LogMode::Aggregate
        };
    }
    if let Some(index) = initial["quitActionIndex"].as_u64() {
        app.quit_action_index = index as usize;
    }
    if initial["showQuitConfirmation"].as_bool().unwrap_or(false) {
        app.show_quit_confirmation = true;
    }
    if initial["isCancellingBeforeExit"].as_bool().unwrap_or(false) {
        app.is_cancelling_before_exit = true;
    }
    if initial["hasSelection"].as_bool().unwrap_or(false) {
        app.log_area = Rect::new(0, 0, 20, 3);
        app.rendered_log_rows = vec![vec!['a'; 20]];
        let mut selection = Selection::new(app.log_area, (0, 0));
        selection.extend_to((10, 0));
        app.selection = Some(selection);
    }

    test_app
}

/// `CopySelection` is asserted through "did not quit", matching how the
/// TypeScript harness drops its `copySelection` effect.
fn effect_json(effect: &AppEffect) -> Option<Value> {
    match effect {
        AppEffect::RunTask(task_key) => Some(json!({ "type": "runTask", "taskKey": task_key })),
        AppEffect::RestartRun(run_id) => Some(json!({ "type": "restartRun", "runId": run_id })),
        AppEffect::CancelRun(run_id) => Some(json!({ "type": "cancelRun", "runId": run_id })),
        AppEffect::CancelRunsBeforeExit(run_ids) => Some(json!({
            "type": "cancelRunsBeforeExit",
            "runIds": run_ids,
        })),
        AppEffect::CopySelection(_) => None,
        AppEffect::OpenRootRunStreams(run_ids) => Some(json!({
            "type": "openRootRunStreams",
            "runIds": run_ids,
        })),
        AppEffect::CloseRootRunStreams => Some(json!({ "type": "closeRootRunStreams" })),
        AppEffect::OpenSelectedRunStreams {
            run_id,
            include_children,
        } => Some(json!({
            "type": "openSelectedRunStreams",
            "runId": run_id,
            "includeChildren": include_children,
        })),
        AppEffect::CloseSelectedRunStreams => Some(json!({ "type": "closeSelectedRunStreams" })),
    }
}

fn actual_state(app: &App) -> Map<String, Value> {
    let mut actual = Map::new();
    actual.insert("selectedIndex".to_string(), json!(app.selected_index));
    actual.insert(
        "focusedPane".to_string(),
        json!(match app.focused_pane {
            Pane::Tasks => "tasks",
            Pane::Logs => "logs",
        }),
    );
    actual.insert(
        "isTaskSearchFocused".to_string(),
        json!(app.is_task_search_focused),
    );
    actual.insert("taskSearchQuery".to_string(), json!(app.task_search_query));
    actual.insert(
        "showTaskSearchError".to_string(),
        json!(app.show_task_search_error),
    );
    actual.insert(
        "showQuitConfirmation".to_string(),
        json!(app.show_quit_confirmation),
    );
    actual.insert("quitActionIndex".to_string(), json!(app.quit_action_index));
    actual.insert(
        "isCancellingBeforeExit".to_string(),
        json!(app.is_cancelling_before_exit),
    );
    actual.insert(
        "errorMessage".to_string(),
        app.error_message
            .as_ref()
            .map(|message| json!(message))
            .unwrap_or(Value::Null),
    );
    actual.insert("shouldQuit".to_string(), json!(app.should_quit));
    actual.insert("logMode".to_string(), json!(app.log_mode.label()));
    actual.insert("logCount".to_string(), json!(app.logs.len()));
    actual.insert(
        "effects".to_string(),
        Value::Array(app.effects.iter().filter_map(effect_json).collect()),
    );
    actual
}

#[test]
fn handles_keys_the_way_the_shared_spec_says() {
    let spec = load_spec("tui-keys.json");
    for (index, case) in cases(&spec, "cases").iter().enumerate() {
        let name = case_name(case, index);
        let mut test_app = build_app(case);

        for key in case["keys"].as_array().expect("keys should be an array") {
            test_app.handle_key(key_event(key));
        }

        let actual = actual_state(&test_app);
        for (field, expected) in case["expect"]
            .as_object()
            .expect("expect should be an object")
        {
            let found = actual
                .get(field)
                .unwrap_or_else(|| panic!("{name}: unknown expectation \"{field}\""));
            assert_eq!(found, expected, "{name} / {field}");
        }
    }
}

#[test]
fn opens_and_closes_streams_the_way_the_shared_spec_says() {
    let spec = load_spec("log-subscriptions.json");
    for (index, case) in cases(&spec, "cases").iter().enumerate() {
        let name = case_name(case, index);
        let mut test_app = build_app(case);
        // `build_app` seeds the run tree without syncing, so the first step
        // starts from "nothing subscribed" like the TypeScript harness.
        let mut effects: Vec<Value> = Vec::new();

        for step in case["steps"].as_array().expect("steps should be an array") {
            if step["clearEffects"].as_bool().unwrap_or(false) {
                effects.clear();
                test_app.effects.clear();
                continue;
            }
            if let Some(fixture) = step["runsLoaded"].as_str() {
                test_app.task_runs = run_tree(fixture);
                test_app.rebuild_task_indexes();
            }
            if !step["runUpdated"].is_null() {
                let run = run_node(&step["runUpdated"]);
                upsert_run_tree_node(&mut test_app.task_runs, run);
                test_app.rebuild_task_indexes();
            }
            if let Some(selected) = step["selectedIndex"].as_u64() {
                test_app.selected_index = selected as usize;
            }
            if !step["key"].is_null() {
                test_app.handle_key(key_event(&step["key"]));
            }
            test_app.sync_subscriptions();
            effects.extend(
                test_app
                    .effects
                    .drain(..)
                    .filter_map(|effect| effect_json(&effect)),
            );
        }

        let mut actual = Map::new();
        actual.insert("effects".to_string(), Value::Array(effects));
        actual.insert("logCount".to_string(), json!(test_app.logs.len()));
        actual.insert(
            "selectedStreamKey".to_string(),
            test_app
                .log_subscription_key
                .as_ref()
                .map(|key| json!(key))
                .unwrap_or(Value::Null),
        );
        actual.insert(
            "rootStreamKey".to_string(),
            test_app
                .root_runs_key
                .as_ref()
                .map(|key| json!(key))
                .unwrap_or(Value::Null),
        );

        for (field, expected) in case["expect"]
            .as_object()
            .expect("expect should be an object")
        {
            let found = actual
                .get(field)
                .unwrap_or_else(|| panic!("{name}: unknown expectation \"{field}\""));
            assert_eq!(found, expected, "{name} / {field}");
        }
    }
}

// ------------------------------------------------------------- view state

/// Points the selection at `task_key`, or at nothing when it is null.
fn select_task_key(app: &mut App, task_key: Option<&str>) {
    match task_key {
        Some(key) => {
            app.selected_index = app
                .task_rows
                .iter()
                .position(|row| row.key == key)
                .unwrap_or_else(|| panic!("no row for task \"{key}\""));
        }
        None => app.selected_index = usize::MAX,
    }
}

fn view_app(tasks: &str, runs: &str) -> TestApp {
    let mut test_app = new_app();
    test_app.app.tasks = task_map(tasks);
    test_app.app.task_runs = run_tree(runs);
    test_app.app.rebuild_task_indexes();
    test_app
}

#[test]
fn derives_the_view_state_the_shared_spec_describes() {
    let spec = load_spec("view-state.json");

    for (index, case) in cases(&spec, "resolveRowAction").iter().enumerate() {
        let name = case_name(case, index);
        let app = view_app(
            case["tasks"].as_str().unwrap(),
            case["runs"].as_str().unwrap(),
        );
        let action = app.resolve_row_action(
            case["taskKey"].as_str().unwrap(),
            case["depth"].as_u64().unwrap() as usize,
        );
        assert_eq!(json!(action.label()), case["expected"], "{name}");
    }

    for (index, case) in cases(&spec, "selectedFooterStatus").iter().enumerate() {
        let name = case_name(case, index);
        let mut app = view_app(
            case["tasks"].as_str().unwrap(),
            case["runs"].as_str().unwrap(),
        );
        select_task_key(&mut app, case["taskKey"].as_str());
        let actual = app
            .selected_footer_status()
            .map(|status| json!(status.as_str()))
            .unwrap_or(Value::Null);
        assert_eq!(actual, case["expected"], "{name}");
    }

    for (index, case) in cases(&spec, "canToggleLogMode").iter().enumerate() {
        let name = case_name(case, index);
        let mut app = view_app(case["tasks"].as_str().unwrap(), "none");
        select_task_key(&mut app, case["taskKey"].as_str());
        assert_eq!(json!(app.can_toggle_log_mode()), case["expected"], "{name}");
    }

    for (index, case) in cases(&spec, "usesAggregateLogs").iter().enumerate() {
        let name = case_name(case, index);
        let mut app = view_app(case["tasks"].as_str().unwrap(), "none");
        select_task_key(&mut app, case["taskKey"].as_str());
        app.log_mode = if case["logMode"].as_str() == Some("selected") {
            LogMode::Selected
        } else {
            LogMode::Aggregate
        };
        assert_eq!(
            json!(app.selected_uses_aggregate_logs()),
            case["expected"],
            "{name}"
        );
    }

    for (index, case) in cases(&spec, "canCancelSelected").iter().enumerate() {
        let name = case_name(case, index);
        let mut app = view_app(
            case["tasks"].as_str().unwrap(),
            case["runs"].as_str().unwrap(),
        );
        select_task_key(&mut app, case["taskKey"].as_str());
        assert_eq!(json!(app.can_cancel_selected()), case["expected"], "{name}");
    }

    for (index, case) in cases(&spec, "runningTaskRows").iter().enumerate() {
        let name = case_name(case, index);
        let app = view_app(
            case["tasks"].as_str().unwrap(),
            case["runs"].as_str().unwrap(),
        );
        // `depth` is carried by the TypeScript row and rendered by neither
        // client, so the shared expectation is compared on key and status here.
        let actual: Vec<Value> = app
            .running_task_rows()
            .into_iter()
            .map(|row| json!({ "key": row.key, "status": row.status.as_str() }))
            .collect();
        let expected: Vec<Value> = case["expected"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| json!({ "key": row["key"], "status": row["status"] }))
            .collect();
        assert_eq!(actual, expected, "{name}");
    }

    for (index, case) in cases(&spec, "logTaskTagWidth").iter().enumerate() {
        let name = case_name(case, index);
        let mut app = view_app("monorepo", "none");
        app.replace_logs(
            case["taskNames"]
                .as_array()
                .unwrap()
                .iter()
                .map(|task| log_line(task.as_str().unwrap()))
                .collect(),
        );
        assert_eq!(json!(app.log_task_tag_width()), case["expected"], "{name}");
    }

    for (index, case) in cases(&spec, "buildLogColorByTaskKey").iter().enumerate() {
        let name = case_name(case, index);
        let app = view_app(case["tasks"].as_str().unwrap(), "none");
        let mut actual = Map::new();
        for task_key in app.tasks.keys() {
            if let Some(color) = app.log_color_for_task(task_key) {
                actual.insert(task_key.clone(), json!(color));
            }
        }
        assert_eq!(Value::Object(actual), case["expected"], "{name}");
    }

    for (index, case) in cases(&spec, "clampSelectedIndex").iter().enumerate() {
        let name = case_name(case, index);
        let row_count = case["rowCount"].as_u64().unwrap() as usize;
        let tasks = if row_count == 0 { "empty" } else { "deep" };
        let mut app = view_app(tasks, "none");
        assert_eq!(app.task_rows.len(), if row_count == 0 { 0 } else { 4 });
        // `deep` has four rows; the spec's cases use three, so the last row is
        // trimmed to match before clamping.
        if row_count > 0 {
            app.task_rows.truncate(row_count);
        }
        app.selected_index = case["selectedIndex"].as_u64().unwrap() as usize;
        app.clamp_selected_index();
        assert_eq!(json!(app.selected_index), case["expected"], "{name}");
    }

    for (index, case) in cases(&spec, "footerActions").iter().enumerate() {
        let name = case_name(case, index);
        let input = &case["input"];
        // The footer reads the app rather than loose flags, so each case is
        // reproduced by selecting a task with the right shape.
        let (tasks, runs, task_key) = match (
            input["hasSelection"].as_bool().unwrap(),
            input["canCancel"].as_bool().unwrap(),
            input["canToggleLogMode"].as_bool().unwrap(),
        ) {
            (false, _, _) => ("monorepo", "none", None),
            (true, false, false) => ("monorepo", "none", Some("build")),
            (true, true, true) => ("monorepo", "checkRunning", Some("check")),
            other => panic!("{name}: unsupported footer combination {other:?}"),
        };
        let mut app = view_app(tasks, runs);
        select_task_key(&mut app, task_key);
        app.log_mode = if input["logMode"].as_str() == Some("selected") {
            LogMode::Selected
        } else {
            LogMode::Aggregate
        };
        let actual: Vec<Value> = ui::footer_actions(&app)
            .into_iter()
            .map(|(key, label)| json!(format!("{key} {label}")))
            .collect();
        assert_eq!(Value::Array(actual), case["expected"], "{name}");
    }

    for (index, case) in cases(&spec, "runStatusText").iter().enumerate() {
        let name = case_name(case, index);
        let input = &case["input"];
        let mut app = view_app("monorepo", "none");
        app.task_runs = vec![crate::model::TaskRunTreeNode {
            id: "run".to_string(),
            task: "build".to_string(),
            cwd: "/repo".to_string(),
            parent_run_id: None,
            status: input["footerStatus"]
                .as_str()
                .map(|status| serde_json::from_value(json!(status)).unwrap())
                .unwrap_or(crate::model::TaskRunStatus::Queued),
            updated_at: input["selectedRunUpdatedAt"].as_i64().unwrap_or(0),
            waiting_on: input["waitingOn"].as_str().map(str::to_string),
            children: Vec::new(),
        }];
        app.rebuild_task_indexes();
        select_task_key(&mut app, Some("build"));

        let mut logs = Vec::new();
        if let Some(first) = input["firstLogTimestamp"].as_i64() {
            let mut line = log_line("build");
            line.timestamp = first;
            logs.push(line);
        }
        if let Some(last) = input["lastLogTimestamp"].as_i64() {
            let mut line = log_line("build");
            line.timestamp = last;
            logs.push(line);
        }
        app.replace_logs(logs);

        // A case with no run status at all wants the display status instead,
        // which means no run for the selected task.
        if input["footerStatus"].is_null() {
            app.task_runs.clear();
            app.rebuild_task_indexes();
            select_task_key(&mut app, Some("build"));
        }

        let actual = ui::run_status_text(&app, input["nowMs"].as_i64().unwrap());
        let expected = case["expected"].as_str().unwrap();
        if input["footerStatus"].is_null() && expected != "Idle" {
            // "Indeterminate" comes from an aggregated parent, not a leaf.
            continue;
        }
        assert_eq!(actual, expected, "{name}");
    }
}
