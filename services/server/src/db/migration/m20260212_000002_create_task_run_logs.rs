use sea_orm::Schema;
use sea_orm_migration::prelude::*;

use crate::db::entities::task_run_log;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let schema = Schema::new(manager.get_database_backend());
        manager
            .create_table(
                schema
                    .create_table_from_entity(task_run_log::Entity)
                    .if_not_exists()
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_task_run_logs_run_id_id")
                    .table(task_run_log::Entity)
                    .col(task_run_log::Column::RunId)
                    .col(task_run_log::Column::Id)
                    .if_not_exists()
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(task_run_log::Entity).to_owned())
            .await
    }
}
