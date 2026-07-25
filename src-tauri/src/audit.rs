use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::io::Write;
use chrono::Utc;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AuditLogEntry {
    pub timestamp: String,
    pub action: String,
    pub details: String,
}

pub fn log_event(app_dir: &std::path::Path, action: &str, details: &str) {
    let logs_path = app_dir.join("server_audit.jsonl");

    let entry = AuditLogEntry {
        // Log explicitly in ISO 8601 for accurate chronological ordering
        timestamp: Utc::now().to_rfc3339(),
        action: action.to_string(),
        details: details.to_string(),
    };

    if let Ok(json_entry) = serde_json::to_string(&entry) {
        // We use an Append-only unbuffered writer to stream safely straight to disk
        // This stops the app from needing to bloat memory reading old logs!
        if let Ok(mut file) = OpenOptions::new()
            .create(true)
            .append(true)
            .open(logs_path)
        {
            let _ = writeln!(file, "{}", json_entry);
        }
    }
}

// And an IPC endpoint to fetch these logs for the HostSettings page
#[tauri::command]
pub async fn get_audit_logs(state: tauri::State<'_, crate::state::AppState>) -> Result<Vec<AuditLogEntry>, String> {
    let logs_path = state.data_file_path.parent().unwrap_or(std::path::Path::new(".")).join("server_audit.jsonl");
    
    if !logs_path.exists() {
        return Ok(Vec::new());
    }
    
    let contents = std::fs::read_to_string(logs_path).map_err(|e| e.to_string())?;
    
    // Parse each line manually
    let mut logs = Vec::new();
    for line in contents.lines() {
        if let Ok(entry) = serde_json::from_str::<AuditLogEntry>(line) {
            logs.push(entry);
        }
    }
    // Most recent logs at the top
    logs.reverse();
    Ok(logs)
}

#[tauri::command]
pub async fn log_frontend_event(state: tauri::State<'_, crate::state::AppState>, action: String, details: String) -> Result<(), String> {
    log_event(state.data_file_path.parent().unwrap_or(std::path::Path::new(".")), &action, &details);
    Ok(())
}
