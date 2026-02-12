use server::api::create_router;
use clap::Parser;
use server::db::{connect_sqlite, run_migrations};
use tokio::net::TcpListener;

#[derive(Parser, Debug)]
#[command(author, version, about)]
struct Args {
    #[arg(long, default_value = "0.0.0.0")]
    address: String,
    #[arg(long, default_value_t = 7436)]
    port: u16,
    #[arg(long, default_value = "sqlite://task-runner.db?mode=rwc")]
    database_url: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();
    let db = connect_sqlite(&args.database_url).await?;
    run_migrations(&db).await?;
    let app = create_router(db);

    let address = format!("{}:{}", args.address, args.port);

    let listener = TcpListener::bind((args.address.as_str(), args.port))
        .await
        .unwrap();
    println!("Server is running on {}", address);
    axum::serve(listener, app).await?;
    Ok(())
}
