use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct Task {
    /// The title of the task.
    pub title: Option<String>,
    /// The command that the task will run.
    pub command: Option<String>,
    /// Any other task names that this task depends on.
    pub depends_on: Option<Vec<String>>,
    /// Whether the task is optional. If true, the task will only run if started manually.
    pub optional: Option<bool>,
    /// Subtasks of this task. Keys must be unique task names.
    pub tasks: Option<HashMap<String, Task>>,
}
