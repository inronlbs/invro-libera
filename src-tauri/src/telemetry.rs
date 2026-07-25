use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::Emitter;
use std::sync::LazyLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelemetryPayload {
    pub device_name: String,
    pub student_id: Option<String>,
    pub student_name: Option<String>,
    pub class_division: Option<String>,
    pub current_book_id: String,
    pub current_book_title: String,
    pub current_page: usize,
    pub total_pages: Option<usize>,
    pub reading_time_seconds: u64,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeacherHostInfo {
    pub is_active: bool,
    pub host_ip: Option<String>,
    pub host_port: u16,
    pub active_class: Option<String>,
    pub active_division: Option<String>,
    pub school_name: Option<String>,
}

static CURRENT_HOST: LazyLock<Arc<Mutex<Option<TeacherHostInfo>>>> = LazyLock::new(|| Arc::new(Mutex::new(None)));

/// Discover active Teacher Host on local LAN (scans local subnet / default host port)
#[tauri::command]
pub async fn discover_teacher_host() -> Result<TeacherHostInfo, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(1500))
        .build()
        .map_err(|e| e.to_string())?;

    // Try local host IP or default LAN gateway
    let candidates = vec!["127.0.0.1", "localhost"];
    
    for host in candidates {
        let url = format!("http://{host}:3000/api/active_session");
        if let Ok(res) = client.get(&url).send().await {
            if res.status().is_success() {
                if let Ok(info) = res.json::<serde_json::Value>().await {
                    let active_info = TeacherHostInfo {
                        is_active: true,
                        host_ip: Some(host.to_string()),
                        host_port: 3000,
                        active_class: info.get("class_name").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        active_division: info.get("division_name").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        school_name: info.get("school_name").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    };

                    let mut current = CURRENT_HOST.lock().await;
                    *current = Some(active_info.clone());
                    return Ok(active_info);
                }
            }
        }
    }

    Ok(TeacherHostInfo {
        is_active: false,
        host_ip: None,
        host_port: 3000,
        active_class: None,
        active_division: None,
        school_name: None,
    })
}

/// Send 0.1 KB telemetry ping to Teacher Host
#[tauri::command]
pub async fn send_telemetry_ping(payload: TelemetryPayload) -> Result<bool, String> {
    let host_guard = CURRENT_HOST.lock().await;
    let Some(ref host) = *host_guard else {
        return Ok(false);
    };

    if !host.is_active || host.host_ip.is_none() {
        return Ok(false);
    }

    let host_ip = host.host_ip.as_ref().unwrap();
    let url = format!("http://{host_ip}:{}/api/telemetry", host.host_port);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())?;

    match client.post(&url).json(&payload).send().await {
        Ok(res) => {
            if res.status() == reqwest::StatusCode::UNAUTHORIZED || res.status() == reqwest::StatusCode::FORBIDDEN {
                // Teacher logged out / kicked this device
                return Err("FORCE_LOGOUT".to_string());
            }
            Ok(res.status().is_success())
        }
        Err(_) => Ok(false),
    }
}

/// Command sent by Teacher Host to trigger background book download
#[tauri::command]
pub async fn trigger_remote_download(app: tauri::AppHandle, catalog_url: Option<String>) -> Result<(), String> {
    log::info!("Teacher triggered remote book download: {:?}", catalog_url);
    app.emit("remote_download_requested", catalog_url).map_err(|e| e.to_string())?;
    Ok(())
}
