//! Runs the shared conformance spec in `tests/spec/` against this client.
//!
//! The TypeScript client runs the same files from `apps/tui/tests/`, so a
//! behavior only has to be written down once and both clients are held to it.
//! When a case fails here but passes there, the two clients have drifted.
//!
//! Timestamp cases assume `TZ=UTC`; `cargo test` inherits it from the
//! environment, so run the suite with `TZ=UTC cargo test`.
use std::fs;
use std::path::PathBuf;

use serde_json::{Map, Value, json};

use crate::model::{TaskMap, TaskRunLogLine, TaskRunStatus, TaskRunTreeNode};

// ------------------------------------------------------------------- loading

pub(crate) fn spec_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/spec")
}

pub(crate) fn load_spec(file_name: &str) -> Value {
    let path = spec_dir().join(file_name);
    let raw = fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", path.display()));
    serde_json::from_str(&raw)
        .unwrap_or_else(|error| panic!("failed to parse {}: {error}", path.display()))
}

fn fixtures() -> Value {
    load_spec("fixtures.json")
}

/// The wire types spell every optional field out, so the fixtures — which omit
/// the ones that are simply absent — get the missing keys filled in with null
/// before they are deserialized.
fn fill_nulls(value: &mut Value, keys: &[&str], nested: &[&str]) {
    match value {
        Value::Object(map) => {
            for key in keys {
                map.entry((*key).to_string()).or_insert(Value::Null);
            }
            for (_, child) in map.iter_mut() {
                fill_nulls(child, keys, nested);
            }
            let _ = nested;
        }
        Value::Array(items) => {
            for item in items {
                fill_nulls(item, keys, nested);
            }
        }
        _ => {}
    }
}

const TASK_KEYS: [&str; 7] = [
    "title",
    "color",
    "command",
    "dependsOn",
    "optional",
    "tasks",
    "dependsOnTasks",
];

const RUN_KEYS: [&str; 2] = ["parentRunId", "waitingOn"];

pub(crate) fn task_map(name: &str) -> TaskMap {
    let mut value = fixtures()["taskMaps"][name].clone();
    assert!(!value.is_null(), "unknown task map fixture \"{name}\"");
    if let Value::Object(map) = &mut value {
        for (_, task) in map.iter_mut() {
            fill_task_nulls(task);
        }
    }
    serde_json::from_value(value).expect("task map fixture should deserialize")
}

fn fill_task_nulls(task: &mut Value) {
    let Value::Object(map) = task else {
        return;
    };
    for key in TASK_KEYS {
        map.entry(key.to_string()).or_insert(Value::Null);
    }
    if let Some(Value::Object(children)) = map.get_mut("tasks") {
        for (_, child) in children.iter_mut() {
            fill_task_nulls(child);
        }
    }
}

pub(crate) fn run_tree(name: &str) -> Vec<TaskRunTreeNode> {
    let mut value = fixtures()["runTrees"][name].clone();
    assert!(!value.is_null(), "unknown run tree fixture \"{name}\"");
    fill_nulls(&mut value, &RUN_KEYS, &[]);
    serde_json::from_value(value).expect("run tree fixture should deserialize")
}

pub(crate) fn run_node(value: &Value) -> TaskRunTreeNode {
    let mut value = value.clone();
    fill_nulls(&mut value, &RUN_KEYS, &[]);
    serde_json::from_value(value).expect("run fixture should deserialize")
}

pub(crate) fn cases(spec: &Value, section: &str) -> Vec<Value> {
    spec[section]
        .as_array()
        .unwrap_or_else(|| panic!("spec section \"{section}\" should be an array"))
        .clone()
}

pub(crate) fn case_name(case: &Value, index: usize) -> String {
    case["name"]
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| format!("case {}", index + 1))
}

pub(crate) fn strings(value: &Value) -> Vec<String> {
    value
        .as_array()
        .expect("expected an array of strings")
        .iter()
        .map(|item| item.as_str().expect("expected a string").to_string())
        .collect()
}

pub(crate) fn status_from(value: &Value) -> TaskRunStatus {
    serde_json::from_value(value.clone()).expect("expected a task run status")
}

/// Builds a crossterm key from the shared spec's `{ name, ctrl, option, ... }`
/// shape. `option` is macOS's Alt.
pub(crate) fn key_event(spec: &Value) -> crossterm::event::KeyEvent {
    use crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyEventState, KeyModifiers};

    let name = spec["name"].as_str().expect("a key needs a name");
    let code = match name {
        "up" => KeyCode::Up,
        "down" => KeyCode::Down,
        "left" => KeyCode::Left,
        "right" => KeyCode::Right,
        "enter" | "return" => KeyCode::Enter,
        "escape" => KeyCode::Esc,
        "backspace" => KeyCode::Backspace,
        "tab" => KeyCode::Tab,
        "pageup" => KeyCode::PageUp,
        "pagedown" => KeyCode::PageDown,
        "home" => KeyCode::Home,
        "end" => KeyCode::End,
        other => {
            if let Some(number) = other
                .strip_prefix('f')
                .and_then(|digits| digits.parse::<u8>().ok())
            {
                KeyCode::F(number)
            } else {
                let mut characters = other.chars();
                let character = characters.next().expect("an empty key name");
                assert!(
                    characters.next().is_none(),
                    "unmapped key name \"{other}\" in the shared spec"
                );
                KeyCode::Char(character)
            }
        }
    };

    let mut modifiers = KeyModifiers::NONE;
    for (field, modifier) in [
        ("ctrl", KeyModifiers::CONTROL),
        ("option", KeyModifiers::ALT),
        ("meta", KeyModifiers::META),
        ("super", KeyModifiers::SUPER),
        ("shift", KeyModifiers::SHIFT),
    ] {
        if spec[field].as_bool().unwrap_or(false) {
            modifiers |= modifier;
        }
    }

    let kind = match spec["eventType"].as_str() {
        Some("release") => KeyEventKind::Release,
        Some("repeat") => KeyEventKind::Repeat,
        _ => KeyEventKind::Press,
    };

    KeyEvent {
        code,
        modifiers,
        kind,
        state: KeyEventState::NONE,
    }
}

pub(crate) fn log_line(task: &str) -> TaskRunLogLine {
    TaskRunLogLine {
        run_id: "run".to_string(),
        task: task.to_string(),
        line: String::new(),
        is_stderr: false,
        timestamp: 0,
        sequence: 0,
    }
}

// ---------------------------------------------------------- task structure

mod task_structure {
    use super::*;
    use crate::task_structure::{
        build_task_tree, find_next_parent_task_index, find_previous_parent_task_index,
        flatten_task_rows, get_direct_child_task_keys,
    };

    fn rows(tasks: &str) -> Vec<crate::model::TaskRow> {
        flatten_task_rows(&build_task_tree(&task_map(tasks)))
    }

    #[test]
    fn flattens_rows() {
        let spec = load_spec("task-structure.json");
        for (index, case) in cases(&spec, "flattenTaskRows").iter().enumerate() {
            let name = case_name(case, index);
            let actual: Vec<Value> = rows(case["tasks"].as_str().unwrap())
                .into_iter()
                .map(|row| json!({ "key": row.key, "label": row.label, "depth": row.depth }))
                .collect();
            assert_eq!(Value::Array(actual), case["expected"], "{name}");
        }
    }

    #[test]
    fn resolves_direct_children() {
        let spec = load_spec("task-structure.json");
        for (index, case) in cases(&spec, "getDirectChildTaskKeys").iter().enumerate() {
            let name = case_name(case, index);
            let actual = get_direct_child_task_keys(
                &task_map(case["tasks"].as_str().unwrap()),
                case["taskKey"].as_str().unwrap(),
            );
            assert_eq!(actual, strings(&case["expected"]), "{name}");
        }
    }

    #[test]
    fn jumps_between_parents() {
        let spec = load_spec("task-structure.json");
        for (index, case) in cases(&spec, "findNextParentTaskIndex").iter().enumerate() {
            let name = case_name(case, index);
            let actual = find_next_parent_task_index(
                &rows(case["tasks"].as_str().unwrap()),
                case["from"].as_u64().unwrap() as usize,
            );
            assert_eq!(actual as u64, case["expected"].as_u64().unwrap(), "{name}");
        }
        for (index, case) in cases(&spec, "findPreviousParentTaskIndex")
            .iter()
            .enumerate()
        {
            let name = case_name(case, index);
            let actual = find_previous_parent_task_index(
                &rows(case["tasks"].as_str().unwrap()),
                case["from"].as_u64().unwrap() as usize,
            );
            assert_eq!(actual as u64, case["expected"].as_u64().unwrap(), "{name}");
        }
    }
}

// ---------------------------------------------------------------- task runs

mod task_runs {
    use super::*;
    use crate::task_runs::{
        build_display_status_by_task_key, can_cancel_run, index_runs_by_task_key,
        upsert_run_tree_node,
    };

    #[test]
    fn indexes_runs_by_task_key() {
        let spec = load_spec("task-runs.json");
        for (index, case) in cases(&spec, "indexRunsByTaskKey").iter().enumerate() {
            let name = case_name(case, index);
            let indexed = index_runs_by_task_key(&run_tree(case["runs"].as_str().unwrap()));
            let mut actual = Map::new();
            for (task_key, run) in &indexed {
                actual.insert(task_key.clone(), json!(run.id));
            }
            assert_eq!(Value::Object(actual), case["expected"], "{name}");
        }
    }

    #[test]
    fn aggregates_display_statuses() {
        let spec = load_spec("task-runs.json");
        for (index, case) in cases(&spec, "buildDisplayStatusByTaskKey")
            .iter()
            .enumerate()
        {
            let name = case_name(case, index);
            let tasks = task_map(case["tasks"].as_str().unwrap());
            let statuses = build_display_status_by_task_key(
                &tasks,
                &index_runs_by_task_key(&run_tree(case["runs"].as_str().unwrap())),
            );
            let expected = case["expected"].as_object().unwrap();
            let mut actual = Map::new();
            for task_key in expected.keys() {
                let label = statuses
                    .get(task_key)
                    .copied()
                    .flatten()
                    .map(|status| json!(status.label()))
                    .unwrap_or(Value::Null);
                actual.insert(task_key.clone(), label);
            }
            assert_eq!(Value::Object(actual), case["expected"], "{name}");
        }
    }

    #[test]
    fn upserts_run_tree_nodes() {
        let spec = load_spec("task-runs.json");
        for (index, case) in cases(&spec, "upsertRunTreeNode").iter().enumerate() {
            let name = case_name(case, index);
            let mut roots = run_tree(case["runs"].as_str().unwrap());
            upsert_run_tree_node(&mut roots, run_node(&case["update"]));

            let root_ids: Vec<String> = roots.iter().map(|run| run.id.clone()).collect();
            assert_eq!(root_ids, strings(&case["expectedRootIds"]), "{name}");

            for (run_id, status) in case["expectedStatusById"].as_object().unwrap() {
                let found = find_run(&roots, run_id)
                    .unwrap_or_else(|| panic!("{name}: run \"{run_id}\" is missing"));
                assert_eq!(json!(found.status.as_str()), *status, "{name} / {run_id}");
            }
        }
    }

    #[test]
    fn decides_what_can_be_cancelled() {
        let spec = load_spec("task-runs.json");
        for (index, case) in cases(&spec, "canCancelRun").iter().enumerate() {
            let name = case_name(case, index);
            let child_count = case["run"]["childCount"].as_u64().unwrap() as usize;
            let run = TaskRunTreeNode {
                id: "run".to_string(),
                task: "dev".to_string(),
                cwd: "/repo".to_string(),
                parent_run_id: None,
                status: status_from(&case["run"]["status"]),
                updated_at: 0,
                waiting_on: None,
                children: (0..child_count)
                    .map(|child_index| TaskRunTreeNode {
                        id: format!("child-{child_index}"),
                        task: format!("dev:child-{child_index}"),
                        cwd: "/repo".to_string(),
                        parent_run_id: Some("run".to_string()),
                        status: TaskRunStatus::Running,
                        updated_at: 0,
                        waiting_on: None,
                        children: Vec::new(),
                    })
                    .collect(),
            };
            assert_eq!(
                can_cancel_run(&run),
                case["expected"].as_bool().unwrap(),
                "{name}"
            );
        }
    }

    fn find_run<'a>(roots: &'a [TaskRunTreeNode], run_id: &str) -> Option<&'a TaskRunTreeNode> {
        for run in roots {
            if run.id == run_id {
                return Some(run);
            }
            if let Some(found) = find_run(&run.children, run_id) {
                return Some(found);
            }
        }
        None
    }
}

// ------------------------------------------------------------ cli task runs

mod cli_task_runs {
    use super::*;
    use crate::cli_task_runs::{
        find_active_run_by_task_key, find_active_run_in_task_subtree,
        find_active_runs_in_task_subtree, find_latest_run_by_task_key,
        find_latest_run_in_task_subtree, flatten_task_runs, is_task_in_subtree,
    };

    fn optional_id(run: Option<&TaskRunTreeNode>) -> Value {
        run.map(|run| json!(run.id)).unwrap_or(Value::Null)
    }

    #[test]
    fn flattens_run_trees() {
        let spec = load_spec("cli-task-runs.json");
        for (index, case) in cases(&spec, "flattenTaskRuns").iter().enumerate() {
            let name = case_name(case, index);
            let runs = run_tree(case["runs"].as_str().unwrap());
            let actual: Vec<String> = flatten_task_runs(&runs)
                .into_iter()
                .map(|run| run.id.clone())
                .collect();
            assert_eq!(actual, strings(&case["expected"]), "{name}");
        }
    }

    #[test]
    fn matches_subtrees_by_key() {
        let spec = load_spec("cli-task-runs.json");
        for (index, case) in cases(&spec, "isTaskInSubtree").iter().enumerate() {
            let name = case_name(case, index);
            assert_eq!(
                is_task_in_subtree(
                    case["taskKey"].as_str().unwrap(),
                    case["rootTaskKey"].as_str().unwrap()
                ),
                case["expected"].as_bool().unwrap(),
                "{name}"
            );
        }
    }

    /// Runs one lookup section: every case names a run tree and a key, and the
    /// expectation is the id of the run that should come back.
    fn check_lookup(
        section: &str,
        key_field: &str,
        lookup: impl for<'a> Fn(&'a [TaskRunTreeNode], &str) -> Option<&'a TaskRunTreeNode>,
    ) {
        let spec = load_spec("cli-task-runs.json");
        for (index, case) in cases(&spec, section).iter().enumerate() {
            let name = case_name(case, index);
            let runs = run_tree(case["runs"].as_str().unwrap());
            let actual = optional_id(lookup(&runs, case[key_field].as_str().unwrap()));
            assert_eq!(actual, case["expected"], "{section} / {name}");
        }
    }

    #[test]
    fn finds_runs_by_task_key() {
        check_lookup(
            "findLatestRunByTaskKey",
            "taskKey",
            find_latest_run_by_task_key,
        );
        check_lookup(
            "findActiveRunByTaskKey",
            "taskKey",
            find_active_run_by_task_key,
        );
    }

    #[test]
    fn finds_runs_in_subtrees() {
        let spec = load_spec("cli-task-runs.json");
        check_lookup(
            "findLatestRunInTaskSubtree",
            "rootTaskKey",
            find_latest_run_in_task_subtree,
        );
        check_lookup(
            "findActiveRunInTaskSubtree",
            "rootTaskKey",
            find_active_run_in_task_subtree,
        );

        for (index, case) in cases(&spec, "findActiveRunsInTaskSubtree")
            .iter()
            .enumerate()
        {
            let name = case_name(case, index);
            let runs = run_tree(case["runs"].as_str().unwrap());
            let actual: Vec<String> =
                find_active_runs_in_task_subtree(&runs, case["rootTaskKey"].as_str().unwrap())
                    .into_iter()
                    .map(|run| run.id.clone())
                    .collect();
            assert_eq!(actual, strings(&case["expected"]), "{name}");
        }
    }

    #[test]
    fn classifies_statuses() {
        let spec = load_spec("cli-task-runs.json");
        for case in cases(&spec, "isTerminalRunStatus") {
            let status = status_from(&case["status"]);
            assert_eq!(
                status.is_terminal(),
                case["expected"].as_bool().unwrap(),
                "{status:?}"
            );
            assert_eq!(status.is_active(), !status.is_terminal(), "{status:?}");
        }

        for case in cases(&spec, "taskRunStatusExitCode") {
            let status = status_from(&case["status"]);
            let expected = case["expected"].as_i64().unwrap() as i32;
            let actual = if status == TaskRunStatus::Success {
                0
            } else {
                1
            };
            assert_eq!(actual, expected, "{status:?}");
        }
    }
}

// ------------------------------------------------------------------- status

mod status {
    use super::*;
    use crate::logs::resolve_task_log_color;
    use crate::model::DisplayTaskStatus;
    use crate::status::task_status_display;
    use ratatui::style::Color;

    fn hex(color: Color) -> String {
        match color {
            Color::Rgb(red, green, blue) => format!("#{red:02x}{green:02x}{blue:02x}"),
            other => panic!("expected an rgb color, got {other:?}"),
        }
    }

    #[test]
    fn maps_statuses_to_icons_and_colors() {
        let spec = load_spec("status.json");
        for case in cases(&spec, "taskStatusDisplay") {
            let status = match case["status"].as_str() {
                None => None,
                Some("Indeterminate") => Some(DisplayTaskStatus::Indeterminate),
                Some(other) => Some(DisplayTaskStatus::Run(status_from(&json!(other)))),
            };
            let display = task_status_display(status);
            let label = case["status"].as_str().unwrap_or("none");
            assert_eq!(display.icon, case["icon"].as_str().unwrap(), "{label}");
            assert_eq!(
                hex(display.color),
                case["color"].as_str().unwrap(),
                "{label}"
            );
        }
    }

    #[test]
    fn resolves_task_log_colors() {
        let spec = load_spec("status.json");
        for case in cases(&spec, "resolveTaskLogColor") {
            let input = case["input"].as_str();
            let actual = resolve_task_log_color(input)
                .map(Value::String)
                .unwrap_or(Value::Null);
            assert_eq!(actual, case["expected"], "{input:?}");
        }
    }
}

// --------------------------------------------------------------------- logs

mod logs {
    use super::*;
    use crate::logs::{
        format_elapsed_duration, format_log_timestamp, format_task_tag_for_log,
        parse_ansi_log_segments, sanitize_log_for_display,
    };

    #[test]
    fn formats_task_tags() {
        let spec = load_spec("logs.json");
        for (index, case) in cases(&spec, "formatTaskTagForLog").iter().enumerate() {
            let name = case_name(case, index);
            let actual = format_task_tag_for_log(
                case["task"].as_str().unwrap(),
                case["width"].as_u64().unwrap() as usize,
            );
            assert_eq!(actual, case["expected"].as_str().unwrap(), "{name}");
        }
    }

    #[test]
    fn formats_elapsed_durations() {
        let spec = load_spec("logs.json");
        for case in cases(&spec, "formatElapsedDuration") {
            let input = case["input"].as_i64().unwrap();
            assert_eq!(
                format_elapsed_duration(input),
                case["expected"].as_str().unwrap(),
                "{input}ms"
            );
        }
    }

    #[test]
    fn formats_log_timestamps() {
        let spec = load_spec("logs.json");
        for case in cases(&spec, "formatLogTimestamp") {
            let input = case["input"].as_i64().unwrap();
            assert_eq!(
                format_log_timestamp(input),
                case["expected"].as_str().unwrap(),
                "{input}"
            );
        }
    }

    #[test]
    fn sanitizes_lines_for_display() {
        let spec = load_spec("logs.json");
        for (index, case) in cases(&spec, "sanitizeLogForDisplay").iter().enumerate() {
            let name = case_name(case, index);
            assert_eq!(
                sanitize_log_for_display(case["input"].as_str().unwrap()),
                case["expected"].as_str().unwrap(),
                "{name}"
            );
        }
    }

    #[test]
    fn parses_ansi_segments() {
        let spec = load_spec("logs.json");
        for (index, case) in cases(&spec, "parseAnsiLogSegments").iter().enumerate() {
            let name = case_name(case, index);
            let actual: Vec<Value> = parse_ansi_log_segments(case["input"].as_str().unwrap())
                .into_iter()
                .map(|segment| {
                    let mut style = Map::new();
                    if let Some(fg) = segment.style.fg {
                        style.insert("fg".to_string(), json!(fg));
                    }
                    if let Some(bg) = segment.style.bg {
                        style.insert("bg".to_string(), json!(bg));
                    }
                    for (key, value) in [
                        ("bold", segment.style.bold),
                        ("dim", segment.style.dim),
                        ("italic", segment.style.italic),
                        ("underline", segment.style.underline),
                    ] {
                        if let Some(value) = value {
                            style.insert(key.to_string(), json!(value));
                        }
                    }
                    json!({ "text": segment.text, "style": Value::Object(style) })
                })
                .collect();
            assert_eq!(Value::Array(actual), case["expected"], "{name}");
        }
    }
}

// ----------------------------------------------------------------- keyboard

mod keyboard {
    use super::*;
    use crate::keyboard::{is_jump_parents_backward_shortcut, is_jump_parents_forward_shortcut};

    #[test]
    fn resolves_jump_shortcuts() {
        let spec = load_spec("keyboard.json");
        for (index, case) in cases(&spec, "cases").iter().enumerate() {
            let name = case_name(case, index);
            let key = super::key_event(&case["key"]);
            let is_macos = case["isMacOs"].as_bool().unwrap();
            assert_eq!(
                is_jump_parents_forward_shortcut(&key, is_macos),
                case["forward"].as_bool().unwrap(),
                "{name} (forward)"
            );
            assert_eq!(
                is_jump_parents_backward_shortcut(&key, is_macos),
                case["backward"].as_bool().unwrap(),
                "{name} (backward)"
            );
        }
    }
}

// --------------------------------------------------------------------- args

mod cli_args {
    use super::*;
    use crate::api::{BIZI_API_HOST, BIZI_API_PORT, resolve_api_host, resolve_api_port};
    use crate::cli::{find_first_positional_token_index, normalize_implicit_run_command};

    fn argv(value: &Value) -> Vec<String> {
        strings(value)
    }

    #[test]
    fn finds_the_first_positional_token() {
        let spec = load_spec("cli-args.json");
        for (index, case) in cases(&spec, "findFirstPositionalTokenIndex")
            .iter()
            .enumerate()
        {
            let name = case_name(case, index);
            let actual = find_first_positional_token_index(&argv(&case["argv"]))
                .map(|found| json!(found))
                .unwrap_or(Value::Null);
            assert_eq!(actual, case["expected"], "{name} {:?}", case["argv"]);
        }
    }

    #[test]
    fn rewrites_implicit_runs() {
        let spec = load_spec("cli-args.json");
        for (index, case) in cases(&spec, "normalizeImplicitRunCommand")
            .iter()
            .enumerate()
        {
            let name = case_name(case, index);
            let (normalized, implicit) = normalize_implicit_run_command(&argv(&case["argv"]));
            assert_eq!(normalized, argv(&case["expectedArgv"]), "{name}");
            assert_eq!(
                implicit,
                case["expectedImplicit"].as_bool().unwrap(),
                "{name}"
            );
        }
    }

    #[test]
    fn resolves_the_server_target_from_the_environment() {
        for value in [
            None,
            Some(""),
            Some("   "),
            Some("nope"),
            Some("0"),
            Some("70000"),
        ] {
            assert_eq!(resolve_api_port(value), BIZI_API_PORT, "{value:?}");
        }
        assert_eq!(resolve_api_port(Some("8080")), 8080);
        assert_eq!(resolve_api_port(Some(" 65535 ")), 65_535);

        for value in [None, Some(""), Some("   ")] {
            assert_eq!(resolve_api_host(value), BIZI_API_HOST, "{value:?}");
        }
        assert_eq!(resolve_api_host(Some("127.0.0.1")), "127.0.0.1");
    }
}
