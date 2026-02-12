use axum::routing::post;
use axum::{Router, routing::get};
use sea_orm::DatabaseConnection;
use std::{collections::HashMap, sync::Arc};
use tokio::sync::{Mutex, broadcast, oneshot};
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

use crate::api::error::ErrorResponse;
use crate::api::tasks::{
    CancelTaskRequest, CancelTaskResponse, CancelTaskResponseBody, ListTasksRequest,
    GetTaskRunResponse, GetTaskRunResponseBody, ListTasksResponse, ListTasksResponseBody,
    RestartTaskRequest, RestartTaskResponse, RestartTaskResponseBody, StartTaskRequest,
    StartTaskResponse, StartTaskResponseBody, TaskRunTreeNode, cancel_task, get_task_run,
    list_tasks, restart_task, run_task,
};
use crate::config::Task;

pub mod error;
pub mod tasks;

#[derive(Clone)]
pub struct AppState {
    pub db: DatabaseConnection,
    pub task_events: broadcast::Sender<tasks::TaskRunStatusChangedEvent>,
    pub running_processes: Arc<Mutex<HashMap<String, oneshot::Sender<()>>>>,
}

pub fn create_app_state(db: DatabaseConnection) -> AppState {
    let (task_events, _) = broadcast::channel(256);
    AppState {
        db,
        task_events,
        running_processes: Arc::new(Mutex::new(HashMap::new())),
    }
}

pub fn create_router(state: AppState) -> Router {
    tasks::spawn_task_completion_listener(state.clone());

    Router::new()
        .route("/api/tasks", get(list_tasks))
        .route("/api/tasks/:run_id", get(get_task_run))
        .route("/api/tasks/run", post(run_task))
        .route("/api/tasks/cancel", post(cancel_task))
        .route("/api/tasks/restart", post(restart_task))
        .merge(SwaggerUi::new("/swagger-ui").url("/openapi.json", ApiDoc::openapi()))
        .with_state(state)
}

#[derive(OpenApi)]
#[openapi(
    paths(
        tasks::list_tasks,
        tasks::get_task_run,
        tasks::run_task,
        tasks::cancel_task,
        tasks::restart_task
    ),
    components(schemas(
        ListTasksRequest,
        ListTasksResponse,
        ListTasksResponseBody,
        GetTaskRunResponse,
        GetTaskRunResponseBody,
        TaskRunTreeNode,
        ErrorResponse,
        Task,
        StartTaskRequest,
        StartTaskResponse,
        StartTaskResponseBody,
        CancelTaskRequest,
        CancelTaskResponse,
        CancelTaskResponseBody,
        RestartTaskRequest,
        RestartTaskResponse,
        RestartTaskResponseBody,
    ))
)]
pub struct ApiDoc;
