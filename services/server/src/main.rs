use server::api::create_router;
use tokio::net::TcpListener;

#[tokio::main]
async fn main() {
    let app = create_router();

    let address  = "0.0.0.0:7436";

    let listener = TcpListener::bind(&address).await.unwrap();
    println!("Server is running on {}", address);
    let _ = axum::serve(listener, app).await;
}
