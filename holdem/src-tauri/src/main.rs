// Ventana nativa ligera (WebView2 de Windows); toda la app es la interfaz React de ../src.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("no se pudo iniciar la app");
}
