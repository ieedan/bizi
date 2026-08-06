use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

// The wire contract owns this enum; the `orm` feature gives it the SeaORM
// derives so it doubles as the column type here.
pub use bizi_api::TaskRunStatus;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize, ToSchema)]
#[sea_orm(table_name = "task_runs")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub task: String,
    pub cwd: String,
    pub parent_run_id: Option<String>,
    pub status: TaskRunStatus,
    pub updated_at: i64,
    pub waiting_on: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
