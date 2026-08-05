//! Port of the TypeScript TUI's `commands/cancel.ts`.

use std::collections::HashSet;

use anyhow::Result;
use futures_util::future::join_all;

use crate::api::BiziApi;
use crate::cli_task_runs::find_active_runs_in_task_subtree;

pub async fn cancel_command(api: &BiziApi, cwd: &str, task: &str) -> Result<i32> {
    let task_runs = api.list_task_runs(cwd).await?;

    let mut seen_run_ids = HashSet::new();
    let active_runs: Vec<_> = find_active_runs_in_task_subtree(&task_runs, task)
        .into_iter()
        .filter(|run| seen_run_ids.insert(run.id.clone()))
        .collect();

    if active_runs.is_empty() {
        eprintln!("No active runs found for task \"{task}\" or its subtasks.");
        return Ok(1);
    }

    let outcomes = join_all(active_runs.iter().map(|run| async move {
        let cancelled = api.cancel_task(&run.id).await.is_ok();
        (run.id.clone(), cancelled)
    }))
    .await;

    let successful: Vec<&(String, bool)> = outcomes.iter().filter(|(_, ok)| *ok).collect();
    let failed: Vec<&(String, bool)> = outcomes.iter().filter(|(_, ok)| !*ok).collect();

    if !successful.is_empty() {
        println!(
            "Cancelled {}/{} run(s) for \"{task}\" and its subtasks.",
            successful.len(),
            outcomes.len()
        );
    }

    if !failed.is_empty() {
        let failed_run_ids: Vec<&str> = failed.iter().map(|(id, _)| id.as_str()).collect();
        eprintln!(
            "Failed to cancel {} run(s): {}",
            failed.len(),
            failed_run_ids.join(", ")
        );
        return Ok(1);
    }

    Ok(0)
}
