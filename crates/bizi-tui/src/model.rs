//! Types the TUI works with. Everything that crosses the wire comes from
//! `bizi-api`, the crate the server defines its API with, so a change to the
//! contract is a compile error here rather than a message that silently fails
//! to decode. The rest of this file is view state that never leaves the client.

// `Task` is reached through `TaskMap` in non-test code, so the re-export only
// looks unused outside of tests.
#[allow(unused_imports)]
pub use bizi_api::{Task, TaskMap, TaskRunLogLine, TaskRunStatus, TaskRunTreeNode};

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
