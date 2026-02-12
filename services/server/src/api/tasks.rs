use std::{collections::HashMap};

use axum::{Json, extract::Query, http::StatusCode};
use serde::{Deserialize, Serialize};
use utoipa::{ToSchema};

use crate::{api::error::ErrorResponse, config::Config, db::schema::Task};

#[derive(Debug, Clone, Deserialize, ToSchema)]
pub struct ListTasksRequest {
    #[schema(example = "/Users/johndoe/documents/github/example-project")]
    pub cwd: String,
}
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct ListTasksResponseBody {
    /// The keys of the tasks you would use to reference a task
    pub task_keys: Vec<String>,
    /// The list of tasks that are defined in the task.config.json file
    pub tasks: HashMap<String, Task>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
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
    Query(payload): Query<ListTasksRequest>,
) -> (StatusCode, Json<ListTasksResponse>) {
    let config = match Config::load(payload.cwd).await {
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
            task_keys: config.get_task_keys(),
            tasks: config.tasks,
        })),
    )
}
