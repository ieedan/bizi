use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

/// Mirrors the server's `TaskRunStatus`. The server serializes these with the
/// default serde variant names so the wire format is `"Queued"`, `"Running"`, …
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum TaskRunStatus {
    Queued,
    Running,
    Success,
    Cancelled,
    Failed,
}

impl TaskRunStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            TaskRunStatus::Queued => "Queued",
            TaskRunStatus::Running => "Running",
            TaskRunStatus::Success => "Success",
            TaskRunStatus::Cancelled => "Cancelled",
            TaskRunStatus::Failed => "Failed",
        }
    }

    pub fn is_active(self) -> bool {
        matches!(self, TaskRunStatus::Queued | TaskRunStatus::Running)
    }

    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            TaskRunStatus::Success | TaskRunStatus::Failed | TaskRunStatus::Cancelled
        )
    }

    pub fn exit_code(self) -> i32 {
        if matches!(self, TaskRunStatus::Success) {
            0
        } else {
            1
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub depends_on: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub optional: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tasks: Option<IndexMap<String, Task>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub depends_on_tasks: Option<IndexMap<String, Task>>,
}

pub type TaskMap = IndexMap<String, Task>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRunTreeNode {
    pub id: String,
    pub task: String,
    #[serde(default)]
    pub cwd: String,
    #[serde(default)]
    pub parent_run_id: Option<String>,
    pub status: TaskRunStatus,
    #[serde(default)]
    pub updated_at: i64,
    #[serde(default)]
    pub waiting_on: Option<String>,
    #[serde(default)]
    pub children: Vec<TaskRunTreeNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRunLogLine {
    pub run_id: String,
    pub task: String,
    pub line: String,
    pub is_stderr: bool,
    pub timestamp: i64,
    pub sequence: u64,
}

/// The status shown for a task row. Parent tasks aggregate their children and
/// become `Indeterminate` when the children disagree.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DisplayTaskStatus {
    Run(TaskRunStatus),
    Indeterminate,
}

impl DisplayTaskStatus {
    pub fn label(self) -> &'static str {
        match self {
            DisplayTaskStatus::Run(status) => status.as_str(),
            DisplayTaskStatus::Indeterminate => "Indeterminate",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogMode {
    Aggregate,
    Selected,
}

impl LogMode {
    pub fn label(self) -> &'static str {
        match self {
            LogMode::Aggregate => "aggregate",
            LogMode::Selected => "selected",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TaskRow {
    pub key: String,
    pub label: String,
    pub depth: usize,
}

#[derive(Debug, Clone)]
pub struct TaskTreeNode {
    pub row: TaskRow,
    pub children: Vec<TaskTreeNode>,
}
