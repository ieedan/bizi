//! Port of the TypeScript TUI's `lib/task-runs.ts`.

use std::collections::HashMap;

use crate::model::{DisplayTaskStatus, TaskMap, TaskRunStatus, TaskRunTreeNode};
use crate::task_structure::get_direct_child_task_keys;

pub type RunByTaskKey = HashMap<String, TaskRunTreeNode>;
pub type DisplayStatusByTaskKey = HashMap<String, Option<DisplayTaskStatus>>;

/// Indexes runs by their canonical task key, preferring the run whose subtree
/// saw the most recent activity.
pub fn index_runs_by_task_key(task_runs: &[TaskRunTreeNode]) -> RunByTaskKey {
    let mut best: HashMap<String, (TaskRunTreeNode, i64)> = HashMap::new();
    for run in task_runs {
        visit(run, &mut best);
    }
    best.into_iter()
        .map(|(task_key, (run, _))| (task_key, run))
        .collect()
}

fn visit(run: &TaskRunTreeNode, best: &mut HashMap<String, (TaskRunTreeNode, i64)>) -> i64 {
    let mut last_activity_at = run.updated_at;
    for child in &run.children {
        last_activity_at = last_activity_at.max(visit(child, best));
    }

    // The server stores canonical task keys on each run (including children),
    // so using run.task directly avoids duplicating parent prefixes.
    match best.get(&run.task) {
        Some((_, existing_activity)) if *existing_activity >= last_activity_at => {}
        _ => {
            best.insert(run.task.clone(), (run.clone(), last_activity_at));
        }
    }

    last_activity_at
}

/// Replaces `updated_run` wherever it appears in the tree, appending it as a new
/// root when it is not already present, then re-sorts roots by recency.
pub fn upsert_run_tree_node(roots: &mut Vec<TaskRunTreeNode>, updated_run: TaskRunTreeNode) {
    let mut replaced = false;
    for root in roots.iter_mut() {
        if replace_run_tree_node(root, &updated_run) {
            replaced = true;
        }
    }

    if !replaced {
        roots.push(updated_run);
    }

    roots.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
}

fn replace_run_tree_node(node: &mut TaskRunTreeNode, updated_run: &TaskRunTreeNode) -> bool {
    if node.id == updated_run.id {
        *node = updated_run.clone();
        return true;
    }

    let mut replaced = false;
    for child in node.children.iter_mut() {
        if replace_run_tree_node(child, updated_run) {
            replaced = true;
        }
    }
    replaced
}

pub fn build_display_status_by_task_key(
    tasks: &TaskMap,
    run_by_task_key: &RunByTaskKey,
) -> DisplayStatusByTaskKey {
    let mut cache: DisplayStatusByTaskKey = HashMap::new();
    for task_key in tasks.keys() {
        resolve_status(tasks, run_by_task_key, task_key, &mut cache);
    }
    cache
}

fn resolve_status(
    tasks: &TaskMap,
    run_by_task_key: &RunByTaskKey,
    task_key: &str,
    cache: &mut DisplayStatusByTaskKey,
) -> Option<DisplayTaskStatus> {
    if let Some(cached) = cache.get(task_key) {
        return *cached;
    }

    let child_keys = get_direct_child_task_keys(tasks, task_key);
    if child_keys.is_empty() {
        let own_status = run_by_task_key
            .get(task_key)
            .map(|run| DisplayTaskStatus::Run(run.status));
        cache.insert(task_key.to_string(), own_status);
        return own_status;
    }

    let child_statuses: Vec<Option<DisplayTaskStatus>> = child_keys
        .iter()
        .map(|child_key| resolve_status(tasks, run_by_task_key, child_key, cache))
        .collect();
    let first = child_statuses[0];
    let all_agree = child_statuses.iter().all(|status| *status == first);
    let status = if all_agree {
        first
    } else {
        Some(DisplayTaskStatus::Indeterminate)
    };
    cache.insert(task_key.to_string(), status);
    status
}

pub fn can_cancel_run(run: &TaskRunTreeNode) -> bool {
    if run.status == TaskRunStatus::Cancelled {
        return false;
    }

    let is_leaf_run = run.children.is_empty();
    if !is_leaf_run {
        return true;
    }

    run.status != TaskRunStatus::Success && run.status != TaskRunStatus::Failed
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Task;
    use indexmap::IndexMap;

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

    #[test]
    fn indexes_the_most_recently_active_run_per_task() {
        let mut newer = run("2", "dev", TaskRunStatus::Running, 5);
        newer.children = vec![run("3", "dev:api", TaskRunStatus::Running, 50)];
        let runs = vec![run("1", "dev", TaskRunStatus::Success, 20), newer];

        let indexed = index_runs_by_task_key(&runs);
        assert_eq!(indexed.get("dev").unwrap().id, "2");
        assert_eq!(indexed.get("dev:api").unwrap().id, "3");
    }

    #[test]
    fn upserts_nested_runs_and_appends_unknown_ones() {
        let mut roots = vec![TaskRunTreeNode {
            children: vec![run("child", "dev:api", TaskRunStatus::Queued, 1)],
            ..run("root", "dev", TaskRunStatus::Running, 2)
        }];

        upsert_run_tree_node(
            &mut roots,
            run("child", "dev:api", TaskRunStatus::Success, 9),
        );
        assert_eq!(roots.len(), 1);
        assert_eq!(roots[0].children[0].status, TaskRunStatus::Success);

        upsert_run_tree_node(
            &mut roots,
            run("other", "build", TaskRunStatus::Running, 99),
        );
        assert_eq!(roots.len(), 2);
        assert_eq!(roots[0].id, "other", "roots are sorted newest first");
    }

    #[test]
    fn aggregates_child_statuses_into_the_parent() {
        let mut child_map = IndexMap::new();
        child_map.insert("api".to_string(), Task::default());
        child_map.insert("web".to_string(), Task::default());

        let mut tasks: TaskMap = IndexMap::new();
        tasks.insert(
            "dev".to_string(),
            Task {
                tasks: Some(child_map),
                ..Task::default()
            },
        );
        tasks.insert("dev:api".to_string(), Task::default());
        tasks.insert("dev:web".to_string(), Task::default());

        let mut run_by_task_key: RunByTaskKey = HashMap::new();
        run_by_task_key.insert(
            "dev:api".to_string(),
            run("a", "dev:api", TaskRunStatus::Running, 1),
        );
        run_by_task_key.insert(
            "dev:web".to_string(),
            run("b", "dev:web", TaskRunStatus::Running, 1),
        );

        let statuses = build_display_status_by_task_key(&tasks, &run_by_task_key);
        assert_eq!(
            statuses.get("dev"),
            Some(&Some(DisplayTaskStatus::Run(TaskRunStatus::Running)))
        );

        run_by_task_key.insert(
            "dev:web".to_string(),
            run("b", "dev:web", TaskRunStatus::Failed, 1),
        );
        let statuses = build_display_status_by_task_key(&tasks, &run_by_task_key);
        assert_eq!(
            statuses.get("dev"),
            Some(&Some(DisplayTaskStatus::Indeterminate))
        );
    }

    #[test]
    fn only_cancels_runs_that_are_still_cancellable() {
        assert!(can_cancel_run(&run("1", "dev", TaskRunStatus::Running, 0)));
        assert!(!can_cancel_run(&run(
            "1",
            "dev",
            TaskRunStatus::Cancelled,
            0
        )));
        assert!(!can_cancel_run(&run("1", "dev", TaskRunStatus::Success, 0)));

        let parent = TaskRunTreeNode {
            children: vec![run("child", "dev:api", TaskRunStatus::Success, 0)],
            ..run("1", "dev", TaskRunStatus::Success, 0)
        };
        assert!(can_cancel_run(&parent), "parents stay cancellable");
    }
}
