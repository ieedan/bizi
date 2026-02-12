use std::collections::HashMap;

use axum::{
    Json,
    extract::{Query, State},
    http::StatusCode,
};
use nanoid::nanoid;
use sea_orm::{ActiveModelTrait, ActiveValue::Set, DatabaseConnection, DbErr};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::{
    api::{AppState, error::ErrorResponse},
    config::{Config, Task},
    db::entities::task_run::{self, TaskRunStatus},
};

#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListTasksRequest {
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
#[serde(untagged)]
pub enum ListTasksResponse {
    Success(ListTasksResponseBody),
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

    let task_run = match create_task_run(&state.db, payload.task.clone(), task, payload.cwd.clone(), None).await {
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

async fn create_task_run(db: &DatabaseConnection, task_key: String, task: Task, cwd: String, parent_run_id: Option<String>) -> Result<task_run::Model, DbErr> {
    let model = task_run::ActiveModel {
        id: Set(nanoid!()),
        task: Set(task_key),
        cwd: Set(cwd),
        parent_run_id: Set(parent_run_id),
        status: Set(TaskRunStatus::Queued),
        updated_at: Set(chrono::Utc::now().timestamp_millis()),
        waiting_on: Set(None)
    };

    let task_run = model.insert(db).await?;

    tokio::spawn(async move {
        
    });
    
    Ok(task_run)
}