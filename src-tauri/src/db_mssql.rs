use crate::*;
use tiberius::{Client, Config, AuthMethod};
use tokio::net::TcpStream;
use tokio_util::compat::TokioAsyncWriteCompatExt;
use std::collections::HashMap;
use futures_util::TryStreamExt;

pub async fn test_connection(connection_string: &str) -> Result<bool, String> {
    let (host, port, config) = parse_connection_string(connection_string)?;
    
    let tcp = TcpStream::connect(format!("{}:{}", host, port))
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;
    
    let mut client = Client::connect(config, tcp.compat_write())
        .await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    
    let _ = client.query("SELECT 1", &[])
        .await
        .map_err(|e| format!("Query failed: {}", e))?;
    
    Ok(true)
}

fn parse_connection_string(conn_str: &str) -> Result<(String, u16, Config), String> {
    let mut config = Config::new();
    let mut host = "localhost".to_string();
    let mut port: u16 = 1433;
    
    let parts: HashMap<String, String> = conn_str
        .split(';')
        .filter_map(|part| {
            let mut kv = part.splitn(2, '=');
            if let (Some(key), Some(value)) = (kv.next(), kv.next()) {
                Some((key.trim().to_lowercase(), value.trim().to_string()))
            } else {
                None
            }
        })
        .collect();
    
    if let Some(server) = parts.get("server") {
        let server_parts: Vec<&str> = server.split(',').collect();
        host = server_parts[0].to_string();
        if server_parts.len() > 1 {
            if let Ok(p) = server_parts[1].parse::<u16>() {
                port = p;
            }
        }
        config.host(&host);
        config.port(port);
    } else if let Some(server) = parts.get("data source") {
        let server_parts: Vec<&str> = server.split(',').collect();
        host = server_parts[0].to_string();
        if server_parts.len() > 1 {
            if let Ok(p) = server_parts[1].parse::<u16>() {
                port = p;
            }
        }
        config.host(&host);
        config.port(port);
    } else {
        return Err("Server not specified in connection string".to_string());
    }
    
    if let Some(database) = parts.get("initial catalog") {
        config.database(database);
    } else if let Some(database) = parts.get("database") {
        config.database(database);
    }
    
    if let (Some(user), Some(pass)) = (parts.get("user id"), parts.get("password")) {
        config.authentication(AuthMethod::sql_server(user, pass));
    } else if let (Some(user), Some(pass)) = (parts.get("uid"), parts.get("pwd")) {
        config.authentication(AuthMethod::sql_server(user, pass));
    } else {
        config.authentication(AuthMethod::None);
    }
    
    config.trust_cert();
    Ok((host, port, config))
}

pub async fn compare_databases(
    source_conn: &str,
    target_conn: &str,
) -> Result<ComparisonResult, String> {
    let (source_host, source_port, source_config) = parse_connection_string(source_conn)?;
    let (target_host, target_port, target_config) = parse_connection_string(target_conn)?;
    
    let source_tcp = TcpStream::connect(format!("{}:{}", source_host, source_port))
        .await
        .map_err(|e| format!("Source connection failed: {}", e))?;
    
    let mut source_client = Client::connect(source_config, source_tcp.compat_write())
        .await
        .map_err(|e| format!("Failed to connect to source: {}", e))?;
    
    let target_tcp = TcpStream::connect(format!("{}:{}", target_host, target_port))
        .await
        .map_err(|e| format!("Target connection failed: {}", e))?;
    
    let mut target_client = Client::connect(target_config, target_tcp.compat_write())
        .await
        .map_err(|e| format!("Failed to connect to target: {}", e))?;
    
    let tables = compare_tables(&mut source_client, &mut target_client).await?;
    let stored_procs = compare_stored_procs(&mut source_client, &mut target_client).await?;
    let functions = compare_functions(&mut source_client, &mut target_client).await?;
    
    Ok(ComparisonResult {
        tables,
        stored_procs,
        functions,
    })
}

async fn compare_tables(
    source: &mut Client<tokio_util::compat::Compat<TcpStream>>,
    target: &mut Client<tokio_util::compat::Compat<TcpStream>>,
) -> Result<Vec<TableComparison>, String> {
    let source_tables = get_tables(source).await?;
    let target_tables = get_tables(target).await?;
    
    let mut comparisons = Vec::new();
    let all_table_names: std::collections::HashSet<String> = source_tables
        .keys()
        .chain(target_tables.keys())
        .cloned()
        .collect();
    
    for table_name in all_table_names {
        let source_def = source_tables.get(&table_name);
        let target_def = target_tables.get(&table_name);
        
        let status = match (source_def, target_def) {
            (Some(_), None) => ComparisonStatus::Removed,
            (None, Some(_)) => ComparisonStatus::Added,
            (Some(s), Some(t)) => {
                if s == t {
                    ComparisonStatus::Identical
                } else {
                    ComparisonStatus::Modified
                }
            }
            (None, None) => continue,
        };
        
        let source_columns = if source_def.is_some() {
            get_table_columns(source, &table_name).await.ok()
        } else {
            None
        };
        
        let target_columns = if target_def.is_some() {
            get_table_columns(target, &table_name).await.ok()
        } else {
            None
        };
        
        let columns = compare_columns(source_columns, target_columns);
        
        comparisons.push(TableComparison {
            name: table_name,
            status,
            source_definition: source_def.cloned(),
            target_definition: target_def.cloned(),
            columns,
        });
    }
    
    Ok(comparisons)
}

async fn get_tables(
    client: &mut Client<tokio_util::compat::Compat<TcpStream>>,
) -> Result<HashMap<String, String>, String> {
    let sql = r#"
        SELECT 
            t.name AS table_name,
            SCHEMA_NAME(t.schema_id) AS schema_name
        FROM sys.tables t
        WHERE t.is_ms_shipped = 0
        ORDER BY t.name
    "#;
    
    let stream = client.query(sql, &[])
        .await
        .map_err(|e| format!("Failed to query tables: {}", e))?;
    
    let mut tables = HashMap::new();
    
    let results = stream.into_results()
        .await
        .map_err(|e| format!("Failed to get results: {}", e))?;
    
    for row in results.iter().flat_map(|r| r.iter()) {
        let table_name: &str = row.try_get("table_name")
            .map_err(|e| format!("Failed to get table_name: {}", e))?
            .unwrap_or("");
        let schema_name: &str = row.try_get("schema_name")
            .map_err(|e| format!("Failed to get schema_name: {}", e))?
            .unwrap_or("");
        let full_name = format!("{}.{}", schema_name, table_name);
        tables.insert(full_name, table_name.to_string());
    }
    
    Ok(tables)
}

async fn get_table_columns(
    client: &mut Client<tokio_util::compat::Compat<TcpStream>>,
    table_name: &str,
) -> Result<Vec<ColumnInfo>, String> {
    let parts: Vec<&str> = table_name.split('.').collect();
    let (schema, table) = if parts.len() == 2 {
        (parts[0], parts[1])
    } else {
        ("dbo", table_name)
    };
    
    let sql = format!(r#"
        SELECT 
            c.name AS column_name,
            ty.name AS data_type,
            c.is_nullable,
            c.max_length,
            c.precision,
            c.scale
        FROM sys.columns c
        INNER JOIN sys.tables t ON c.object_id = t.object_id
        INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
        INNER JOIN sys.types ty ON c.user_type_id = ty.user_type_id
        WHERE t.name = '{}' AND s.name = '{}'
        ORDER BY c.column_id
    "#, table, schema);
    
    let stream = client.query(&sql, &[])
        .await
        .map_err(|e| format!("Failed to query columns: {}", e))?;
    
    let mut columns = Vec::new();
    
    let results = stream.into_results()
        .await
        .map_err(|e| format!("Failed to get results: {}", e))?;
    
    for row in results.iter().flat_map(|r| r.iter()) {
        let name: &str = row.try_get("column_name")
            .map_err(|e| format!("Failed to get column_name: {}", e))?
            .unwrap_or("");
        let data_type: &str = row.try_get("data_type")
            .map_err(|e| format!("Failed to get data_type: {}", e))?
            .unwrap_or("");
        let is_nullable: bool = row.try_get("is_nullable")
            .map_err(|e| format!("Failed to get is_nullable: {}", e))?
            .unwrap_or(false);
        
        columns.push(ColumnInfo {
            name: name.to_string(),
            data_type: data_type.to_string(),
            is_nullable,
        });
    }
    
    Ok(columns)
}

#[derive(Debug, Clone)]
struct ColumnInfo {
    name: String,
    data_type: String,
    is_nullable: bool,
}

fn compare_columns(
    source: Option<Vec<ColumnInfo>>,
    target: Option<Vec<ColumnInfo>>,
) -> Vec<ColumnComparison> {
    let mut comparisons = Vec::new();
    
    let source_map: HashMap<String, ColumnInfo> = source
        .unwrap_or_default()
        .into_iter()
        .map(|c| (c.name.clone(), c))
        .collect();
    
    let target_map: HashMap<String, ColumnInfo> = target
        .unwrap_or_default()
        .into_iter()
        .map(|c| (c.name.clone(), c))
        .collect();
    
    let all_names: std::collections::HashSet<String> = source_map
        .keys()
        .chain(target_map.keys())
        .cloned()
        .collect();
    
    for name in all_names {
        let source_col = source_map.get(&name);
        let target_col = target_map.get(&name);
        
        let status = match (source_col, target_col) {
            (Some(_), None) => ComparisonStatus::Removed,
            (None, Some(_)) => ComparisonStatus::Added,
            (Some(s), Some(t)) => {
                if s.data_type == t.data_type && s.is_nullable == t.is_nullable {
                    ComparisonStatus::Identical
                } else {
                    ComparisonStatus::Modified
                }
            }
            (None, None) => continue,
        };
        
        comparisons.push(ColumnComparison {
            name,
            data_type: target_col.map(|c| c.data_type.clone())
                .or_else(|| source_col.map(|c| c.data_type.clone()))
                .unwrap_or_default(),
            is_nullable: target_col.map(|c| c.is_nullable)
                .or_else(|| source_col.map(|c| c.is_nullable))
                .unwrap_or(false),
            status,
        });
    }
    
    comparisons.sort_by(|a, b| {
        let order_a = match a.status {
            ComparisonStatus::Added => 0,
            ComparisonStatus::Removed => 1,
            ComparisonStatus::Modified => 2,
            ComparisonStatus::Identical => 3,
        };
        let order_b = match b.status {
            ComparisonStatus::Added => 0,
            ComparisonStatus::Removed => 1,
            ComparisonStatus::Modified => 2,
            ComparisonStatus::Identical => 3,
        };
        order_a.cmp(&order_b).then_with(|| a.name.cmp(&b.name))
    });
    
    comparisons
}

async fn compare_stored_procs(
    source: &mut Client<tokio_util::compat::Compat<TcpStream>>,
    target: &mut Client<tokio_util::compat::Compat<TcpStream>>,
) -> Result<Vec<StoredProcComparison>, String> {
    let source_procs = get_stored_procs(source).await?;
    let target_procs = get_stored_procs(target).await?;
    
    let mut comparisons = Vec::new();
    let all_names: std::collections::HashSet<String> = source_procs
        .keys()
        .chain(target_procs.keys())
        .cloned()
        .collect();
    
    for proc_name in all_names {
        let source_def = source_procs.get(&proc_name).cloned();
        let target_def = target_procs.get(&proc_name).cloned();
        
        let status = match (&source_def, &target_def) {
            (Some(_), None) => ComparisonStatus::Removed,
            (None, Some(_)) => ComparisonStatus::Added,
            (Some(s), Some(t)) => {
                if normalize_sql(s) == normalize_sql(t) {
                    ComparisonStatus::Identical
                } else {
                    ComparisonStatus::Modified
                }
            }
            (None, None) => continue,
        };
        
        let diff = if status == ComparisonStatus::Modified {
            Some(diffy::create_patch(
                &source_def.clone().unwrap_or_default(),
                &target_def.clone().unwrap_or_default()
            ).to_string())
        } else {
            None
        };
        
        comparisons.push(StoredProcComparison {
            name: proc_name,
            status,
            source_definition: source_def,
            target_definition: target_def,
            diff,
        });
    }
    
    comparisons.sort_by(|a, b| {
        let order_a = match a.status {
            ComparisonStatus::Added => 0,
            ComparisonStatus::Removed => 1,
            ComparisonStatus::Modified => 2,
            ComparisonStatus::Identical => 3,
        };
        let order_b = match b.status {
            ComparisonStatus::Added => 0,
            ComparisonStatus::Removed => 1,
            ComparisonStatus::Modified => 2,
            ComparisonStatus::Identical => 3,
        };
        order_a.cmp(&order_b).then_with(|| a.name.cmp(&b.name))
    });
    
    Ok(comparisons)
}

async fn get_stored_procs(
    client: &mut Client<tokio_util::compat::Compat<TcpStream>>,
) -> Result<HashMap<String, String>, String> {
    let sql = r#"
        SELECT 
            SCHEMA_NAME(p.schema_id) + '.' + p.name AS proc_name,
            sm.definition
        FROM sys.procedures p
        INNER JOIN sys.sql_modules sm ON p.object_id = sm.object_id
        WHERE p.is_ms_shipped = 0
        ORDER BY p.name
    "#;
    
    let stream = client.query(sql, &[])
        .await
        .map_err(|e| format!("Failed to query stored procedures: {}", e))?;
    
    let mut procs = HashMap::new();
    
    let results = stream.into_results()
        .await
        .map_err(|e| format!("Failed to get results: {}", e))?;
    
    for row in results.iter().flat_map(|r| r.iter()) {
        let proc_name: &str = row.try_get("proc_name")
            .map_err(|e| format!("Failed to get proc_name: {}", e))?
            .unwrap_or("");
        let definition: &str = row.try_get("definition")
            .map_err(|e| format!("Failed to get definition: {}", e))?
            .unwrap_or("");
        procs.insert(proc_name.to_string(), definition.to_string());
    }
    
    Ok(procs)
}

async fn compare_functions(
    source: &mut Client<tokio_util::compat::Compat<TcpStream>>,
    target: &mut Client<tokio_util::compat::Compat<TcpStream>>,
) -> Result<Vec<FunctionComparison>, String> {
    let source_funcs = get_functions(source).await?;
    let target_funcs = get_functions(target).await?;
    
    let mut comparisons = Vec::new();
    let all_names: std::collections::HashSet<String> = source_funcs
        .keys()
        .chain(target_funcs.keys())
        .cloned()
        .collect();
    
    for func_name in all_names {
        let source_def = source_funcs.get(&func_name).cloned();
        let target_def = target_funcs.get(&func_name).cloned();
        
        let status = match (&source_def, &target_def) {
            (Some(_), None) => ComparisonStatus::Removed,
            (None, Some(_)) => ComparisonStatus::Added,
            (Some(s), Some(t)) => {
                if normalize_sql(s) == normalize_sql(t) {
                    ComparisonStatus::Identical
                } else {
                    ComparisonStatus::Modified
                }
            }
            (None, None) => continue,
        };
        
        let diff = if status == ComparisonStatus::Modified {
            Some(diffy::create_patch(
                &source_def.clone().unwrap_or_default(),
                &target_def.clone().unwrap_or_default()
            ).to_string())
        } else {
            None
        };
        
        comparisons.push(FunctionComparison {
            name: func_name,
            status,
            source_definition: source_def,
            target_definition: target_def,
            diff,
        });
    }
    
    comparisons.sort_by(|a, b| {
        let order_a = match a.status {
            ComparisonStatus::Added => 0,
            ComparisonStatus::Removed => 1,
            ComparisonStatus::Modified => 2,
            ComparisonStatus::Identical => 3,
        };
        let order_b = match b.status {
            ComparisonStatus::Added => 0,
            ComparisonStatus::Removed => 1,
            ComparisonStatus::Modified => 2,
            ComparisonStatus::Identical => 3,
        };
        order_a.cmp(&order_b).then_with(|| a.name.cmp(&b.name))
    });
    
    Ok(comparisons)
}

async fn get_functions(
    client: &mut Client<tokio_util::compat::Compat<TcpStream>>,
) -> Result<HashMap<String, String>, String> {
    let sql = r#"
        SELECT 
            SCHEMA_NAME(o.schema_id) + '.' + o.name AS func_name,
            sm.definition
        FROM sys.objects o
        INNER JOIN sys.sql_modules sm ON o.object_id = sm.object_id
        WHERE o.type IN ('FN', 'IF', 'TF', 'AF')
            AND o.is_ms_shipped = 0
        ORDER BY o.name
    "#;
    
    let stream = client.query(sql, &[])
        .await
        .map_err(|e| format!("Failed to query functions: {}", e))?;
    
    let mut funcs = HashMap::new();
    
    let results = stream.into_results()
        .await
        .map_err(|e| format!("Failed to get results: {}", e))?;
    
    for row in results.iter().flat_map(|r| r.iter()) {
        let func_name: &str = row.try_get("func_name")
            .map_err(|e| format!("Failed to get func_name: {}", e))?
            .unwrap_or("");
        let definition: &str = row.try_get("definition")
            .map_err(|e| format!("Failed to get definition: {}", e))?
            .unwrap_or("");
        funcs.insert(func_name.to_string(), definition.to_string());
    }
    
    Ok(funcs)
}

fn normalize_sql(sql: &str) -> String {
    sql.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

pub async fn execute_script(connection_string: &str, script: &str) -> Result<(), String> {
    let (host, port, config) = parse_connection_string(connection_string)?;
    
    let tcp = TcpStream::connect(format!("{}:{}", host, port))
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;
    
    let mut client = Client::connect(config, tcp.compat_write())
        .await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    
    // Log the script being executed for debugging
    eprintln!("=== EXECUTING SQL SCRIPT ===");
    eprintln!("{}", script);
    eprintln!("=== END SCRIPT ===");
    
    // Split script by GO statements (T-SQL batch separator)
    let lines: Vec<&str> = script.lines().collect();
    let mut current_batch = String::new();
    let mut batches: Vec<String> = Vec::new();
    
    for line in lines {
        if line.trim().eq_ignore_ascii_case("GO") {
            if !current_batch.trim().is_empty() {
                batches.push(current_batch.clone());
                current_batch.clear();
            }
        } else {
            current_batch.push_str(line);
            current_batch.push('\n');
        }
    }
    
    // Don't forget the last batch
    if !current_batch.trim().is_empty() {
        batches.push(current_batch);
    }
    
    eprintln!("=== EXECUTING {} BATCHES ===", batches.len());
    
    for (i, batch) in batches.iter().enumerate() {
        let trimmed = batch.trim();
        if !trimmed.is_empty() {
            eprintln!("Batch {}: {}", i + 1, &trimmed[..trimmed.len().min(100)]);
            
            // Execute the batch using simple_query for proper T-SQL batch handling
            let mut stream = client.simple_query(trimmed)
                .await
                .map_err(|e| format!("Failed to execute batch: {}", e))?;
            
            // Consume all results to ensure the batch completes
            loop {
                match stream.try_next().await {
                    Ok(Some(_)) => continue,
                    Ok(None) => break,
                    Err(e) => return Err(format!("Query error: {}", e)),
                }
            }
        }
    }
    
    Ok(())
}
