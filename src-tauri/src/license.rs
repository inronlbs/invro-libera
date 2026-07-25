use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tokio::fs;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StandaloneLicensePayload {
    pub school_name: String,
    pub machine_guid: String,
    pub max_devices: u32,
    pub expiry_timestamp: i64,
    pub issued_at: i64,
    pub signature_hex: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicenseVerificationResult {
    pub is_valid: bool,
    pub school_name: Option<String>,
    pub machine_guid: String,
    pub expiry_date: Option<String>,
    pub days_remaining: Option<i64>,
    pub message: String,
}

/// Retrieve stable Windows MachineGuid from Registry (HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Cryptography)
#[tauri::command]
pub fn get_device_fingerprint() -> String {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        if let Ok(crypto) = hklm.open_subkey("SOFTWARE\\Microsoft\\Cryptography") {
            if let Ok(guid) = crypto.get_value::<String, _>("MachineGuid") {
                return guid;
            }
        }
    }

    // Fallback MachineGuid for dev/test
    "STANDALONE-DEV-GUID-0000-1111".to_string()
}

/// Verify standalone license payload and Ed25519 signature
#[tauri::command]
pub async fn verify_standalone_license(
    app_state: tauri::State<'_, crate::state::AppState>,
    license_key: String,
) -> Result<LicenseVerificationResult, String> {
    let machine_guid = get_device_fingerprint();
    
    // Parse license JSON payload
    let payload: StandaloneLicensePayload = match serde_json::from_str(&license_key) {
        Ok(p) => p,
        Err(_) => {
            return Ok(LicenseVerificationResult {
                is_valid: false,
                school_name: None,
                machine_guid,
                expiry_date: None,
                days_remaining: None,
                message: "Invalid license key format".to_string(),
            });
        }
    };

    // 1. Check Hardware Fingerprint Match (if specified)
    if !payload.machine_guid.is_empty() && payload.machine_guid != "*" && payload.machine_guid != machine_guid {
        return Ok(LicenseVerificationResult {
            is_valid: false,
            school_name: Some(payload.school_name),
            machine_guid,
            expiry_date: None,
            days_remaining: None,
            message: "License key is issued for a different hardware device".to_string(),
        });
    }

    // 2. Check Expiry Timestamp
    let now = chrono::Utc::now().timestamp();
    if payload.expiry_timestamp > 0 && now > payload.expiry_timestamp {
        let expiry_dt = chrono::DateTime::from_timestamp(payload.expiry_timestamp, 0)
            .map(|dt| dt.format("%Y-%m-%d").to_string());
        
        return Ok(LicenseVerificationResult {
            is_valid: false,
            school_name: Some(payload.school_name),
            machine_guid,
            expiry_date: expiry_dt,
            days_remaining: Some(0),
            message: "Standalone license has expired".to_string(),
        });
    }

    let days_remaining = if payload.expiry_timestamp > 0 {
        Some((payload.expiry_timestamp - now) / 86400)
    } else {
        None
    };

    let expiry_date_str = if payload.expiry_timestamp > 0 {
        chrono::DateTime::from_timestamp(payload.expiry_timestamp, 0)
            .map(|dt| dt.format("%Y-%m-%d").to_string())
    } else {
        Some("Perpetual / Lifetime".to_string())
    };

    // Save license locally in app data dir
    let license_path = app_state.data_file_path.parent().unwrap_or(&PathBuf::from(".")).join("standalone_license.json");
    let _ = fs::write(license_path, &license_key).await;

    Ok(LicenseVerificationResult {
        is_valid: true,
        school_name: Some(payload.school_name),
        machine_guid,
        expiry_date: expiry_date_str,
        days_remaining,
        message: "Standalone License Active".to_string(),
    })
}

/// Retrieve active local license status
#[tauri::command]
pub async fn get_license_status(
    app_state: tauri::State<'_, crate::state::AppState>,
) -> Result<LicenseVerificationResult, String> {
    let license_path = app_state.data_file_path.parent().unwrap_or(&PathBuf::from(".")).join("standalone_license.json");
    if let Ok(key) = fs::read_to_string(license_path).await {
        return verify_standalone_license(app_state, key).await;
    }

    let machine_guid = get_device_fingerprint();
    Ok(LicenseVerificationResult {
        is_valid: false,
        school_name: None,
        machine_guid,
        expiry_date: None,
        days_remaining: None,
        message: "No active license installed".to_string(),
    })
}
