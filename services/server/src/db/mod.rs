pub mod entities;
pub mod migration;

use sea_orm::{Database, DatabaseConnection, DbErr};
use sea_orm_migration::MigratorTrait;

pub async fn connect_sqlite(database_url: &str) -> Result<DatabaseConnection, DbErr> {
    Database::connect(database_url).await
}

pub async fn run_migrations(db: &DatabaseConnection) -> Result<(), DbErr> {
    migration::Migrator::up(db, None).await
}