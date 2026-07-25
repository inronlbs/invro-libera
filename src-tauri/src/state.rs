use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::fs;
use tokio::sync::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudentProfile {
    pub id: String,
    #[serde(rename = "classId")]
    pub class_id: String,
    #[serde(rename = "rollNumber")]
    pub roll_number: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Division {
    pub name: String,
    #[serde(rename = "studentCount")]
    pub student_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DivisionCreation {
    pub name: String,
    #[serde(rename = "startRoll")]
    pub start_roll: u32,
    #[serde(rename = "endRoll")]
    pub end_roll: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClassInfo {
    pub id: String,
    pub grade: String,          // LKG, UKG, 1-12
    pub divisions: Vec<Division>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppData {
    pub students: Vec<StudentProfile>,
    #[serde(default)]
    pub classes: Vec<ClassInfo>,
    #[serde(default)]
    pub school_name: String,
    #[serde(default)]
    pub lab_details: String,
    #[serde(default)]
    pub lab_incharge: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudentSessionInfo {
    pub student_id: String,
    pub book_id: Option<String>,
    pub last_seen: u64,
    pub force_logout: bool,
}

#[derive(Clone)]
pub struct AppState {
    pub data_file_path: PathBuf,
    pub data: Arc<RwLock<AppData>>,
    pub active_class: Arc<RwLock<Option<String>>>,
    pub live_sessions: Arc<RwLock<HashMap<String, StudentSessionInfo>>>,
    pub server_port: Arc<RwLock<u16>>,
}

impl AppState {
    pub async fn new(app_data_dir: PathBuf) -> Self {
        let mut data_file_path = app_data_dir.clone();
        data_file_path.push("db.json");

        let app_data = if data_file_path.exists() {
            match fs::read_to_string(&data_file_path).await {
                Ok(content) => serde_json::from_str(&content).unwrap_capacity_or_default(),
                Err(_) => AppData::default(),
            }
        } else {
            // Create dir if missing
            let _ = tokio::fs::create_dir_all(&app_data_dir).await;
            AppData::default()
        };

        Self {
            data_file_path,
            data: Arc::new(RwLock::new(app_data)),
            active_class: Arc::new(RwLock::new(None)),
            live_sessions: Arc::new(RwLock::new(HashMap::new())),
            server_port: Arc::new(RwLock::new(0)),
        }
    }

    pub async fn save(&self) {
        let guard = self.data.read().await;
        if let Ok(json) = serde_json::to_string_pretty(&*guard) {
            let _ = fs::write(&self.data_file_path, json).await;
        }
    }
}

// Tauri Commands for Host Panel

#[tauri::command]
pub async fn get_students(state: tauri::State<'_, AppState>) -> Result<Vec<StudentProfile>, String> {
    let app_data = state.data.read().await;
    Ok(app_data.students.clone())
}

#[tauri::command]
pub async fn get_server_port(state: tauri::State<'_, AppState>) -> Result<u16, String> {
    let port = state.server_port.read().await;
    Ok(*port)
}

#[tauri::command]
pub async fn get_local_ip() -> Result<String, String> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
    socket.connect("8.8.8.8:80").map_err(|e| e.to_string())?;
    let local_addr = socket.local_addr().map_err(|e| e.to_string())?;
    Ok(local_addr.ip().to_string())
}

#[tauri::command]
pub async fn import_roster(state: tauri::State<'_, AppState>, students: Vec<StudentProfile>) -> Result<(), String> {
    let mut app_data = state.data.write().await;
    app_data.students = students;
    // We don't save automatically here, maybe we should? Yes.
    drop(app_data);
    state.save().await;
    Ok(())
}



#[tauri::command]
pub async fn update_student(state: tauri::State<'_, AppState>, student: StudentProfile) -> Result<(), String> {
    let mut app_data = state.data.write().await;
    if let Some(existing) = app_data.students.iter_mut().find(|s| s.id == student.id) {
        *existing = student;
    }
    drop(app_data);
    state.save().await;
    Ok(())
}

#[tauri::command]
pub async fn delete_student(state: tauri::State<'_, AppState>, student_id: String) -> Result<(), String> {
    // 1. Force logout the student if they have an active session
    let mut live_sessions = state.live_sessions.write().await;
    if let Some(session) = live_sessions.get_mut(&student_id) {
        session.force_logout = true;
    } else {
        live_sessions.insert(student_id.clone(), StudentSessionInfo {
            student_id: student_id.clone(),
            book_id: None,
            last_seen: 0,
            force_logout: true,
        });
    }
    drop(live_sessions);

    // 2. Remove from roster
    let mut app_data = state.data.write().await;
    app_data.students.retain(|s| s.id != student_id);
    drop(app_data);
    state.save().await;
    
    crate::audit::log_event(state.data_file_path.parent().unwrap_or(std::path::Path::new(".")), "STUDENT_DELETED", &format!("Deleted student and kicked from active sessions: {}", student_id));
    
    Ok(())
}

#[tauri::command]
pub async fn start_session(state: tauri::State<'_, AppState>, class_id: String) -> Result<(), String> {
    let mut active = state.active_class.write().await;
    *active = Some(class_id.clone());
    drop(active);
    crate::audit::log_event(state.data_file_path.parent().unwrap_or(std::path::Path::new(".")), "SESSION_STARTED", &format!("Started broadcast session for class: {}", class_id));
    Ok(())
}

#[tauri::command]
pub async fn stop_session(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut active = state.active_class.write().await;
    *active = None;
    drop(active);
    crate::audit::log_event(state.data_file_path.parent().unwrap_or(std::path::Path::new(".")), "SESSION_ENDED", "Stopped active broadcast session.");
    Ok(())
}

#[tauri::command]
pub async fn get_active_session(state: tauri::State<'_, AppState>) -> Result<Option<String>, String> {
    let active = state.active_class.read().await;
    Ok(active.clone())
}

#[tauri::command]
pub async fn get_classes(state: tauri::State<'_, AppState>) -> Result<Vec<ClassInfo>, String> {
    let app_data = state.data.read().await;
    Ok(app_data.classes.clone())
}

#[tauri::command]
pub async fn create_class(state: tauri::State<'_, AppState>, grade: String, divisions: Vec<DivisionCreation>) -> Result<ClassInfo, String> {
    let mut app_data = state.data.write().await;

    // Generate school initials from school name
    let school_initials: String = app_data.school_name
        .split_whitespace()
        .filter_map(|word| word.chars().next())
        .map(|c| c.to_uppercase().to_string())
        .collect();
    let prefix = if school_initials.is_empty() { "STU".to_string() } else { school_initials };

    let mut new_divisions_for_class: Vec<Division> = Vec::new();
    let mut students_to_push = Vec::new();

    let mut existing_div_names = Vec::new();
    if let Some(existing_class) = app_data.classes.iter().find(|c| c.grade == grade) {
        existing_div_names = existing_class.divisions.iter().map(|d| d.name.clone()).collect();
    }

    for div_req in &divisions {
        if existing_div_names.contains(&div_req.name) {
            continue; // division already exists, handle merges separately
        }
        
        let class_id = format!("{} {}", grade, div_req.name);

        // Deduplication preliminary check
        for roll in div_req.start_roll..=div_req.end_roll {
            let roll_str = roll.to_string();
            if app_data.students.iter().any(|s| s.class_id == class_id && s.roll_number == roll_str) {
                return Err(format!("Roll number {} already exists in {} {}", roll, grade, div_req.name));
            }
        }

        // Generate students
        for roll in div_req.start_roll..=div_req.end_roll {
            let roll_str = roll.to_string();
            let student_id = format!("{}{}{}{}", prefix, grade, div_req.name, roll_str);
            let student = StudentProfile {
                id: student_id,
                class_id: class_id.clone(),
                roll_number: roll_str,
                name: format!("Student {}", roll),
            };
            students_to_push.push(student);
        }
        
        let student_count = if div_req.end_roll >= div_req.start_roll { div_req.end_roll - div_req.start_roll + 1 } else { 0 };
        new_divisions_for_class.push(Division {
            name: div_req.name.clone(),
            student_count,
        });
    }

    app_data.students.extend(students_to_push);

    let return_class = if let Some(existing) = app_data.classes.iter_mut().find(|c| c.grade == grade) {
        existing.divisions.extend(new_divisions_for_class);
        existing.clone()
    } else {
        let new_class = ClassInfo {
            id: grade.clone(),
            grade: grade.clone(),
            divisions: new_divisions_for_class,
        };
        app_data.classes.push(new_class.clone());
        new_class
    };

    drop(app_data);
    state.save().await;
    
    crate::audit::log_event(state.data_file_path.parent().unwrap_or(std::path::Path::new(".")), "CLASS_CREATED", &format!("Created or updated class division for Grade {}", return_class.grade));
    
    Ok(return_class)
}

#[tauri::command]
pub async fn delete_class(state: tauri::State<'_, AppState>, class_id: String) -> Result<(), String> {
    // 1. Kick students and end session if necessary
    let mut active = state.active_class.write().await;
    if active.as_deref() == Some(class_id.as_str()) {
        *active = None;
        let mut live_sessions = state.live_sessions.write().await;
        live_sessions.clear(); // kicking all students since the session ended
        drop(live_sessions);
    } else {
        let app_data = state.data.read().await;
        if let Some(class_info) = app_data.classes.iter().find(|c| c.id == class_id) {
            let mut live_sessions = state.live_sessions.write().await;
            for div in &class_info.divisions {
                let prefix = format!("{} {}", class_info.grade, div.name);
                for student in app_data.students.iter().filter(|s| s.class_id == prefix) {
                    if let Some(session) = live_sessions.get_mut(&student.id) {
                        session.force_logout = true;
                    }
                }
            }
            drop(live_sessions);
        }
        drop(app_data);
    }
    drop(active);

    // 2. Remove the class and drop all its students
    let mut app_data = state.data.write().await;

    if let Some(class_info) = app_data.classes.iter().find(|c| c.id == class_id).cloned() {
        for div in &class_info.divisions {
            let prefix = format!("{} {}", class_info.grade, div.name);
            app_data.students.retain(|s| s.class_id != prefix);
        }
    }

    app_data.classes.retain(|c| c.id != class_id);
    drop(app_data);
    state.save().await;
    
    crate::audit::log_event(state.data_file_path.parent().unwrap_or(std::path::Path::new(".")), "CLASS_DELETED", &format!("Deleted class record and dropped student IDs for: {}", class_id));

    Ok(())
}

#[tauri::command]
pub async fn rename_class(state: tauri::State<'_, AppState>, class_id: String, new_grade: String) -> Result<(), String> {
    let mut app_data = state.data.write().await;
    
    let mut rename_operations = Vec::new();
    if let Some(class_info) = app_data.classes.iter_mut().find(|c| c.id == class_id) {
        let old_grade = class_info.grade.clone();
        class_info.grade = new_grade.clone();
        
        for div in &class_info.divisions {
            rename_operations.push((format!("{} {}", old_grade, div.name), format!("{} {}", new_grade, div.name)));
        }
    }
    
    // Cascade rename class_id string in all students
    for (old_prefix, new_prefix) in rename_operations {
        for student in &mut app_data.students {
            if student.class_id == old_prefix {
                student.class_id = new_prefix.clone();
            }
        }
    }
    
    drop(app_data);
    state.save().await;
    Ok(())
}

#[tauri::command]
pub async fn add_class_division(state: tauri::State<'_, AppState>, class_id: String, division_name: String, start_roll: u32, end_roll: u32) -> Result<(), String> {
    let mut app_data = state.data.write().await;
    
    let mut new_students_info = Vec::new();
    if let Some(class_info) = app_data.classes.iter_mut().find(|c| c.id == class_id) {
        if !class_info.divisions.iter().any(|d| d.name == division_name) {
            let student_count = if end_roll >= start_roll { end_roll - start_roll + 1 } else { 0 };
            class_info.divisions.push(Division {
                name: division_name.clone(),
                student_count,
            });
            new_students_info.push((class_info.grade.clone(), division_name.clone(), start_roll, end_roll));
        } else {
            return Err(format!("Division {} already exists", division_name));
        }
    } else {
        return Err("Class not found".to_string());
    }
    
    for (grade, div_name, start, end) in new_students_info {
        let school_initials: String = app_data.school_name
            .split_whitespace()
            .filter_map(|word| word.chars().next())
            .map(|c| c.to_uppercase().to_string())
            .collect();
        let prefix = if school_initials.is_empty() { "STU".to_string() } else { school_initials };
        
        let class_id_str = format!("{} {}", grade, div_name);
        
        // Deduplicate check
        for roll in start..=end {
            let roll_str = roll.to_string();
            if app_data.students.iter().any(|s| s.class_id == class_id_str && s.roll_number == roll_str) {
                return Err(format!("Roll number {} already exists! Generation safely aborted.", roll));
            }
        }

        for roll in start..=end {
            let roll_str = roll.to_string();
            let student_id = format!("{}{}{}{}", prefix, grade, div_name, roll_str);
            
            app_data.students.push(StudentProfile {
                id: student_id,
                class_id: class_id_str.clone(),
                roll_number: roll_str,
                name: format!("Student {}", roll),
            });
        }
    }
    
    drop(app_data);
    state.save().await;
    Ok(())
}

#[tauri::command]
pub async fn generate_students_block(state: tauri::State<'_, AppState>, class_id: String, division_name: String, start_roll: u32, end_roll: u32) -> Result<(), String> {
    let mut app_data = state.data.write().await;
    
    let grade_str = match app_data.classes.iter().find(|c| c.id == class_id) {
        Some(class_info) => {
            if !class_info.divisions.iter().any(|d| d.name == division_name) {
                return Err("Division not found".to_string());
            }
            class_info.grade.clone()
        }
        None => return Err("Class not found".to_string()),
    };

    let class_id_str = format!("{} {}", grade_str, division_name);

    // Pre-flight check for ANY duplicates in the requested range
    for roll in start_roll..=end_roll {
        let roll_str = roll.to_string();
        if app_data.students.iter().any(|s| s.class_id == class_id_str && s.roll_number == roll_str) {
            return Err(format!("Roll number {} already exists! Generation safely aborted.", roll));
        }
    }

    let school_initials: String = app_data.school_name
        .split_whitespace()
        .filter_map(|word| word.chars().next())
        .map(|c| c.to_uppercase().to_string())
        .collect();
    let prefix = if school_initials.is_empty() { "STU".to_string() } else { school_initials };

    let count_added = if end_roll >= start_roll { end_roll - start_roll + 1 } else { 0 };

    for roll in start_roll..=end_roll {
        let roll_str = roll.to_string();
        let student_id = format!("{}{}{}{}", prefix, grade_str, division_name, roll_str);
        app_data.students.push(StudentProfile {
            id: student_id,
            class_id: class_id_str.clone(),
            roll_number: roll_str,
            name: format!("Student {}", roll),
        });
    }

    // Update the visual student_count on the Division struct
    if let Some(class_info) = app_data.classes.iter_mut().find(|c| c.id == class_id) {
        if let Some(div) = class_info.divisions.iter_mut().find(|d| d.name == division_name) {
            div.student_count += count_added;
        }
    }
    
    drop(app_data);
    state.save().await;
    Ok(())
}

#[tauri::command]
pub async fn delete_class_division(state: tauri::State<'_, AppState>, class_id: String, division_name: String) -> Result<(), String> {
    let mut app_data = state.data.write().await;
    
    if let Some(class_info) = app_data.classes.iter_mut().find(|c| c.id == class_id) {
        class_info.divisions.retain(|d| d.name != division_name);
        
        let prefix = format!("{} {}", class_info.grade, division_name);
        app_data.students.retain(|s| s.class_id != prefix);
    }
    
    drop(app_data);
    state.save().await;
    Ok(())
}

#[tauri::command]
pub async fn add_student(state: tauri::State<'_, AppState>, class_id: String, division_name: String, name: String, roll_number: String) -> Result<(), String> {
    let mut app_data = state.data.write().await;
    
    let mut grade_name = None;
    if let Some(class_info) = app_data.classes.iter_mut().find(|c| c.id == class_id) {
        // Increase student_count in the division
        if let Some(div) = class_info.divisions.iter_mut().find(|d| d.name == division_name) {
            div.student_count += 1;
        }
        grade_name = Some(class_info.grade.clone());
    }

    if let Some(grade) = grade_name {
        let school_initials: String = app_data.school_name
            .split_whitespace()
            .filter_map(|word| word.chars().next())
            .map(|c| c.to_uppercase().to_string())
            .collect();
        let prefix = if school_initials.is_empty() { "STU".to_string() } else { school_initials };
        
        // Ensure unique ID
        let student_id = format!("{}{}{}{}-{}", prefix, grade, division_name, roll_number, std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis());
        let class_id_str = format!("{} {}", grade, division_name);
        
        app_data.students.push(StudentProfile {
            id: student_id,
            class_id: class_id_str,
            roll_number,
            name,
        });
    }
    
    drop(app_data);
    state.save().await;
    Ok(())
}

#[tauri::command]
pub async fn set_school_name(state: tauri::State<'_, AppState>, name: String) -> Result<(), String> {
    let mut app_data = state.data.write().await;
    app_data.school_name = name;
    drop(app_data);
    state.save().await;
    Ok(())
}

#[tauri::command]
pub async fn get_school_name(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let app_data = state.data.read().await;
    Ok(app_data.school_name.clone())
}

#[tauri::command]
pub async fn set_lab_details(state: tauri::State<'_, AppState>, details: String) -> Result<(), String> {
    let mut app_data = state.data.write().await;
    app_data.lab_details = details;
    drop(app_data);
    state.save().await;
    Ok(())
}

#[tauri::command]
pub async fn get_lab_details(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let app_data = state.data.read().await;
    Ok(app_data.lab_details.clone())
}

#[tauri::command]
pub async fn set_lab_incharge(state: tauri::State<'_, AppState>, incharge: String) -> Result<(), String> {
    let mut app_data = state.data.write().await;
    app_data.lab_incharge = incharge;
    drop(app_data);
    state.save().await;
    Ok(())
}

#[tauri::command]
pub async fn get_lab_incharge(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let app_data = state.data.read().await;
    Ok(app_data.lab_incharge.clone())
}
#[tauri::command]
pub async fn end_session(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut active = state.active_class.write().await;
    *active = None;
    
    // Clear live sessions
    let mut live_sessions = state.live_sessions.write().await;
    let dropped_count = live_sessions.len();
    live_sessions.clear();
    
    crate::audit::log_event(state.data_file_path.parent().unwrap_or(std::path::Path::new(".")), "SESSION_ENDED", &format!("Manually ended active session and disconnected {} students.", dropped_count));

    Ok(())
}

#[tauri::command]
pub async fn kick_student(state: tauri::State<'_, AppState>, student_id: String) -> Result<(), String> {
    let mut live_sessions = state.live_sessions.write().await;
    if let Some(session) = live_sessions.get_mut(&student_id) {
        session.force_logout = true;
    } else {
        live_sessions.insert(student_id.clone(), StudentSessionInfo {
            student_id,
            book_id: None,
            last_seen: 0,
            force_logout: true,
        });
    }
    Ok(())
}

#[tauri::command]
pub async fn get_active_students(state: tauri::State<'_, AppState>) -> Result<Vec<StudentSessionInfo>, String> {
    let live_sessions = state.live_sessions.read().await;
    
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();
    
    let active: Vec<StudentSessionInfo> = live_sessions.values()
        .filter(|s| !s.force_logout && now.saturating_sub(s.last_seen) < 15)
        .cloned()
        .collect();
        
    Ok(active)
}

#[tauri::command]
pub async fn clear_roster(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut app_data = state.data.write().await;
    app_data.students.clear();
    app_data.classes.clear();
    
    // Also disconnect any active users
    let mut active = state.active_class.write().await;
    *active = None;
    let mut live_sessions = state.live_sessions.write().await;
    live_sessions.clear();

    drop(app_data);
    state.save().await;
    
    crate::audit::log_event(state.data_file_path.parent().unwrap_or(std::path::Path::new(".")), "ROSTER_WIPE", "Initiated active roster wipe. Destroyed all students and classes.");

    Ok(())
}

#[tauri::command]
pub async fn clear_school_data(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut app_data = state.data.write().await;
    app_data.students.clear();
    app_data.classes.clear();
    app_data.school_name = String::new();
    app_data.lab_details = String::new();
    app_data.lab_incharge = String::new();
    
    // Also disconnect any active users
    let mut active = state.active_class.write().await;
    *active = None;
    let mut live_sessions = state.live_sessions.write().await;
    live_sessions.clear();

    drop(app_data);
    state.save().await;
    
    crate::audit::log_event(state.data_file_path.parent().unwrap_or(std::path::Path::new(".")), "DATA_WIPE", "Initiated catastrophic permanent factory reset. Destroyed roster and settings.");

    Ok(())
}

trait SerdeJsonExt<T> {
    fn unwrap_capacity_or_default(self) -> T;
}

impl<T: Default> SerdeJsonExt<T> for Result<T, serde_json::Error> {
    fn unwrap_capacity_or_default(self) -> T {
        self.unwrap_or_else(|_| T::default())
    }
}
