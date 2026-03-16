use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConnectionConfig {
    #[serde(rename = "connectionString")]
    pub connection_string: String,
    #[serde(rename = "dbType")]
    pub db_type: DatabaseType,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub enum DatabaseType {
    MSSQL,
    MySQL,
    SQLite,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TableComparison {
    pub name: String,
    pub status: ComparisonStatus,
    pub source_definition: Option<String>,
    pub target_definition: Option<String>,
    pub columns: Vec<ColumnComparison>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ColumnComparison {
    pub name: String,
    pub data_type: String,
    pub is_nullable: bool,
    pub status: ComparisonStatus,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StoredProcComparison {
    pub name: String,
    pub status: ComparisonStatus,
    pub source_definition: Option<String>,
    pub target_definition: Option<String>,
    pub diff: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FunctionComparison {
    pub name: String,
    pub status: ComparisonStatus,
    pub source_definition: Option<String>,
    pub target_definition: Option<String>,
    pub diff: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub enum ComparisonStatus {
    Identical,
    Added,
    Removed,
    Modified,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ComparisonResult {
    pub tables: Vec<TableComparison>,
    pub stored_procs: Vec<StoredProcComparison>,
    pub functions: Vec<FunctionComparison>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SavedConnection {
    pub id: String,
    pub name: String,
    pub connection_string: String,
    pub db_type: DatabaseType,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SavedConnectionsData {
    pub connections: Vec<SavedConnection>,
}

mod db_mssql;

#[tauri::command]
async fn test_connection(config: ConnectionConfig) -> Result<bool, String> {
    match config.db_type {
        DatabaseType::MSSQL => db_mssql::test_connection(&config.connection_string).await,
        _ => Err("Database type not yet implemented".to_string()),
    }
}

#[tauri::command]
async fn compare_databases(
    source: ConnectionConfig,
    target: ConnectionConfig,
) -> Result<ComparisonResult, String> {
    if source.db_type != target.db_type {
        return Err("Cannot compare different database types".to_string());
    }

    match source.db_type {
        DatabaseType::MSSQL => db_mssql::compare_databases(&source.connection_string, &target.connection_string).await,
        _ => Err("Database type not yet implemented".to_string()),
    }
}

#[tauri::command]
fn generate_diff(original: String, modified: String) -> String {
    let patch = diffy::create_patch(&original, &modified);
    patch.to_string()
}

fn get_connections_file_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    
    fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Failed to create app data dir: {}", e))?;
    
    Ok(app_data_dir.join("saved_connections.json"))
}

fn load_saved_connections_data(app_handle: &tauri::AppHandle) -> Result<SavedConnectionsData, String> {
    let file_path = get_connections_file_path(app_handle)?;
    
    if !file_path.exists() {
        return Ok(SavedConnectionsData::default());
    }
    
    let content = fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read connections file: {}", e))?;
    
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse connections file: {}", e))
}

fn save_connections_data(app_handle: &tauri::AppHandle, data: &SavedConnectionsData) -> Result<(), String> {
    let file_path = get_connections_file_path(app_handle)?;
    
    let content = serde_json::to_string_pretty(data)
        .map_err(|e| format!("Failed to serialize connections: {}", e))?;
    
    fs::write(&file_path, content)
        .map_err(|e| format!("Failed to write connections file: {}", e))
}

#[tauri::command]
async fn load_saved_connections(app_handle: tauri::AppHandle) -> Result<Vec<SavedConnection>, String> {
    let data = load_saved_connections_data(&app_handle)?;
    Ok(data.connections)
}

#[tauri::command]
async fn save_connection(
    app_handle: tauri::AppHandle,
    connection: SavedConnection,
) -> Result<SavedConnection, String> {
    let mut data = load_saved_connections_data(&app_handle)?;
    
    // Check if connection with same ID exists
    if let Some(index) = data.connections.iter().position(|c| c.id == connection.id) {
        data.connections[index] = connection.clone();
    } else {
        data.connections.push(connection.clone());
    }
    
    save_connections_data(&app_handle, &data)?;
    Ok(connection)
}

#[tauri::command]
async fn delete_connection(app_handle: tauri::AppHandle, id: String) -> Result<(), String> {
    let mut data = load_saved_connections_data(&app_handle)?;
    data.connections.retain(|c| c.id != id);
    save_connections_data(&app_handle, &data)
}

#[tauri::command]
async fn execute_sql_script(
    connection_string: String,
    db_type: DatabaseType,
    script: String,
) -> Result<(), String> {
    match db_type {
        DatabaseType::MSSQL => db_mssql::execute_script(&connection_string, &script).await,
        _ => Err("Database type not yet implemented".to_string()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|_app, _argv, _cwd| {
            // When a new instance is attempted, focus the existing window
        }))
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            test_connection,
            compare_databases,
            generate_diff,
            load_saved_connections,
            save_connection,
            delete_connection,
            execute_sql_script
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
