//! Port of the TypeScript TUI's `commands/init.ts`.

use std::path::{Path, PathBuf};

use anyhow::Result;
use serde_json::{Map, Value, json};

use crate::prompt::{
    self, MultiSelectOption, PromptResult, cancel, intro, log_error, log_success, outro,
};

const KNOWN_NPM_HOOKS: [&str; 24] = [
    "prepare",
    "prepublish",
    "prepublishOnly",
    "prepack",
    "postpack",
    "publish",
    "postpublish",
    "preinstall",
    "install",
    "postinstall",
    "preuninstall",
    "uninstall",
    "postuninstall",
    "preversion",
    "version",
    "postversion",
    "pretest",
    "posttest",
    "prestart",
    "poststart",
    "prerestart",
    "postrestart",
    "prestop",
    "stop",
];

const SCHEMA_URL: &str = "https://getbizi.dev/schemas/task.config.json";

pub async fn init_command(cwd: &str) -> Result<i32> {
    let config_path = Path::new(cwd).join("task.config.json");

    intro("bizi init");

    if file_exists(&config_path).await {
        log_error("task.config.json already exists in this directory.");
        outro("Init failed.");
        return Ok(1);
    }

    let is_interactive = prompt::is_interactive();
    let package_json_path = Path::new(cwd).join("package.json");
    let package_json_exists = file_exists(&package_json_path).await;

    let mut selected_scripts: Vec<String> = Vec::new();
    let mut scripts: Vec<(String, String)> = Vec::new();

    if is_interactive && package_json_exists {
        scripts = read_package_json_scripts(&package_json_path).await;
        let eligible_scripts: Vec<(String, String)> = scripts
            .iter()
            .filter(|(name, _)| !KNOWN_NPM_HOOKS.contains(&name.as_str()))
            .cloned()
            .collect();

        let should_bring_scripts = tokio::task::spawn_blocking(|| {
            prompt::confirm("Should we bring scripts over from your package.json?", true)
        })
        .await??;

        let should_bring_scripts = match should_bring_scripts {
            PromptResult::Cancelled => {
                cancel("Operation cancelled.");
                outro("Init cancelled.");
                return Ok(0);
            }
            PromptResult::Value(value) => value,
        };

        if should_bring_scripts && !eligible_scripts.is_empty() {
            let options: Vec<MultiSelectOption> = eligible_scripts
                .iter()
                .map(|(name, command)| MultiSelectOption {
                    value: name.clone(),
                    label: name.clone(),
                    hint: Some(command.clone()),
                })
                .collect();
            let initial_values: Vec<String> = eligible_scripts
                .iter()
                .map(|(name, _)| name.clone())
                .collect();

            let selected = tokio::task::spawn_blocking(move || {
                prompt::multiselect(
                    "Which scripts should we bring over from your package.json?",
                    &options,
                    &initial_values,
                )
            })
            .await??;

            match selected {
                PromptResult::Cancelled => {
                    cancel("Operation cancelled.");
                    outro("Init cancelled.");
                    return Ok(0);
                }
                PromptResult::Value(values) => selected_scripts = values,
            }
        }
    }

    let config = if selected_scripts.is_empty() {
        starter_template()
    } else {
        build_config_from_scripts(&scripts, &selected_scripts)
    };

    tokio::fs::write(
        &config_path,
        format!("{}\n", serde_json::to_string_pretty(&config)?),
    )
    .await?;

    log_success("Created task.config.json.");
    outro("You're all set!");
    Ok(0)
}

async fn file_exists(path: &PathBuf) -> bool {
    tokio::fs::metadata(path).await.is_ok()
}

async fn read_package_json_scripts(path: &PathBuf) -> Vec<(String, String)> {
    let Ok(content) = tokio::fs::read_to_string(path).await else {
        return Vec::new();
    };
    let Ok(parsed) = serde_json::from_str::<Value>(&content) else {
        return Vec::new();
    };
    let Some(scripts) = parsed.get("scripts").and_then(Value::as_object) else {
        return Vec::new();
    };

    scripts
        .iter()
        .filter_map(|(name, command)| {
            command
                .as_str()
                .map(|command| (name.clone(), command.to_string()))
        })
        .collect()
}

fn starter_template() -> Value {
    json!({
        "$schema": SCHEMA_URL,
        "tasks": {
            "hello-world": {
                "tasks": {
                    "hello": { "command": "echo Hello," },
                    "world": {
                        "command": "echo World!",
                        "dependsOn": ["hello-world:hello"]
                    }
                }
            }
        }
    })
}

fn build_config_from_scripts(scripts: &[(String, String)], selected_scripts: &[String]) -> Value {
    let mut tasks = Map::new();
    for name in selected_scripts {
        if let Some((_, command)) = scripts.iter().find(|(script, _)| script == name) {
            tasks.insert(name.clone(), json!({ "command": command }));
        }
    }

    let mut config = Map::new();
    config.insert("$schema".to_string(), Value::String(SCHEMA_URL.to_string()));
    config.insert("tasks".to_string(), Value::Object(tasks));
    Value::Object(config)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn starter_template_matches_the_documented_shape() {
        let rendered = serde_json::to_string_pretty(&starter_template()).unwrap();
        assert!(
            rendered
                .starts_with("{\n  \"$schema\": \"https://getbizi.dev/schemas/task.config.json\",")
        );
        assert!(rendered.contains("\"hello-world\""));
        assert!(
            rendered.contains("\"dependsOn\": [\n            \"hello-world:hello\"\n          ]")
        );
    }

    #[test]
    fn builds_a_config_from_the_selected_scripts_in_order() {
        let scripts = vec![
            ("dev".to_string(), "vite".to_string()),
            ("build".to_string(), "vite build".to_string()),
        ];
        let config = build_config_from_scripts(&scripts, &["build".to_string(), "dev".to_string()]);
        let rendered = serde_json::to_string(&config).unwrap();
        assert_eq!(
            rendered,
            r#"{"$schema":"https://getbizi.dev/schemas/task.config.json","tasks":{"build":{"command":"vite build"},"dev":{"command":"vite"}}}"#
        );
    }
}
