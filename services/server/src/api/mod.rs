use axum::routing::post;
use axum::{Router, routing::get};
use sea_orm::DatabaseConnection;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

use crate::api::tasks::{ListTasksRequest, ListTasksResponse, ListTasksResponseBody, StartTaskRequest, StartTaskResponse, StartTaskResponseBody, list_tasks, run_task};
use crate::api::error::ErrorResponse;
use crate::config::Task;

pub mod error;
pub mod tasks;

#[derive(Clone)]
pub struct AppState {
    pub db: DatabaseConnection,
}

pub fn create_router(db: DatabaseConnection) -> Router {
    Router::new()
        .route("/api/tasks", get(list_tasks))
        .route("/api/tasks/run", post(run_task))
        .merge(SwaggerUi::new("/swagger-ui").url("/openapi.json", ApiDoc::openapi()))
        .with_state(AppState { db })
}

#[derive(OpenApi)]
#[openapi(
    paths(tasks::list_tasks, tasks::run_task),
    components(schemas(
        ListTasksRequest,
        ListTasksResponse,
        ListTasksResponseBody,
        ErrorResponse,
        Task,
        StartTaskRequest,
        StartTaskResponse,
        StartTaskResponseBody,
    ))
)]
pub struct ApiDoc;