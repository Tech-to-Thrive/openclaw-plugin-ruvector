use ruvector_server::{Config, RuvectorServer};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt::init();

    let mut config = Config::default();
    if let Ok(host) = std::env::var("RUVECTOR_HOST") {
        config.host = host;
    }
    if let Ok(port) = std::env::var("RUVECTOR_PORT") {
        config.port = port.parse().expect("Invalid port number");
    }

    println!("Starting RuVector server on {}:{}", config.host, config.port);
    let server = RuvectorServer::with_config(config);
    server.start().await?;
    Ok(())
}
