use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use std::{collections::HashMap, io::ErrorKind, path::Path};

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
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
    pub depends_on_tasks: Option<HashMap<String, Task>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub tasks: HashMap<String, Task>,
}

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON parse error: {0}")]
    Json(#[from] serde_json::Error),
}

impl ConfigError {
    pub fn is_not_found(&self) -> bool {
        matches!(self, ConfigError::Io(e) if e.kind() == ErrorKind::NotFound)
    }
}

impl Config {
    pub async fn load(path: &str) -> Result<Self, ConfigError> {
        let path = Path::new(&path);
        let config = tokio::fs::read_to_string(path.join("task.config.json")).await?;

        Ok(serde_json::from_str(&config)?)
    }

    /// TODO: handle circular task references (this will just be an error as it's a user mistake and we can't fix it)
    pub fn get_task(&self, task_key: String) -> Option<Task> {
        let mut task = if let Some(task) = get_task(&self.tasks, task_key) {
            task.clone()
        } else {
            return None;
        };

        if let Some(depends_on) = &task.depends_on {
            let mut depends_on_tasks = HashMap::new();
            for key in depends_on.iter() {
                let depends_on_task = get_task(&self.tasks, key.clone());
                if let Some(depends_on_task) = depends_on_task {
                    depends_on_tasks.insert(key.clone(), depends_on_task.clone());
                }
            }
            task.depends_on_tasks = Some(depends_on_tasks);
        }

        Some(task)
    }

    pub fn get_all_tasks(&self) -> HashMap<String, Task> {
        get_all_tasks(&self.tasks, None)
    }
}

/// Handles getting nested tasks like `dev:packages` or `dev:server`.
fn get_task(tasks: &HashMap<String, Task>, task_key: String) -> Option<&Task> {
    let task_key_segments = task_key.split(":").collect::<Vec<&str>>();
    if task_key_segments.len() == 0 {
        return None;
    }

    let task = tasks.get(task_key_segments[0])?;
    if task_key_segments.len() == 1 {
        return Some(task); // only looking for one segment so just return the task
    }

    if let Some(tasks) = &task.tasks {
        return get_task(tasks, task_key_segments[1..].join(":"));
    }

    Some(task)
}

fn get_all_tasks(tasks: &HashMap<String, Task>, base_key: Option<String>) -> HashMap<String, Task> {
    let base = base_key.map(|k| k + ":").unwrap_or("".to_string());
    let mut task_keys: HashMap<String, Task> = HashMap::new();
    for (key, task) in tasks.iter() {
        task_keys.insert(format!("{}{}", &base, key), task.clone());
        if let Some(tasks) = &task.tasks {
            task_keys.extend(get_all_tasks(&tasks, Some(format!("{}{}", &base, key))));
        }
    }
    task_keys
}
