mod vault;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(vault::VaultState::default())
        .invoke_handler(tauri::generate_handler![
            vault::open_vault,
            vault::list_vault,
            vault::create_notebook,
            vault::rename_notebook,
            vault::delete_notebook,
            vault::read_note,
            vault::write_note,
            vault::create_note,
            vault::rename_note,
            vault::delete_note,
            vault::read_canvas,
            vault::write_canvas,
            vault::create_canvas,
            vault::rename_canvas,
            vault::delete_canvas,
            vault::write_agent_guide,
            vault::import_pdf,
            vault::read_pdf,
            vault::rename_pdf,
            vault::delete_pdf,
            vault::read_highlights,
            vault::write_highlights,
            vault::read_text_cache,
            vault::write_text_cache,
            vault::export_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
