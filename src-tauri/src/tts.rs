use tauri::command;
use std::process::Command;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[command]
pub fn check_natural_voices() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let output = Command::new("powershell")
            .args(&[
                "-NoProfile",
                "-Command",
                r#"
                $path = "HKLM:\SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens"
                if (Test-Path $path) {
                    $onecore_voices = @(Get-ChildItem -Path $path | Select-Object -ExpandProperty PSChildName)
                    $sapi_path = "HKLM:\SOFTWARE\Microsoft\Speech\Voices\Tokens"
                    $sapi_hkcu = "HKCU:\SOFTWARE\Microsoft\Speech\Voices\Tokens"
                    $sapi_voices = @()
                    if (Test-Path $sapi_path) {
                        $sapi_voices += @(Get-ChildItem -Path $sapi_path | Select-Object -ExpandProperty PSChildName)
                    }
                    if (Test-Path $sapi_hkcu) {
                        $sapi_voices += @(Get-ChildItem -Path $sapi_hkcu | Select-Object -ExpandProperty PSChildName)
                    }
                    
                    if ($onecore_voices.Count -eq 0) {
                        return "not_installed"
                    }
                    
                    $hidden_voices = @($onecore_voices | Where-Object { $sapi_voices -notcontains $_ })
                    
                    if ($hidden_voices.Count -gt 0) {
                        return "installed_hidden"
                    }
                    
                    if ($sapi_voices.Count -gt 3) {
                        return "unlocked"
                    }
                    return "not_installed"
                }
                return "not_installed"
                "#,
            ])
            .creation_flags(0x08000000)
            .output()
            .map_err(|e| e.to_string())?;

        let result = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Ok(result);
    }
    
    #[cfg(not(target_os = "windows"))]
    {
        Ok("not_windows".to_string())
    }
}

#[command]
pub fn unlock_natural_voices() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let output = Command::new("powershell")
            .args(&[
                "-NoProfile",
                "-Command",
                r#"
                $source = "HKLM:\SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens"
                $dest = "HKCU:\SOFTWARE\Microsoft\Speech\Voices\Tokens"
                Copy-Item -Path $source\* -Destination $dest -Recurse -Force
                return $true
                "#,
            ])
            .creation_flags(0x08000000)
            .output()
            .map_err(|e| e.to_string())?;

        Ok(output.status.success())
    }
    
    #[cfg(not(target_os = "windows"))]
    {
        Ok(false)
    }
}

#[command]
pub fn open_narrator_settings() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let output = Command::new("cmd")
            .args(&["/C", "start ms-settings:easeofaccess-narrator"])
            .creation_flags(0x08000000)
            .output()
            .map_err(|e| e.to_string())?;

        Ok(output.status.success())
    }
    
    #[cfg(not(target_os = "windows"))]
    {
        Ok(false)
    }
}
