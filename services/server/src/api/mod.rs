use axum::routing::post;
use axum::{Router, routing::get};
use sea_orm::DatabaseConnection;
use tokio::sync::broadcast;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

use crate::api::error::ErrorResponse;
use crate::api::tasks::{
    ListTasksRequest, ListTasksResponse, ListTasksResponseBody, StartTaskRequest,
    StartTaskResponse, StartTaskResponseBody, list_tasks, run_task,
};
use crate::config::Task;

pub mod error;
pub mod tasks;

#[derive(Clone)]
pub struct AppState {
    pub db: DatabaseConnection,
    pub task_events: broadcast::Sender<tasks::TaskRunFinishedEvent>,
}

pub fn create_router(db: DatabaseConnection) -> Router {
    let (task_events, _) = broadcast::channel(256);
    let state = AppState { db, task_events };
    tasks::spawn_task_completion_listener(state.clone());

    Router::new()
        .route("/api/tasks", get(list_tasks))
        .route("/api/tasks/run", post(run_task))
        .merge(SwaggerUi::new("/swagger-ui").url("/openapi.json", ApiDoc::openapi()))
        .with_state(state)
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
