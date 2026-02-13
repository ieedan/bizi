use std::collections::{HashMap, HashSet};
use std::process::Stdio;

use axum::{
    Json,
    extract::{
        Path, Query, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::StatusCode,
    response::{IntoResponse, Response},
};
use futures_util::StreamExt;
use nanoid::nanoid;
use sea_orm::{
    ActiveModelTrait,
    ActiveValue::{NotSet, Set},
    ColumnTrait, DatabaseConnection, DbErr, EntityTrait, IntoActiveModel, QueryFilter, QueryOrder,
};
use serde::{Deserialize, Serialize};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::Command,
    sync::{Mutex, broadcast, oneshot},
};
use utoipa::ToSchema;

use crate::{
    api::{AppState, error::ErrorResponse},
    config::{Config, Task},
    db::entities::{
        task_run::{self, TaskRunStatus},
        task_run_log,
    },
};

const TASK_RUN_ID_ALPHABET: [char; 63] = [
    '_', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h',
    'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z', 'A',
    'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T',
    'U', 'V', 'W', 'X', 'Y', 'Z',
];

#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListTasksRequest {
    #[schema(example = "/Users/johndoe/documents/github/example-project")]
    pub cwd: String,
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListTaskRunsRequest {
    #[schema(example = "/Users/johndoe/documents/github/example-project")]
    pub cwd: String,
}
#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListTasksResponseBody {
    /// The list of tasks that are defined in the task.config.json file
    pub tasks: HashMap<String, Task>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListTaskRunsResponseBody {
    /// Root task runs for the cwd, each containing nested child runs.
    pub task_runs: Vec<TaskRunTreeNode>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(untagged)]
pub enum ListTasksResponse {
    Success(ListTasksResponseBody),
    Error(ErrorResponse),
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(untagged)]
pub enum ListTaskRunsResponse {
    Success(ListTaskRunsResponseBody),
    Error(ErrorResponse),
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskRunTreeNode {
    pub id: String,
    pub task: String,
    pub cwd: String,
    pub parent_run_id: Option<String>,
    pub status: TaskRunStatus,
    pub updated_at: i64,
    pub waiting_on: Option<String>,
    pub children: Vec<TaskRunTreeNode>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GetTaskRunResponseBody {
    pub task_run: TaskRunTreeNode,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(untagged)]
pub enum GetTaskRunResponse {
    Success(GetTaskRunResponseBody),
    Error(ErrorResponse),
}

#[utoipa::path(
    get,
    path = "/api/tasks",
    params(
        ("cwd" = String, Query, description = "The current working directory to load the task config from"),
    ),
    responses(
        (status = 200, description = "Success", body = ListTasksResponse),
        (status = 404, description = "Not Found", body = ErrorResponse),
        (status = 500, description = "Internal Server Error", body = ErrorResponse),
    )
)]
pub async fn list_tasks(
    State(_state): State<AppState>,
    Query(payload): Query<ListTasksRequest>,
) -> (StatusCode, Json<ListTasksResponse>) {
    let config = match Config::load(&payload.cwd).await {
        Ok(config) => config,
        Err(e) => {
            if e.is_not_found() {
                return (
                    StatusCode::NOT_FOUND,
                    Json(ListTasksResponse::Error(ErrorResponse {
                        message: "Task config file not found".to_string(),
                    })),
                );
            }

            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ListTasksResponse::Error(ErrorResponse {
                    message: "Failed to load task config file".to_string(),
                })),
            );
        }
    };

    (
        StatusCode::OK,
        Json(ListTasksResponse::Success(ListTasksResponseBody {
            tasks: config.get_all_tasks(),
        })),
    )
}

#[utoipa::path(
    get,
    path = "/api/tasks/runs",
    params(
        ("cwd" = String, Query, description = "The current working directory to load task runs from"),
    ),
    responses(
        (status = 200, description = "Success", body = ListTaskRunsResponse),
        (status = 500, description = "Internal Server Error", body = ErrorResponse),
    )
)]
pub async fn list_task_runs(
    State(state): State<AppState>,
    Query(payload): Query<ListTaskRunsRequest>,
) -> (StatusCode, Json<ListTaskRunsResponse>) {
    let all_runs = match task_run::Entity::find()
        .filter(task_run::Column::Cwd.eq(payload.cwd.clone()))
        .all(&state.db)
        .await
    {
        Ok(runs) => runs,
        Err(_) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ListTaskRunsResponse::Error(ErrorResponse {
                    message: "Failed to load task runs".to_string(),
                })),
            );
        }
    };

    let mut runs_by_id = HashMap::new();
    let mut children_by_parent: HashMap<String, Vec<String>> = HashMap::new();
    let mut root_run_ids = Vec::new();
    for run in all_runs {
        if let Some(parent_run_id) = run.parent_run_id.clone() {
            children_by_parent
                .entry(parent_run_id)
                .or_default()
                .push(run.id.clone());
        } else {
            root_run_ids.push(run.id.clone());
        }
        runs_by_id.insert(run.id.clone(), run);
    }

    let mut task_runs = root_run_ids
        .into_iter()
        .filter_map(|run_id| build_task_run_tree(&run_id, &runs_by_id, &children_by_parent))
        .collect::<Vec<_>>();
    task_runs.sort_by_key(|task_run| std::cmp::Reverse(task_run.updated_at));

    (
        StatusCode::OK,
        Json(ListTaskRunsResponse::Success(ListTaskRunsResponseBody {
            task_runs,
        })),
    )
}

#[utoipa::path(
    get,
    path = "/api/tasks/{run_id}",
    params(
        ("run_id" = String, Path, description = "The task run id"),
    ),
    responses(
        (status = 200, description = "Success", body = GetTaskRunResponse),
        (status = 404, description = "Not Found", body = ErrorResponse),
        (status = 500, description = "Internal Server Error", body = ErrorResponse),
    )
)]
pub async fn get_task_run(
    State(state): State<AppState>,
    Path(run_id): Path<String>,
    ws: Option<WebSocketUpgrade>,
) -> Response {
    if let Some(ws) = ws {
        return ws
            .on_upgrade(move |socket| stream_task_run_updates(socket, state, run_id))
            .into_response();
    }

    match load_task_run_tree(&state, &run_id).await {
        Ok(Some(task_run)) => (
            StatusCode::OK,
            Json(GetTaskRunResponse::Success(GetTaskRunResponseBody {
                task_run,
            })),
        )
            .into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(GetTaskRunResponse::Error(ErrorResponse {
                message: "Task run not found".to_string(),
            })),
        )
            .into_response(),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(GetTaskRunResponse::Error(ErrorResponse {
                message: "Failed to load task run".to_string(),
            })),
        )
            .into_response(),
    }
}

#[utoipa::path(
    get,
    path = "/api/tasks/{run_id}/logs",
    params(
        ("run_id" = String, Path, description = "The task run id"),
        ("includeChildren" = Option<bool>, Query, description = "Whether to include logs from descendant task runs"),
    ),
    responses(
        (status = 200, description = "Success", body = GetTaskRunLogsResponse),
        (status = 404, description = "Not Found", body = ErrorResponse),
        (status = 500, description = "Internal Server Error", body = ErrorResponse),
    )
)]
pub async fn get_task_run_logs(
    State(state): State<AppState>,
    Path(run_id): Path<String>,
    Query(payload): Query<GetTaskRunLogsRequest>,
    ws: Option<WebSocketUpgrade>,
) -> Response {
    let include_children = payload.include_children.unwrap_or(false);

    if let Some(ws) = ws {
        return ws
            .on_upgrade(move |socket| stream_task_run_logs(socket, state, run_id, include_children))
            .into_response();
    }

    match load_task_run_logs(&state, &run_id, include_children).await {
        Ok(Some(logs)) => (
            StatusCode::OK,
            Json(GetTaskRunLogsResponse::Success(
                GetTaskRunLogsResponseBody { run_id, logs },
            )),
        )
            .into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(GetTaskRunLogsResponse::Error(ErrorResponse {
                message: "Task run not found".to_string(),
            })),
        )
            .into_response(),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(GetTaskRunLogsResponse::Error(ErrorResponse {
                message: "Failed to load task run logs".to_string(),
            })),
        )
            .into_response(),
    }
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StartTaskRequest {
    pub task: String,
    pub cwd: String,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StartTaskResponseBody {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(untagged)]
pub enum StartTaskResponse {
    Success(StartTaskResponseBody),
    Error(ErrorResponse),
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CancelTaskRequest {
    pub run_id: String,
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RestartTaskRequest {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CancelTaskResponseBody {
    pub cancelled_run_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(untagged)]
pub enum CancelTaskResponse {
    Success(CancelTaskResponseBody),
    Error(ErrorResponse),
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RestartTaskResponseBody {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(untagged)]
pub enum RestartTaskResponse {
    Success(RestartTaskResponseBody),
    Error(ErrorResponse),
}

#[derive(Debug, Clone)]
pub struct TaskRunStatusChangedEvent {
    pub run_id: String,
    pub task: String,
    pub cwd: String,
    pub status: TaskRunStatus,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskRunLogLine {
    pub run_id: String,
    pub task: String,
    pub line: String,
    pub is_stderr: bool,
    pub timestamp: i64,
    pub sequence: u64,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GetTaskRunLogsResponseBody {
    pub run_id: String,
    pub logs: Vec<TaskRunLogLine>,
}

#[derive(Debug, Clone, Deserialize, ToSchema, Default)]
#[serde(rename_all = "camelCase")]
pub struct GetTaskRunLogsRequest {
    pub include_children: Option<bool>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(untagged)]
pub enum GetTaskRunLogsResponse {
    Success(GetTaskRunLogsResponseBody),
    Error(ErrorResponse),
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum TaskRunLogsStreamMessage {
    Snapshot {
        run_id: String,
        logs: Vec<TaskRunLogLine>,
    },
    Log {
        log: TaskRunLogLine,
    },
    Error {
        message: String,
    },
}

#[utoipa::path(
    post,
    path = "/api/tasks/run",
    request_body = StartTaskRequest,
    responses(
        (status = 200, description = "Success", body = StartTaskResponse),
        (status = 404, description = "Not Found", body = ErrorResponse),
        (status = 500, description = "Internal Server Error", body = ErrorResponse),
    )
)]
pub async fn run_task(
    State(state): State<AppState>,
    Json(payload): Json<StartTaskRequest>,
) -> (StatusCode, Json<StartTaskResponse>) {
    let config = match Config::load(&payload.cwd).await {
        Ok(config) => config,
        Err(e) => {
            if e.is_not_found() {
                return (
                    StatusCode::NOT_FOUND,
                    Json(StartTaskResponse::Error(ErrorResponse {
                        message: "Task config file not found".to_string(),
                    })),
                );
            }

            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(StartTaskResponse::Error(ErrorResponse {
                    message: "Failed to load task config file".to_string(),
                })),
            );
        }
    };

    let task = match config.get_task(payload.task.clone()) {
        Some(task) => task,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(StartTaskResponse::Error(ErrorResponse {
                    message: "Task not found".to_string(),
                })),
            );
        }
    };

    let existing_running_run_id =
        match find_existing_running_run_id(&state, &payload.cwd, &payload.task, &task).await {
            Ok(existing_run_id) => existing_run_id,
            Err(_) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(StartTaskResponse::Error(ErrorResponse {
                        message: "Failed to load existing task runs".to_string(),
                    })),
                );
            }
        };

    if let Some(run_id) = existing_running_run_id {
        return (
            StatusCode::OK,
            Json(StartTaskResponse::Success(StartTaskResponseBody { run_id })),
        );
    }

    let task_run = match create_task_run(
        &state,
        payload.task.clone(),
        task,
        payload.cwd.clone(),
        None,
    )
    .await
    {
        Ok(inserted) => inserted,
        Err(_) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(StartTaskResponse::Error(ErrorResponse {
                    message: "Failed to insert task run".to_string(),
                })),
            );
        }
    };

    (
        StatusCode::OK,
        Json(StartTaskResponse::Success(StartTaskResponseBody {
            run_id: task_run.id,
        })),
    )
}

#[utoipa::path(
    post,
    path = "/api/tasks/cancel",
    request_body = CancelTaskRequest,
    responses(
        (status = 200, description = "Success", body = CancelTaskResponse),
        (status = 404, description = "Not Found", body = ErrorResponse),
        (status = 500, description = "Internal Server Error", body = ErrorResponse),
    )
)]
pub async fn cancel_task(
    State(state): State<AppState>,
    Json(payload): Json<CancelTaskRequest>,
) -> (StatusCode, Json<CancelTaskResponse>) {
    let task_run = match task_run::Entity::find_by_id(payload.run_id.clone())
        .one(&state.db)
        .await
    {
        Ok(Some(task_run)) => task_run,
        Ok(None) => {
            return (
                StatusCode::NOT_FOUND,
                Json(CancelTaskResponse::Error(ErrorResponse {
                    message: "Task run not found".to_string(),
                })),
            );
        }
        Err(_) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(CancelTaskResponse::Error(ErrorResponse {
                    message: "Failed to load task run".to_string(),
                })),
            );
        }
    };

    let all_runs = match task_run::Entity::find()
        .filter(task_run::Column::Cwd.eq(task_run.cwd.clone()))
        .all(&state.db)
        .await
    {
        Ok(runs) => runs,
        Err(_) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(CancelTaskResponse::Error(ErrorResponse {
                    message: "Failed to load child task runs".to_string(),
                })),
            );
        }
    };

    let run_ids_to_cancel = collect_descendant_run_ids(&all_runs, &payload.run_id);

    if let Err(_) = cancel_task_runs(&state, &run_ids_to_cancel).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(CancelTaskResponse::Error(ErrorResponse {
                message: "Failed to cancel task runs".to_string(),
            })),
        );
    }

    (
        StatusCode::OK,
        Json(CancelTaskResponse::Success(CancelTaskResponseBody {
            cancelled_run_ids: run_ids_to_cancel,
        })),
    )
}

#[utoipa::path(
    post,
    path = "/api/tasks/restart",
    request_body = RestartTaskRequest,
    responses(
        (status = 200, description = "Success", body = RestartTaskResponse),
        (status = 404, description = "Not Found", body = ErrorResponse),
        (status = 500, description = "Internal Server Error", body = ErrorResponse),
    )
)]
pub async fn restart_task(
    State(state): State<AppState>,
    Json(payload): Json<RestartTaskRequest>,
) -> (StatusCode, Json<RestartTaskResponse>) {
    let task_run = match task_run::Entity::find_by_id(payload.run_id.clone())
        .one(&state.db)
        .await
    {
        Ok(Some(task_run)) => task_run,
        Ok(None) => {
            return (
                StatusCode::NOT_FOUND,
                Json(RestartTaskResponse::Error(ErrorResponse {
                    message: "Task run not found".to_string(),
                })),
            );
        }
        Err(_) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(RestartTaskResponse::Error(ErrorResponse {
                    message: "Failed to load task run".to_string(),
                })),
            );
        }
    };

    let config = match Config::load(&task_run.cwd).await {
        Ok(config) => config,
        Err(e) => {
            if e.is_not_found() {
                return (
                    StatusCode::NOT_FOUND,
                    Json(RestartTaskResponse::Error(ErrorResponse {
                        message: "Task config file not found".to_string(),
                    })),
                );
            }

            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(RestartTaskResponse::Error(ErrorResponse {
                    message: "Failed to load task config file".to_string(),
                })),
            );
        }
    };

    let root_task = match config.get_task(task_run.task.clone()) {
        Some(task) => task,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(RestartTaskResponse::Error(ErrorResponse {
                    message: "Task not found".to_string(),
                })),
            );
        }
    };

    let all_runs = match task_run::Entity::find()
        .filter(task_run::Column::Cwd.eq(task_run.cwd.clone()))
        .all(&state.db)
        .await
    {
        Ok(runs) => runs,
        Err(_) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(RestartTaskResponse::Error(ErrorResponse {
                    message: "Failed to load child task runs".to_string(),
                })),
            );
        }
    };

    let run_ids_to_cancel = collect_descendant_run_ids(&all_runs, &payload.run_id);
    if let Err(_) = cancel_task_runs(&state, &run_ids_to_cancel).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(RestartTaskResponse::Error(ErrorResponse {
                message: "Failed to cancel task runs".to_string(),
            })),
        );
    }

    if let Err(_) = clear_task_run_logs_for_restart(&state, &run_ids_to_cancel).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(RestartTaskResponse::Error(ErrorResponse {
                message: "Failed to clear task run logs for restart".to_string(),
            })),
        );
    }

    if let Err(_) = prepare_task_runs_for_restart(
        &state,
        &config,
        &all_runs,
        &payload.run_id,
        &run_ids_to_cancel,
    )
    .await
    {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(RestartTaskResponse::Error(ErrorResponse {
                message: "Failed to prepare task runs for restart".to_string(),
            })),
        );
    }

    let root_waiting_on = match task_run::Entity::find_by_id(payload.run_id.clone())
        .one(&state.db)
        .await
    {
        Ok(Some(task_run)) => task_run.waiting_on,
        Ok(None) => {
            return (
                StatusCode::NOT_FOUND,
                Json(RestartTaskResponse::Error(ErrorResponse {
                    message: "Task run not found".to_string(),
                })),
            );
        }
        Err(_) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(RestartTaskResponse::Error(ErrorResponse {
                    message: "Failed to load restarted task run".to_string(),
                })),
            );
        }
    };

    if root_waiting_on.is_none() {
        start_task_run_execution(
            state.clone(),
            task_run.id.clone(),
            task_run.task.clone(),
            task_run.cwd.clone(),
            root_task.command.clone(),
        );
    }

    (
        StatusCode::OK,
        Json(RestartTaskResponse::Success(RestartTaskResponseBody {
            run_id: task_run.id,
        })),
    )
}

pub fn spawn_task_completion_listener(state: AppState) {
    let mut events = state.task_events.subscribe();

    tokio::spawn(async move {
        loop {
            match events.recv().await {
                Ok(event) => {
                    if event.status != TaskRunStatus::Success {
                        continue;
                    }

                    if let Err(err) = trigger_waiting_task_runs(&state, &event).await {
                        eprintln!(
                            "Failed to trigger waiting task runs for {}: {}",
                            event.task, err
                        );
                    }

                    if let Err(err) = trigger_subtasks(&state, &event).await {
                        eprintln!("Failed to trigger subtasks for {}: {}", event.task, err);
                    }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => {}
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });
}

async fn stream_task_run_updates(mut socket: WebSocket, state: AppState, run_id: String) {
    // Subscribe first so status transitions cannot be missed between
    // initial snapshot and entering the receive loop.
    let mut task_events = state.task_events.subscribe();

    if send_task_run_snapshot(&mut socket, &state, &run_id)
        .await
        .is_err()
    {
        return;
    }

    loop {
        tokio::select! {
            next_message = socket.next() => {
                match next_message {
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(Message::Ping(payload))) => {
                        if socket.send(Message::Pong(payload)).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(_)) => {}
                    Some(Err(_)) => break,
                }
            }
            event = task_events.recv() => match event {
                Ok(_) | Err(broadcast::error::RecvError::Lagged(_)) => {
                    if send_task_run_snapshot(&mut socket, &state, &run_id).await.is_err() {
                        break;
                    }
                }
                Err(broadcast::error::RecvError::Closed) => break,
            },
        }
    }
}

async fn stream_task_run_logs(
    mut socket: WebSocket,
    state: AppState,
    run_id: String,
    include_children: bool,
) {
    // Subscribe first so we do not miss new log lines while sending snapshot.
    let mut log_events = state.task_log_events.subscribe();

    let existing_logs = match load_task_run_logs(&state, &run_id, include_children).await {
        Ok(Some(logs)) => logs,
        Ok(None) => {
            let payload = TaskRunLogsStreamMessage::Error {
                message: "Task run not found".to_string(),
            };
            let _ = send_ws_json(&mut socket, &payload).await;
            let _ = socket.send(Message::Close(None)).await;
            return;
        }
        Err(_) => {
            let payload = TaskRunLogsStreamMessage::Error {
                message: "Failed to load task run logs".to_string(),
            };
            let _ = send_ws_json(&mut socket, &payload).await;
            let _ = socket.send(Message::Close(None)).await;
            return;
        }
    };

    let mut included_run_ids = if include_children {
        match load_descendant_run_ids(&state, &run_id).await {
            Ok(Some(run_ids)) => run_ids,
            Ok(None) => {
                let payload = TaskRunLogsStreamMessage::Error {
                    message: "Task run not found".to_string(),
                };
                let _ = send_ws_json(&mut socket, &payload).await;
                let _ = socket.send(Message::Close(None)).await;
                return;
            }
            Err(_) => {
                let payload = TaskRunLogsStreamMessage::Error {
                    message: "Failed to load task run logs".to_string(),
                };
                let _ = send_ws_json(&mut socket, &payload).await;
                let _ = socket.send(Message::Close(None)).await;
                return;
            }
        }
    } else {
        HashSet::from([run_id.clone()])
    };

    let mut latest_sequence = existing_logs.last().map(|log| log.sequence).unwrap_or(0);
    let snapshot = TaskRunLogsStreamMessage::Snapshot {
        run_id: run_id.clone(),
        logs: existing_logs,
    };
    if send_ws_json(&mut socket, &snapshot).await.is_err() {
        return;
    }

    loop {
        tokio::select! {
            next_message = socket.next() => {
                match next_message {
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(Message::Ping(payload))) => {
                        if socket.send(Message::Pong(payload)).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(_)) => {}
                    Some(Err(_)) => break,
                }
            }
            event = log_events.recv() => match event {
                Ok(log) => {
                    if include_children && !included_run_ids.contains(log.run_id.as_str()) {
                        match load_descendant_run_ids(&state, &run_id).await {
                            Ok(Some(run_ids)) => included_run_ids = run_ids,
                            _ => break,
                        }
                    }
                    if !included_run_ids.contains(log.run_id.as_str()) || log.sequence <= latest_sequence {
                        continue;
                    }
                    latest_sequence = log.sequence;
                    let payload = TaskRunLogsStreamMessage::Log { log };
                    if send_ws_json(&mut socket, &payload).await.is_err() {
                        break;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => {
                    let logs = match load_task_run_logs(&state, &run_id, include_children).await {
                        Ok(Some(logs)) => logs,
                        _ => break,
                    };
                    if include_children {
                        match load_descendant_run_ids(&state, &run_id).await {
                            Ok(Some(run_ids)) => included_run_ids = run_ids,
                            _ => break,
                        }
                    }
                    latest_sequence = logs.last().map(|log| log.sequence).unwrap_or(latest_sequence);
                    let payload = TaskRunLogsStreamMessage::Snapshot {
                        run_id: run_id.clone(),
                        logs,
                    };
                    if send_ws_json(&mut socket, &payload).await.is_err() {
                        break;
                    }
                }
                Err(broadcast::error::RecvError::Closed) => break,
            },
        }
    }
}

async fn send_task_run_snapshot(
    socket: &mut WebSocket,
    state: &AppState,
    run_id: &str,
) -> Result<(), ()> {
    let payload = match load_task_run_tree(state, run_id).await {
        Ok(Some(task_run)) => GetTaskRunResponse::Success(GetTaskRunResponseBody { task_run }),
        Ok(None) => {
            let payload = GetTaskRunResponse::Error(ErrorResponse {
                message: "Task run not found".to_string(),
            });
            let _ = send_ws_json(socket, &payload).await;
            let _ = socket.send(Message::Close(None)).await;
            return Err(());
        }
        Err(_) => GetTaskRunResponse::Error(ErrorResponse {
            message: "Failed to load task run".to_string(),
        }),
    };

    send_ws_json(socket, &payload).await
}

async fn load_task_run_logs(
    state: &AppState,
    run_id: &str,
    include_children: bool,
) -> Result<Option<Vec<TaskRunLogLine>>, DbErr> {
    let run_ids = if include_children {
        match load_descendant_run_ids(state, run_id).await? {
            Some(run_ids) => run_ids,
            None => return Ok(None),
        }
    } else {
        let task_run_exists = task_run::Entity::find_by_id(run_id.to_string())
            .one(&state.db)
            .await?
            .is_some();
        if !task_run_exists {
            return Ok(None);
        }
        HashSet::from([run_id.to_string()])
    };

    if run_ids.is_empty() {
        return Ok(None);
    }

    let logs = task_run_log::Entity::find()
        .filter(task_run_log::Column::RunId.is_in(run_ids.into_iter().collect::<Vec<_>>()))
        .order_by_asc(task_run_log::Column::Id)
        .all(&state.db)
        .await
        .map(|rows| {
            rows.into_iter()
                .map(|row| TaskRunLogLine {
                    run_id: row.run_id,
                    task: row.task,
                    line: row.line,
                    is_stderr: row.is_stderr,
                    timestamp: row.timestamp,
                    sequence: row.id as u64,
                })
                .collect::<Vec<_>>()
        })?;
    Ok(Some(logs))
}

async fn load_descendant_run_ids(
    state: &AppState,
    root_run_id: &str,
) -> Result<Option<HashSet<String>>, DbErr> {
    let Some(root_run) = task_run::Entity::find_by_id(root_run_id.to_string())
        .one(&state.db)
        .await?
    else {
        return Ok(None);
    };

    let all_runs = task_run::Entity::find()
        .filter(task_run::Column::Cwd.eq(root_run.cwd.clone()))
        .all(&state.db)
        .await?;
    let run_ids = collect_descendant_run_ids(&all_runs, root_run_id)
        .into_iter()
        .collect::<HashSet<_>>();
    Ok(Some(run_ids))
}

async fn send_ws_json<T: Serialize>(socket: &mut WebSocket, payload: &T) -> Result<(), ()> {
    let message = serde_json::to_string(payload).map_err(|_| ())?;
    socket.send(Message::Text(message)).await.map_err(|_| ())
}

async fn create_task_run(
    state: &AppState,
    task_key: String,
    task: Task,
    cwd: String,
    parent_run_id: Option<String>,
) -> Result<task_run::Model, DbErr> {
    let waiting_on = next_unmet_dependency(&state.db, &cwd, &task).await?;

    let model = task_run::ActiveModel {
        id: Set(nanoid!(21, &TASK_RUN_ID_ALPHABET)),
        task: Set(task_key),
        cwd: Set(cwd),
        parent_run_id: Set(parent_run_id),
        status: Set(TaskRunStatus::Queued),
        updated_at: Set(chrono::Utc::now().timestamp_millis()),
        waiting_on: Set(waiting_on),
    };

    let task_run = model.insert(&state.db).await?;
    let _ = state.task_events.send(TaskRunStatusChangedEvent {
        run_id: task_run.id.clone(),
        task: task_run.task.clone(),
        cwd: task_run.cwd.clone(),
        status: task_run.status,
    });

    if task_run.waiting_on.is_none() {
        start_task_run_execution(
            state.clone(),
            task_run.id.clone(),
            task_run.task.clone(),
            task_run.cwd.clone(),
            task.command.clone(),
        );
    }

    Ok(task_run)
}

fn start_task_run_execution(
    state: AppState,
    run_id: String,
    task_key: String,
    cwd: String,
    command: Option<String>,
) {
    tokio::spawn(async move {
        let running_updated_at = match mark_task_run_running(&state, &run_id).await {
            Ok(Some(updated_at)) => updated_at,
            Ok(None) => return,
            Err(err) => {
                eprintln!("Failed to set task run {} to running: {}", run_id, err);
                return;
            }
        };

        let final_status = run_command(
            state.clone(),
            state.running_processes.clone(),
            run_id.clone(),
            &cwd,
            &task_key,
            command,
        )
        .await;

        let existing_run = match task_run::Entity::find_by_id(run_id.clone())
            .one(&state.db)
            .await
        {
            Ok(Some(task_run)) => task_run,
            Ok(None) => return,
            Err(err) => {
                eprintln!(
                    "Failed to load task run {} after execution: {}",
                    run_id, err
                );
                return;
            }
        };

        if existing_run.status == TaskRunStatus::Cancelled {
            return;
        }

        if existing_run.status != TaskRunStatus::Running
            || existing_run.updated_at != running_updated_at
        {
            // A newer execution already changed this run state.
            // Ignore stale completion from a previous process instance.
            return;
        }

        if let Err(err) = update_task_run_status(&state, &run_id, final_status, None).await {
            eprintln!("Failed to set task run {} to running: {}", run_id, err);
            return;
        }
    });
}

async fn mark_task_run_running(state: &AppState, run_id: &str) -> Result<Option<i64>, DbErr> {
    let Some(task_run) = task_run::Entity::find_by_id(run_id.to_string())
        .one(&state.db)
        .await?
    else {
        return Ok(None);
    };

    let updated_at = chrono::Utc::now().timestamp_millis();
    let mut active = task_run.into_active_model();
    active.status = Set(TaskRunStatus::Running);
    active.waiting_on = Set(None);
    active.updated_at = Set(updated_at);
    let updated = active.update(&state.db).await?;
    let _ = state.task_events.send(TaskRunStatusChangedEvent {
        run_id: updated.id,
        task: updated.task,
        cwd: updated.cwd,
        status: updated.status,
    });

    Ok(Some(updated_at))
}

async fn run_command(
    state: AppState,
    running_processes: std::sync::Arc<Mutex<HashMap<String, oneshot::Sender<()>>>>,
    run_id: String,
    cwd: &str,
    task_key: &str,
    command: Option<String>,
) -> TaskRunStatus {
    let Some(command) = command else {
        return TaskRunStatus::Success;
    };

    if command.trim().is_empty() {
        return TaskRunStatus::Success;
    }

    append_task_log_line(
        &state,
        run_id.clone(),
        task_key.to_string(),
        format!("$ {}", command),
        false,
    )
    .await;

    let mut command_builder = Command::new("sh");
    command_builder
        .arg("-lc")
        .arg(command.as_str())
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        command_builder.process_group(0);
    }

    match command_builder.spawn() {
        Ok(mut child) => {
            let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
            running_processes
                .lock()
                .await
                .insert(run_id.clone(), cancel_tx);

            let mut stream_tasks = Vec::new();

            if let Some(stdout) = child.stdout.take() {
                let state = state.clone();
                let run_id = run_id.clone();
                let task_key = task_key.to_string();
                stream_tasks.push(tokio::spawn(async move {
                    stream_task_logs(state, run_id, task_key, stdout, false).await;
                }));
            }

            if let Some(stderr) = child.stderr.take() {
                let state = state.clone();
                let run_id = run_id.clone();
                let task_key = task_key.to_string();
                stream_tasks.push(tokio::spawn(async move {
                    stream_task_logs(state, run_id, task_key, stderr, true).await;
                }));
            }

            let status = tokio::select! {
                wait_result = child.wait() => wait_result,
                _ = cancel_rx => {
                    #[cfg(unix)]
                    {
                        if let Some(pid) = child.id() {
                            // Negative PID targets the entire process group.
                            unsafe {
                                libc::kill(-(pid as i32), libc::SIGKILL);
                            }
                        } else {
                            let _ = child.kill().await;
                        }
                    }
                    #[cfg(not(unix))]
                    {
                        let _ = child.kill().await;
                    }
                    let _ = child.wait().await;
                    running_processes.lock().await.remove(&run_id);
                    for stream_task in stream_tasks {
                        let _ = stream_task.await;
                    }
                    return TaskRunStatus::Cancelled;
                }
            };

            running_processes.lock().await.remove(&run_id);

            for stream_task in stream_tasks {
                let _ = stream_task.await;
            }

            match status {
                Ok(status) if status.success() => TaskRunStatus::Success,
                Ok(_) => TaskRunStatus::Failed,
                Err(_) => TaskRunStatus::Failed,
            }
        }
        Err(_) => TaskRunStatus::Failed,
    }
}

async fn find_existing_running_run_id(
    state: &AppState,
    cwd: &str,
    task_key: &str,
    task: &Task,
) -> Result<Option<String>, DbErr> {
    if let Some(existing_running_run) = task_run::Entity::find()
        .filter(task_run::Column::Cwd.eq(cwd.to_string()))
        .filter(task_run::Column::Task.eq(task_key.to_string()))
        .filter(task_run::Column::Status.eq(TaskRunStatus::Running))
        .order_by_desc(task_run::Column::UpdatedAt)
        .one(&state.db)
        .await?
    {
        return Ok(Some(existing_running_run.id));
    }

    if !task_has_no_command(task) {
        return Ok(None);
    }

    let all_runs = task_run::Entity::find()
        .filter(task_run::Column::Cwd.eq(cwd.to_string()))
        .all(&state.db)
        .await?;

    let run_by_id = all_runs
        .iter()
        .map(|run| (run.id.as_str(), run))
        .collect::<HashMap<_, _>>();

    let mut parent_candidates = all_runs
        .iter()
        .filter(|run| run.task == task_key)
        .collect::<Vec<_>>();
    parent_candidates.sort_by_key(|run| std::cmp::Reverse(run.updated_at));

    for parent in parent_candidates {
        let descendant_run_ids = collect_descendant_run_ids(&all_runs, &parent.id);
        let has_active_descendant = descendant_run_ids.into_iter().any(|run_id| {
            if run_id == parent.id {
                return false;
            }

            matches!(
                run_by_id.get(run_id.as_str()).map(|run| run.status),
                Some(TaskRunStatus::Queued | TaskRunStatus::Running)
            )
        });

        if has_active_descendant {
            return Ok(Some(parent.id.clone()));
        }
    }

    Ok(None)
}

fn task_has_no_command(task: &Task) -> bool {
    match task.command.as_deref() {
        Some(command) => command.trim().is_empty(),
        None => true,
    }
}

fn collect_descendant_run_ids(all_runs: &[task_run::Model], root_run_id: &str) -> Vec<String> {
    let mut by_parent: HashMap<&str, Vec<&task_run::Model>> = HashMap::new();
    for run in all_runs {
        if let Some(parent_run_id) = run.parent_run_id.as_deref() {
            by_parent.entry(parent_run_id).or_default().push(run);
        }
    }

    let mut result = Vec::new();
    let mut stack = vec![root_run_id.to_string()];

    while let Some(run_id) = stack.pop() {
        result.push(run_id.clone());
        if let Some(children) = by_parent.get(run_id.as_str()) {
            for child in children {
                stack.push(child.id.clone());
            }
        }
    }

    result
}

async fn load_task_run_tree(
    state: &AppState,
    run_id: &str,
) -> Result<Option<TaskRunTreeNode>, DbErr> {
    let Some(root_run) = task_run::Entity::find_by_id(run_id.to_string())
        .one(&state.db)
        .await?
    else {
        return Ok(None);
    };

    let all_runs = task_run::Entity::find()
        .filter(task_run::Column::Cwd.eq(root_run.cwd.clone()))
        .all(&state.db)
        .await?;
    let descendant_ids = collect_descendant_run_ids(&all_runs, run_id)
        .into_iter()
        .collect::<HashSet<_>>();

    let mut runs_by_id = HashMap::new();
    let mut children_by_parent: HashMap<String, Vec<String>> = HashMap::new();

    for run in all_runs {
        if !descendant_ids.contains(&run.id) {
            continue;
        }
        if let Some(parent_run_id) = run.parent_run_id.clone() {
            children_by_parent
                .entry(parent_run_id)
                .or_default()
                .push(run.id.clone());
        }
        runs_by_id.insert(run.id.clone(), run);
    }

    Ok(build_task_run_tree(
        run_id,
        &runs_by_id,
        &children_by_parent,
    ))
}

fn build_task_run_tree(
    run_id: &str,
    runs_by_id: &HashMap<String, task_run::Model>,
    children_by_parent: &HashMap<String, Vec<String>>,
) -> Option<TaskRunTreeNode> {
    let run = runs_by_id.get(run_id)?;

    let mut children = children_by_parent
        .get(run_id)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|child_run_id| {
            build_task_run_tree(&child_run_id, runs_by_id, children_by_parent)
        })
        .collect::<Vec<_>>();
    children.sort_by_key(|child| child.updated_at);

    Some(TaskRunTreeNode {
        id: run.id.clone(),
        task: run.task.clone(),
        cwd: run.cwd.clone(),
        parent_run_id: run.parent_run_id.clone(),
        status: run.status,
        updated_at: run.updated_at,
        waiting_on: run.waiting_on.clone(),
        children,
    })
}

async fn cancel_task_runs(state: &AppState, run_ids: &[String]) -> Result<(), DbErr> {
    for run_id in run_ids {
        let Some(task_run) = task_run::Entity::find_by_id(run_id.clone())
            .one(&state.db)
            .await?
        else {
            continue;
        };

        if matches!(
            task_run.status,
            TaskRunStatus::Success | TaskRunStatus::Failed
        ) {
            continue;
        }

        if let Some(cancel_tx) = state.running_processes.lock().await.remove(run_id) {
            let _ = cancel_tx.send(());
        }

        append_task_log_line(
            state,
            run_id.clone(),
            task_run.task.clone(),
            "canceled".to_string(),
            false,
        )
        .await;

        update_task_run_status(state, run_id, TaskRunStatus::Cancelled, None).await?;
    }

    Ok(())
}

async fn prepare_task_runs_for_restart(
    state: &AppState,
    config: &Config,
    all_runs: &[task_run::Model],
    root_run_id: &str,
    run_ids_to_restart: &[String],
) -> Result<(), DbErr> {
    let run_id_set = run_ids_to_restart
        .iter()
        .map(|run_id| run_id.as_str())
        .collect::<HashSet<_>>();

    let runs_by_id = all_runs
        .iter()
        .map(|run| (run.id.as_str(), run))
        .collect::<HashMap<_, _>>();

    let mut ordered_run_ids = run_ids_to_restart.to_vec();
    ordered_run_ids.sort_by_key(|run_id| {
        let mut depth = 0usize;
        let mut cursor = runs_by_id
            .get(run_id.as_str())
            .and_then(|run| run.parent_run_id.as_deref());
        while let Some(parent_run_id) = cursor {
            if !run_id_set.contains(parent_run_id) {
                break;
            }
            depth += 1;
            cursor = runs_by_id
                .get(parent_run_id)
                .and_then(|run| run.parent_run_id.as_deref());
        }
        depth
    });

    for run_id in ordered_run_ids {
        let Some(run) = runs_by_id.get(run_id.as_str()) else {
            continue;
        };

        let waiting_on = if run.id == root_run_id {
            let Some(task) = config.get_task(run.task.clone()) else {
                return Err(DbErr::Custom(format!(
                    "Task '{}' missing from config during restart",
                    run.task
                )));
            };
            next_unmet_dependency(&state.db, &run.cwd, &task).await?
        } else if let Some(parent_run_id) = run.parent_run_id.as_deref() {
            if run_id_set.contains(parent_run_id) {
                runs_by_id
                    .get(parent_run_id)
                    .map(|parent_run| parent_run.task.clone())
            } else {
                let Some(task) = config.get_task(run.task.clone()) else {
                    continue;
                };
                next_unmet_dependency(&state.db, &run.cwd, &task).await?
            }
        } else {
            let Some(task) = config.get_task(run.task.clone()) else {
                continue;
            };
            next_unmet_dependency(&state.db, &run.cwd, &task).await?
        };

        update_task_run_status(state, &run.id, TaskRunStatus::Queued, waiting_on).await?;
    }

    Ok(())
}

async fn clear_task_run_logs_for_restart(
    state: &AppState,
    run_ids: &[String],
) -> Result<(), DbErr> {
    if run_ids.is_empty() {
        return Ok(());
    }

    task_run_log::Entity::delete_many()
        .filter(task_run_log::Column::RunId.is_in(run_ids.to_vec()))
        .exec(&state.db)
        .await?;
    Ok(())
}

pub async fn cancel_all_running_processes(state: &AppState) {
    let cancel_senders = {
        let mut running = state.running_processes.lock().await;
        running
            .drain()
            .map(|(_, sender)| sender)
            .collect::<Vec<_>>()
    };

    for sender in cancel_senders {
        let _ = sender.send(());
    }
}

async fn stream_task_logs<R>(
    state: AppState,
    run_id: String,
    task_key: String,
    stream: R,
    is_stderr: bool,
) where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut reader = BufReader::new(stream);
    let mut bytes = Vec::new();

    loop {
        bytes.clear();
        match reader.read_until(b'\n', &mut bytes).await {
            Ok(0) => break,
            Ok(_) => {
                if bytes.ends_with(b"\n") {
                    bytes.pop();
                }
                if bytes.ends_with(b"\r") {
                    bytes.pop();
                }

                let decoded = String::from_utf8_lossy(&bytes).into_owned();
                let line = sanitize_terminal_log_line(&decoded);

                if line.is_empty() && !decoded.is_empty() {
                    continue;
                }

                append_task_log_line(&state, run_id.clone(), task_key.clone(), line, is_stderr)
                    .await;
            }
            Err(err) => {
                eprintln!("Failed to read task log stream for {}: {}", run_id, err);
                break;
            }
        }
    }
}

fn sanitize_terminal_log_line(line: &str) -> String {
    let most_recent_segment = line.rsplit('\r').next().unwrap_or(line);
    strip_ansi_escape_sequences(most_recent_segment)
}

fn strip_ansi_escape_sequences(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut cleaned = Vec::with_capacity(bytes.len());
    let mut index = 0usize;

    while index < bytes.len() {
        let byte = bytes[index];
        if byte == 0x1b {
            index += 1;
            if index >= bytes.len() {
                break;
            }

            let next = bytes[index];
            match next {
                b'[' => {
                    index += 1;
                    while index < bytes.len() {
                        let b = bytes[index];
                        index += 1;
                        if (0x40..=0x7e).contains(&b) {
                            break;
                        }
                    }
                }
                b']' => {
                    index += 1;
                    while index < bytes.len() {
                        if bytes[index] == 0x07 {
                            index += 1;
                            break;
                        }
                        if bytes[index] == 0x1b
                            && index + 1 < bytes.len()
                            && bytes[index + 1] == b'\\'
                        {
                            index += 2;
                            break;
                        }
                        index += 1;
                    }
                }
                b'P' | b'X' | b'^' | b'_' => {
                    index += 1;
                    while index < bytes.len() {
                        if bytes[index] == 0x1b
                            && index + 1 < bytes.len()
                            && bytes[index + 1] == b'\\'
                        {
                            index += 2;
                            break;
                        }
                        index += 1;
                    }
                }
                _ => {
                    // Skip simple two-byte escape forms.
                    index += 1;
                }
            }
            continue;
        }

        if byte.is_ascii_control() && byte != b'\t' {
            index += 1;
            continue;
        }

        cleaned.push(byte);
        index += 1;
    }

    String::from_utf8_lossy(&cleaned).into_owned()
}

async fn append_task_log_line(
    state: &AppState,
    run_id: String,
    task: String,
    line: String,
    is_stderr: bool,
) {
    let timestamp = chrono::Utc::now().timestamp_millis();
    let log = task_run_log::ActiveModel {
        id: NotSet,
        run_id: Set(run_id),
        task: Set(task),
        line: Set(line),
        is_stderr: Set(is_stderr),
        timestamp: Set(timestamp),
    };

    match log.insert(&state.db).await {
        Ok(inserted) => {
            let log_line = TaskRunLogLine {
                run_id: inserted.run_id,
                task: inserted.task,
                line: inserted.line,
                is_stderr: inserted.is_stderr,
                timestamp: inserted.timestamp,
                sequence: inserted.id as u64,
            };
            let _ = state.task_log_events.send(log_line);
        }
        Err(err) => {
            eprintln!("Failed to persist task log line: {}", err);
        }
    }
}

async fn update_task_run_status(
    state: &AppState,
    run_id: &str,
    status: TaskRunStatus,
    waiting_on: Option<String>,
) -> Result<(), DbErr> {
    let Some(task_run) = task_run::Entity::find_by_id(run_id.to_string())
        .one(&state.db)
        .await?
    else {
        return Ok(());
    };
    let mut active = task_run.into_active_model();
    active.status = Set(status);
    active.waiting_on = Set(waiting_on);
    active.updated_at = Set(chrono::Utc::now().timestamp_millis());
    let updated = active.update(&state.db).await?;
    let _ = state.task_events.send(TaskRunStatusChangedEvent {
        run_id: updated.id,
        task: updated.task,
        cwd: updated.cwd,
        status: updated.status,
    });
    Ok(())
}

async fn trigger_subtasks(
    state: &AppState,
    event: &TaskRunStatusChangedEvent,
) -> Result<(), DbErr> {
    let config = match Config::load(&event.cwd).await {
        Ok(config) => config,
        Err(err) => {
            eprintln!("Failed to load config for subtasks: {}", err);
            return Ok(());
        }
    };

    let Some(parent_task) = config.get_task(event.task.clone()) else {
        return Ok(());
    };

    let Some(subtasks) = parent_task.tasks else {
        return Ok(());
    };

    for (subtask_key, _) in subtasks {
        let full_subtask_key = format!("{}:{}", event.task, subtask_key);
        let Some(subtask) = config.get_task(full_subtask_key.clone()) else {
            continue;
        };

        // When a run is restarted in-place, existing subtask runs for the same parent run
        // should be reused instead of creating duplicate child rows.
        let existing_child = task_run::Entity::find()
            .filter(task_run::Column::ParentRunId.eq(Some(event.run_id.clone())))
            .filter(task_run::Column::Task.eq(full_subtask_key.clone()))
            .order_by_desc(task_run::Column::UpdatedAt)
            .one(&state.db)
            .await?;

        if existing_child.is_some() {
            continue;
        }

        create_task_run(
            state,
            full_subtask_key,
            subtask,
            event.cwd.clone(),
            Some(event.run_id.clone()),
        )
        .await?;
    }

    Ok(())
}

async fn next_unmet_dependency(
    db: &DatabaseConnection,
    cwd: &str,
    task: &Task,
) -> Result<Option<String>, DbErr> {
    let Some(depends_on) = &task.depends_on else {
        return Ok(None);
    };

    for dependency in depends_on {
        if !is_dependency_satisfied(db, cwd, dependency).await? {
            return Ok(Some(dependency.clone()));
        }
    }

    Ok(None)
}

async fn is_dependency_satisfied(
    db: &DatabaseConnection,
    cwd: &str,
    dependency_task: &str,
) -> Result<bool, DbErr> {
    let latest = task_run::Entity::find()
        .filter(task_run::Column::Cwd.eq(cwd.to_string()))
        .filter(task_run::Column::Task.eq(dependency_task.to_string()))
        .order_by_desc(task_run::Column::UpdatedAt)
        .one(db)
        .await?;

    Ok(matches!(
        latest.map(|run| run.status),
        Some(TaskRunStatus::Success)
    ))
}

async fn trigger_waiting_task_runs(
    state: &AppState,
    event: &TaskRunStatusChangedEvent,
) -> Result<(), DbErr> {
    let waiting_runs = task_run::Entity::find()
        .filter(task_run::Column::Cwd.eq(event.cwd.clone()))
        .filter(task_run::Column::Status.eq(TaskRunStatus::Queued))
        .filter(task_run::Column::WaitingOn.eq(Some(event.task.clone())))
        .all(&state.db)
        .await?;

    if waiting_runs.is_empty() {
        return Ok(());
    }

    let config = match Config::load(&event.cwd).await {
        Ok(config) => config,
        Err(err) => {
            eprintln!("Failed to load config for waiting task runs: {}", err);
            return Ok(());
        }
    };

    for waiting_run in waiting_runs {
        let Some(task) = config.get_task(waiting_run.task.clone()) else {
            continue;
        };

        let next_waiting_on = next_unmet_dependency(&state.db, &waiting_run.cwd, &task).await?;
        if let Some(next_waiting_on) = next_waiting_on {
            update_task_run_status(
                state,
                &waiting_run.id,
                TaskRunStatus::Queued,
                Some(next_waiting_on),
            )
            .await?;
            continue;
        }

        update_task_run_status(state, &waiting_run.id, TaskRunStatus::Queued, None).await?;
        start_task_run_execution(
            state.clone(),
            waiting_run.id.clone(),
            waiting_run.task.clone(),
            waiting_run.cwd.clone(),
            task.command.clone(),
        );
    }

    Ok(())
}
