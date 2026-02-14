use clap::Parser;
use server::api::{create_app_state, create_router, tasks};
use server::db::{connect_sqlite, run_migrations};
use tokio::net::TcpListener;

const DATABASE_URL: &str = "sqlite://task-runner.db?mode=rwc";

#[derive(Parser, Debug)]
#[command(author, version, about)]
struct Args {
    #[arg(long, default_value = "0.0.0.0")]
    address: String,
    #[arg(long, default_value_t = 7436)]
    port: u16,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();
    let db = connect_sqlite(DATABASE_URL).await?;
    run_migrations(&db).await?;
    let state = create_app_state(db);
    let app = create_router(state.clone());

    let address = format!("{}:{}", args.address, args.port);

    let listener = TcpListener::bind((args.address.as_str(), args.port))
        .await
        .unwrap();
    println!("Server is running on {}", address);
    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            let _ = tokio::signal::ctrl_c().await;
            tasks::cancel_all_running_processes(&state).await;
            // Give task runners a brief moment to propagate kills.
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        })
        .await?;
    Ok(())
}
