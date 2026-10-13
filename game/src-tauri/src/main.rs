// Ventana nativa ligera (WebView2 de Windows); toda la app es la interfaz React de ../src.
// Las actualizaciones se bajan del servidor de caja por la red local y van firmadas:
// solo se instala lo que salió del repo (la llave pública está en tauri.conf.json).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use tauri_plugin_updater::UpdaterExt;

fn updater(app: &tauri::AppHandle, url: &str) -> Result<tauri_plugin_updater::Updater, String> {
    let url = tauri::Url::parse(url).map_err(|e| e.to_string())?;
    app.updater_builder().endpoints(vec![url]).and_then(|b| b.build()).map_err(|e| e.to_string())
}

// Devuelve la versión nueva disponible, o nada si ya está al día.
#[tauri::command]
async fn buscar_actualizacion(app: tauri::AppHandle, url: String) -> Result<Option<String>, String> {
    let update = updater(&app, &url)?.check().await.map_err(|e| e.to_string())?;
    Ok(update.map(|u| u.version))
}

// Baja, verifica la firma e instala; en Windows el instalador cierra y vuelve a abrir la app.
#[tauri::command]
async fn instalar_actualizacion(app: tauri::AppHandle, url: String) -> Result<(), String> {
    if let Some(u) = updater(&app, &url)?.check().await.map_err(|e| e.to_string())? {
        u.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
        app.restart();
    }
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![buscar_actualizacion, instalar_actualizacion])
        .run(tauri::generate_context!())
        .expect("no se pudo iniciar la app");
}
