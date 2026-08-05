//! Port of the TypeScript TUI's `lib/cli-task-runs.ts`.

use crate::model::TaskRunTreeNode;

pub fn flatten_task_runs(task_runs: &[TaskRunTreeNode]) -> Vec<&TaskRunTreeNode> {
    let mut flattened = Vec::new();
    for run in task_runs {
        visit(run, &mut flattened);
    }
    flattened
}

fn visit<'a>(node: &'a TaskRunTreeNode, flattened: &mut Vec<&'a TaskRunTreeNode>) {
    flattened.push(node);
    for child in &node.children {
        visit(child, flattened);
    }
}

fn newest_first(mut runs: Vec<&TaskRunTreeNode>) -> Vec<&TaskRunTreeNode> {
    runs.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    runs
}

/// Kept for parity with the TypeScript client surface.
#[allow(dead_code)]
pub fn find_latest_run_by_task_key<'a>(
    task_runs: &'a [TaskRunTreeNode],
    task_key: &str,
) -> Option<&'a TaskRunTreeNode> {
    newest_first(
        flatten_task_runs(task_runs)
            .into_iter()
            .filter(|run| run.task == task_key)
            .collect(),
    )
    .into_iter()
    .next()
}

pub fn find_active_run_by_task_key<'a>(
    task_runs: &'a [TaskRunTreeNode],
    task_key: &str,
) -> Option<&'a TaskRunTreeNode> {
    newest_first(
        flatten_task_runs(task_runs)
            .into_iter()
            .filter(|run| run.task == task_key && run.status.is_active())
            .collect(),
    )
    .into_iter()
    .next()
}

pub fn is_task_in_subtree(task_key: &str, root_task_key: &str) -> bool {
    task_key == root_task_key || task_key.starts_with(&format!("{root_task_key}:"))
}

pub fn find_latest_run_in_task_subtree<'a>(
    task_runs: &'a [TaskRunTreeNode],
    root_task_key: &str,
) -> Option<&'a TaskRunTreeNode> {
    newest_first(
        flatten_task_runs(task_runs)
            .into_iter()
            .filter(|run| is_task_in_subtree(&run.task, root_task_key))
            .collect(),
    )
    .into_iter()
    .next()
}

pub fn find_active_run_in_task_subtree<'a>(
    task_runs: &'a [TaskRunTreeNode],
    root_task_key: &str,
) -> Option<&'a TaskRunTreeNode> {
    find_active_runs_in_task_subtree(task_runs, root_task_key)
        .into_iter()
        .next()
}

pub fn find_active_runs_in_task_subtree<'a>(
    task_runs: &'a [TaskRunTreeNode],
    root_task_key: &str,
) -> Vec<&'a TaskRunTreeNode> {
    newest_first(
        flatten_task_runs(task_runs)
            .into_iter()
            .filter(|run| is_task_in_subtree(&run.task, root_task_key) && run.status.is_active())
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::TaskRunStatus;

    fn run(id: &str, task: &str, status: TaskRunStatus, updated_at: i64) -> TaskRunTreeNode {
        TaskRunTreeNode {
            id: id.to_string(),
            task: task.to_string(),
            cwd: "/tmp".to_string(),
            parent_run_id: None,
            status,
            updated_at,
            waiting_on: None,
            children: Vec::new(),
        }
    }

    fn sample() -> Vec<TaskRunTreeNode> {
        vec![TaskRunTreeNode {
            children: vec![
                run("api", "dev:api", TaskRunStatus::Running, 30),
                run("web", "dev:web", TaskRunStatus::Success, 40),
            ],
            ..run("root", "dev", TaskRunStatus::Running, 10)
        }]
    }

    #[test]
    fn matches_only_the_task_subtree() {
        assert!(is_task_in_subtree("dev", "dev"));
        assert!(is_task_in_subtree("dev:api", "dev"));
        assert!(!is_task_in_subtree("develop", "dev"));
    }

    #[test]
    fn finds_latest_and_active_runs() {
        let runs = sample();
        assert_eq!(
            find_latest_run_in_task_subtree(&runs, "dev").unwrap().id,
            "web"
        );
        assert_eq!(
            find_active_run_in_task_subtree(&runs, "dev").unwrap().id,
            "api"
        );
        assert_eq!(find_active_runs_in_task_subtree(&runs, "dev").len(), 2);
        assert_eq!(
            find_latest_run_by_task_key(&runs, "dev:api").unwrap().id,
            "api"
        );
        assert!(find_active_run_by_task_key(&runs, "dev:web").is_none());
    }
}
