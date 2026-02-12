use axum::{Router, routing::get, Json};
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

use crate::api::tasks::{ListTasksRequest, ListTasksResponse, ListTasksResponseBody, list_tasks};
use crate::api::error::ErrorResponse;
use crate::db::schema::Task;

pub mod error;
pub mod tasks;

pub fn create_router() -> Router {
    Router::new()
        .route("/api/tasks", get(list_tasks))
        .merge(SwaggerUi::new("/swagger-ui").url("/openapi.json", ApiDoc::openapi()))
}

#[derive(OpenApi)]
#[openapi(
    paths(tasks::list_tasks),
    components(schemas(
        ListTasksRequest,
        ListTasksResponse,
        ListTasksResponseBody,
        ErrorResponse,
        Task,
    ))
)]
pub struct ApiDoc;