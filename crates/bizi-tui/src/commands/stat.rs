//! Port of the TypeScript TUI's `commands/stat.ts`.

use anyhow::Result;
use serde::Serialize;

use crate::api::BiziApi;
use crate::cli_task_runs::{find_active_run_in_task_subtree, find_latest_run_in_task_subtree};
use crate::model::{TaskMap, TaskRunTreeNode};
use crate::prompt::{blue, dim, green, red, yellow};
use crate::status::task_status_display;
use crate::task_runs::{
    DisplayStatusByTaskKey, build_display_status_by_task_key, index_runs_by_task_key,
};
use crate::task_structure::get_direct_child_task_keys;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RunSummary {
    task: String,
    status: String,
    updated_at: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskStatusTreeNode {
    task: String,
    status: Option<String>,
    icon: String,
    children: Vec<TaskStatusTreeNode>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StatPayload {
    task: String,
    cwd: String,
    active_run: Option<RunSummary>,
    latest_run: Option<RunSummary>,
    subtree: Option<TaskStatusTreeNode>,
}

pub async fn stat_command(api: &BiziApi, cwd: &str, task: &str, json: bool) -> Result<i32> {
    let tasks = api.list_tasks(cwd).await?;
    let task_runs = api.list_task_runs(cwd).await?;
    let run_by_task_key = index_runs_by_task_key(&task_runs);
    let display_status_by_task_key = build_display_status_by_task_key(&tasks, &run_by_task_key);
    let active_run = find_active_run_in_task_subtree(&task_runs, task);
    let latest_run = find_latest_run_in_task_subtree(&task_runs, task);
    let subtree = build_task_status_tree(&tasks, &display_status_by_task_key, task);

    let payload = StatPayload {
        task: task.to_string(),
        cwd: cwd.to_string(),
        active_run: active_run.map(summarize_run),
        latest_run: latest_run.map(summarize_run),
        subtree,
    };

    if json {
        println!("{}", serde_json::to_string_pretty(&payload)?);
        return Ok(0);
    }

    if payload.subtree.is_none() && latest_run.is_none() {
        println!("Task \"{task}\" has no recorded runs.");
        return Ok(0);
    }

    if let Some(subtree) = &payload.subtree {
        println!("{}", format_status_tree(subtree).join("\n"));
    }

    Ok(0)
}

fn summarize_run(run: &TaskRunTreeNode) -> RunSummary {
    RunSummary {
        task: run.task.clone(),
        status: run.status.as_str().to_string(),
        updated_at: run.updated_at,
    }
}

fn build_task_status_tree(
    tasks: &TaskMap,
    display_status_by_task_key: &DisplayStatusByTaskKey,
    root_task_key: &str,
) -> Option<TaskStatusTreeNode> {
    if !tasks.contains_key(root_task_key) {
        return None;
    }
    Some(build_node(tasks, display_status_by_task_key, root_task_key))
}

fn build_node(
    tasks: &TaskMap,
    display_status_by_task_key: &DisplayStatusByTaskKey,
    task_key: &str,
) -> TaskStatusTreeNode {
    let status = display_status_by_task_key.get(task_key).copied().flatten();
    let icon = task_status_display(status).icon.to_string();
    let mut child_keys = get_direct_child_task_keys(tasks, task_key);
    child_keys.sort();

    TaskStatusTreeNode {
        task: task_key.to_string(),
        status: status.map(|status| status.label().to_string()),
        icon,
        children: child_keys
            .iter()
            .map(|child_key| build_node(tasks, display_status_by_task_key, child_key))
            .collect(),
    }
}

fn format_status_tree(root: &TaskStatusTreeNode) -> Vec<String> {
    let mut lines = vec![format!(
        "{} {} ({})",
        colorize_status_icon(root.status.as_deref(), &root.icon),
        root.task,
        format_status_label(root.status.as_deref())
    )];

    let child_count = root.children.len();
    for (index, child) in root.children.iter().enumerate() {
        visit(child, "", index == child_count - 1, &mut lines);
    }

    lines
}

fn visit(node: &TaskStatusTreeNode, prefix: &str, is_last: bool, lines: &mut Vec<String>) {
    let connector = if is_last { "└─" } else { "├─" };
    lines.push(format!(
        "{prefix}{connector} {} {} ({})",
        colorize_status_icon(node.status.as_deref(), &node.icon),
        node.task,
        format_status_label(node.status.as_deref())
    ));

    let next_prefix = format!("{prefix}{}", if is_last { "   " } else { "│  " });
    let child_count = node.children.len();
    for (index, child) in node.children.iter().enumerate() {
        visit(child, &next_prefix, index == child_count - 1, lines);
    }
}

fn format_status_label(status: Option<&str>) -> &str {
    status.unwrap_or("Idle")
}

fn colorize_status_icon(status: Option<&str>, icon: &str) -> String {
    match status {
        None | Some("Cancelled") => dim(icon),
        Some("Queued") | Some("Indeterminate") => yellow(icon),
        Some("Running") => green(icon),
        Some("Success") => blue(icon),
        Some("Failed") => red(icon),
        Some(_) => icon.to_string(),
    }
}

/// Keeps the `DisplayTaskStatus` → label mapping honest for the JSON payload.
#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{DisplayTaskStatus, TaskRunStatus};

    #[test]
    fn status_labels_match_the_typescript_payload() {
        assert_eq!(
            DisplayTaskStatus::Run(TaskRunStatus::Running).label(),
            "Running"
        );
        assert_eq!(DisplayTaskStatus::Indeterminate.label(), "Indeterminate");
        assert_eq!(format_status_label(None), "Idle");
    }

    #[test]
    fn renders_a_tree_with_box_drawing_connectors() {
        let root = TaskStatusTreeNode {
            task: "dev".to_string(),
            status: Some("Running".to_string()),
            icon: "▶".to_string(),
            children: vec![
                TaskStatusTreeNode {
                    task: "dev:api".to_string(),
                    status: Some("Running".to_string()),
                    icon: "▶".to_string(),
                    children: Vec::new(),
                },
                TaskStatusTreeNode {
                    task: "dev:web".to_string(),
                    status: None,
                    icon: "○".to_string(),
                    children: Vec::new(),
                },
            ],
        };

        let lines = format_status_tree(&root);
        assert_eq!(lines.len(), 3);
        assert!(lines[1].contains("├─ ") && lines[1].ends_with("dev:api (Running)"));
        assert!(lines[2].contains("└─ ") && lines[2].ends_with("dev:web (Idle)"));
    }
}
