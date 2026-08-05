//! Port of the TypeScript TUI's `lib/task-structure.ts`.

use crate::model::{TaskMap, TaskRow, TaskTreeNode};

pub fn flatten_task_rows(task_tree: &[TaskTreeNode]) -> Vec<TaskRow> {
    let mut rows = Vec::new();
    for node in task_tree {
        visit(node, &mut rows);
    }
    rows
}

fn visit(node: &TaskTreeNode, rows: &mut Vec<TaskRow>) {
    rows.push(node.row.clone());
    for child in &node.children {
        visit(child, rows);
    }
}

pub fn build_task_tree(tasks: &TaskMap) -> Vec<TaskTreeNode> {
    tasks
        .keys()
        .filter(|task_key| !task_key.contains(':'))
        .map(|task_key| build_node(tasks, task_key))
        .collect()
}

fn build_node(tasks: &TaskMap, task_key: &str) -> TaskTreeNode {
    let child_keys = get_direct_child_task_keys(tasks, task_key);
    TaskTreeNode {
        row: create_task_row(task_key),
        children: child_keys
            .iter()
            .map(|child_key| build_node(tasks, child_key))
            .collect(),
    }
}

pub fn find_next_parent_task_index(task_rows: &[TaskRow], current_index: usize) -> usize {
    for (index, row) in task_rows.iter().enumerate().skip(current_index + 1) {
        if row.depth == 0 {
            return index;
        }
    }
    current_index
}

pub fn find_previous_parent_task_index(task_rows: &[TaskRow], current_index: usize) -> usize {
    for (index, row) in task_rows.iter().enumerate().take(current_index).rev() {
        if row.depth == 0 {
            return index;
        }
    }
    current_index
}

pub fn get_direct_child_task_keys(tasks: &TaskMap, task_key: &str) -> Vec<String> {
    let Some(task) = tasks.get(task_key) else {
        return Vec::new();
    };
    let Some(child_tasks) = task.tasks.as_ref() else {
        return Vec::new();
    };

    child_tasks
        .keys()
        .map(|child_key| format!("{task_key}:{child_key}"))
        .filter(|full_key| tasks.contains_key(full_key))
        .collect()
}

fn create_task_row(task_key: &str) -> TaskRow {
    let segments: Vec<&str> = task_key.split(':').collect();
    TaskRow {
        key: task_key.to_string(),
        label: segments.last().copied().unwrap_or(task_key).to_string(),
        depth: segments.len().saturating_sub(1),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Task;
    use indexmap::IndexMap;

    fn task_with_children(children: &[&str]) -> Task {
        let mut child_map = IndexMap::new();
        for child in children {
            child_map.insert((*child).to_string(), Task::default());
        }
        Task {
            tasks: Some(child_map),
            ..Task::default()
        }
    }

    fn sample_tasks() -> TaskMap {
        let mut tasks: TaskMap = IndexMap::new();
        tasks.insert("dev".to_string(), task_with_children(&["api", "web"]));
        tasks.insert("dev:api".to_string(), Task::default());
        tasks.insert("dev:web".to_string(), Task::default());
        tasks.insert("build".to_string(), Task::default());
        tasks
    }

    #[test]
    fn builds_a_tree_in_config_order() {
        let tree = build_task_tree(&sample_tasks());
        assert_eq!(tree.len(), 2);
        assert_eq!(tree[0].row.key, "dev");
        assert_eq!(tree[0].children.len(), 2);
        assert_eq!(tree[1].row.key, "build");
    }

    #[test]
    fn flattens_rows_depth_first() {
        let rows = flatten_task_rows(&build_task_tree(&sample_tasks()));
        let keys: Vec<&str> = rows.iter().map(|row| row.key.as_str()).collect();
        assert_eq!(keys, vec!["dev", "dev:api", "dev:web", "build"]);
        assert_eq!(rows[1].depth, 1);
        assert_eq!(rows[1].label, "api");
    }

    #[test]
    fn jumps_between_parent_rows() {
        let rows = flatten_task_rows(&build_task_tree(&sample_tasks()));
        assert_eq!(find_next_parent_task_index(&rows, 0), 3);
        assert_eq!(find_next_parent_task_index(&rows, 3), 3);
        assert_eq!(find_previous_parent_task_index(&rows, 3), 0);
        assert_eq!(find_previous_parent_task_index(&rows, 0), 0);
    }

    #[test]
    fn ignores_child_keys_without_a_flattened_entry() {
        let mut tasks: TaskMap = IndexMap::new();
        tasks.insert("dev".to_string(), task_with_children(&["ghost"]));
        assert!(get_direct_child_task_keys(&tasks, "dev").is_empty());
    }
}
