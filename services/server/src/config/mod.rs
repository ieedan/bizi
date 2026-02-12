use crate::db::schema::Task;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, io::ErrorKind, path::{Path, PathBuf}};

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
    pub async fn load(path: String) -> Result<Self, ConfigError> {
        let path = Path::new(&path);
        let config = tokio::fs::read_to_string(path.join("task.config.json")).await?;

        Ok(serde_json::from_str(&config)?)
    }

    pub fn get_task_keys(&self) -> Vec<String> {
        get_task_keys(&self.tasks, None)
    }
}

fn get_task_keys(tasks: &HashMap<String, Task>, base_key: Option<String>) -> Vec<String> {
    let base = base_key.map(|k| k + ".").unwrap_or("".to_string());
    let mut task_keys = Vec::new();
    for (key, task) in tasks.iter() {
        task_keys.push(format!("{}{}", &base, key));
        if let Some(tasks) = &task.tasks {
            task_keys.extend(get_task_keys(&tasks, Some(format!("{}{}", &base, key))));
        }
    }
    task_keys
}