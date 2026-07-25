pub mod books;
pub mod state;
pub mod audit;
pub mod tts;
pub mod telemetry;
pub mod license;

use tauri::Manager;
use tauri::image::Image;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // Set the window icon explicitly so it shows in the taskbar (dev + release)
      if let Some(window) = app.get_webview_window("main") {
        let icon_bytes = include_bytes!("../icons/icon.png");
        if let Ok(icon) = Image::from_bytes(icon_bytes) {
          let _ = window.set_icon(icon);
        }
      }
      
      let app_dir = app.path().app_data_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
      
      tauri::async_runtime::block_on(async move {
          let app_state = state::AppState::new(app_dir).await;
          app.manage(app_state.clone());
      });

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
        state::get_students,
        state::import_roster,
        state::add_student,
        state::update_student,
        state::delete_student,
        state::start_session,
        state::stop_session,
        state::get_active_session,
        state::get_classes,
        state::create_class,
        state::delete_class,
        state::set_school_name,
        state::get_school_name,
        state::set_lab_details,
        state::get_lab_details,
        state::set_lab_incharge,
        state::get_lab_incharge,
        state::end_session,
        state::kick_student,
        state::get_active_students,
        state::clear_roster,
        state::clear_school_data,
        state::rename_class,
        state::add_class_division,
        state::delete_class_division,
        state::generate_students_block,
        state::get_server_port,
        state::get_local_ip,
        books::import_book,
        books::import_books_from_directory,
        books::import_invronpack,
        books::get_book_catalog,
        books::get_book_cover,
        books::prepare_epub_streaming,
        books::delete_book,
        books::update_book,
        books::clear_catalog,
        books::fetch_cloud_manifest,
        books::download_cloud_pack,
        audit::get_audit_logs,
        audit::log_frontend_event,
        tts::check_natural_voices,
        tts::unlock_natural_voices,
        tts::open_narrator_settings,
        telemetry::discover_teacher_host,
        telemetry::send_telemetry_ping,
        telemetry::trigger_remote_download,
        license::get_device_fingerprint,
        license::verify_standalone_license,
        license::get_license_status,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
