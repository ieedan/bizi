mod m20260212_000001_create_task_runs;
mod m20260212_000002_create_task_run_logs;

use sea_orm_migration::prelude::*;

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![
            Box::new(m20260212_000001_create_task_runs::Migration),
            Box::new(m20260212_000002_create_task_run_logs::Migration),
        ]
    }
}
