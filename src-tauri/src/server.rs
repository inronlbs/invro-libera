use axum::response::Response;
use axum::http::Method;
use axum::{
    extract::{Query, State, Path},
    http::{header, StatusCode},
    response::{IntoResponse, Json},
    routing::{get, post},
    Router,
};
use rust_embed::RustEmbed;
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use tower_http::cors::{Any, CorsLayer};

#[derive(RustEmbed)]
#[folder = "../dist"]
struct Asset;

async fn get_students_handler(
    State(app_state): State<crate::state::AppState>,
) -> impl IntoResponse {
    let data = app_state.data.read().await;
    (StatusCode::OK, Json(data.students.clone())).into_response()
}

#[derive(Serialize)]
struct SessionInfo {
    active: bool,
    class_id: Option<String>,
}

async fn get_session_handler(
    State(app_state): State<crate::state::AppState>,
) -> impl IntoResponse {
    let active = app_state.active_class.read().await;
    (StatusCode::OK, Json(SessionInfo {
        active: active.is_some(),
        class_id: active.clone(),
    })).into_response()
}

async fn get_school_name_handler(
    State(app_state): State<crate::state::AppState>,
) -> impl IntoResponse {
    let data = app_state.data.read().await;
    (StatusCode::OK, Json(serde_json::json!({ "name": data.school_name }))).into_response()
}

#[derive(Deserialize)]
pub struct HeartbeatReq {
    pub student_id: String,
    pub book_id: Option<String>,
}

#[derive(Serialize)]
pub struct HeartbeatRes {
    pub logout: bool,
}

async fn heartbeat_handler(
    State(app_state): State<crate::state::AppState>,
    Json(req): Json<HeartbeatReq>,
) -> impl IntoResponse {
    let mut live_sessions = app_state.live_sessions.write().await;
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();

    let active_class = app_state.active_class.read().await;
    if active_class.is_none() {
        return (StatusCode::OK, Json(HeartbeatRes { logout: true })).into_response();
    }
    
    let logout = if let Some(session) = live_sessions.get_mut(&req.student_id) {
        if session.force_logout {
            true
        } else {
            session.last_seen = now;
            session.book_id = req.book_id.clone();
            false
        }
    } else {
        live_sessions.insert(req.student_id.clone(), crate::state::StudentSessionInfo {
            student_id: req.student_id.clone(),
            book_id: req.book_id,
            last_seen: now,
            force_logout: false,
        });
        false
    };
    
    (StatusCode::OK, Json(HeartbeatRes { logout })).into_response()
}

async fn static_handler(uri: axum::http::Uri) -> impl IntoResponse {
    let mut path = uri.path().trim_start_matches('/').to_string();

    if path.is_empty() {
        path = "index.html".to_string();
    }

    match Asset::get(path.as_str()) {
        Some(content) => {
            let mime = mime_guess::from_path(path).first_or_octet_stream();
            ([(header::CONTENT_TYPE, mime.as_ref())], content.data).into_response()
        }
        None => {
            if path == "index.html" {
                (StatusCode::NOT_FOUND, "404 index.html not found").into_response()
            } else {
                // Return index.html for SPA routing fallback
                match Asset::get("index.html") {
                    Some(content) => {
                        let mime = mime_guess::from_path("index.html").first_or_octet_stream();
                        ([(header::CONTENT_TYPE, mime.as_ref())], content.data).into_response()
                    }
                    None => (StatusCode::NOT_FOUND, "404 Not Found").into_response(),
                }
            }
        }
    }
}

async fn catalog_handler(
    State(app_state): State<crate::state::AppState>,
) -> impl IntoResponse {
    let app_dir = app_state.data_file_path.parent().unwrap_or(std::path::Path::new("."));
    let catalog = crate::books::load_catalog(app_dir).await;
    (StatusCode::OK, Json(catalog.books)).into_response()
}

async fn epub_content_handler(
    State(app_state): State<crate::state::AppState>,
    Path((book_id, file_path)): Path<(String, String)>,
) -> impl IntoResponse {
    let app_dir = app_state.data_file_path.parent().unwrap_or(std::path::Path::new("."));
    let full_path = app_dir.join("epub_cache").join(book_id).join(file_path);

    if !full_path.exists() || !full_path.is_file() {
        return (StatusCode::NOT_FOUND, "File not found").into_response();
    }

    match tokio::fs::read(&full_path).await {
        Ok(bytes) => {
            let mime = mime_guess::from_path(&full_path).first_or_octet_stream();
            ([(header::CONTENT_TYPE, mime.as_ref())], bytes).into_response()
        }
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "Error reading file").into_response(),
    }
}

async fn prepare_epub_handler(
    State(app_state): State<crate::state::AppState>,
    Path(book_id): Path<String>,
) -> impl IntoResponse {
    let app_dir = app_state.data_file_path.parent().unwrap_or(std::path::Path::new("."));
    match crate::books::prepare_epub_streaming_core(app_dir, book_id).await {
        Ok(url) => (StatusCode::OK, Json(serde_json::json!({ "url": url }))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    }
}

pub fn start(app_state: crate::state::AppState) {
    tauri::async_runtime::spawn(async move {
        let cors = CorsLayer::new()
            .allow_methods([Method::GET, Method::POST])
            .allow_headers(Any)
            .allow_origin(Any);

        // Clone the port handle before app_state is moved into the router
        let server_port_handle = app_state.server_port.clone();

        let app = Router::new()
            .route("/api/students", get(get_students_handler))
            .route("/api/session", get(get_session_handler))
            .route("/api/school", get(get_school_name_handler))
            .route("/api/books/:book_id", get(crate::books::stream_book_handler))
            .route("/api/prepare_epub/:book_id", get(prepare_epub_handler))
            .route("/api/catalog", get(catalog_handler))
            .route("/api/heartbeat", post(heartbeat_handler))
            .route("/epub_content/:book_id/*path", get(epub_content_handler))
            .fallback(get(static_handler))
            .layer(cors)
            .with_state(app_state);

        let addr = SocketAddr::from(([0, 0, 0, 0], 3000));
        let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
        println!("Host server listening on http://0.0.0.0:3000");
        
        // Save port 3000 to AppState for internal consistency
        *server_port_handle.write().await = 3000;

        axum::serve(listener, app).await.unwrap();
    });
}
