import { useState } from 'react';
import { SavedConnection, DatabaseType } from '../types';
import { invoke } from '@tauri-apps/api/core';

interface ManageDatabasesModalProps {
  isOpen: boolean;
  savedConnections: SavedConnection[];
  onClose: () => void;
  onConnectionsChange: () => void;
  onSelectConnection: (connectionId: string, type: 'source' | 'target') => void;
  selectedSourceId: string;
  selectedTargetId: string;
}

export function ManageDatabasesModal({
  isOpen,
  savedConnections,
  onClose,
  onConnectionsChange,
  onSelectConnection,
  selectedSourceId,
  selectedTargetId,
}: ManageDatabasesModalProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{id: string, message: string, success: boolean} | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  
  // Form fields for new connection
  const [connectionName, setConnectionName] = useState('');
  const [dbType, setDbType] = useState<DatabaseType>('MSSQL');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('1433');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [database, setDatabase] = useState('');
  const [connectionString, setConnectionString] = useState('');
  const [inputMode, setInputMode] = useState<'fields' | 'connectionString'>('fields');
  const [isTesting, setIsTesting] = useState(false);
  const [addTestResult, setAddTestResult] = useState<string>('');

  if (!isOpen) return null;

  const buildConnectionString = (): string => {
    if (inputMode === 'connectionString') {
      return connectionString;
    }
    if (dbType === 'MSSQL') {
      return `Server=${host},${port};Database=${database};User Id=${username};Password=${password};TrustServerCertificate=True;`;
    }
    return connectionString;
  };

  const testConnection = async () => {
    const connString = buildConnectionString();
    if (!connString.trim()) {
      setAddTestResult('Please fill in all required fields');
      return;
    }

    setIsTesting(true);
    setAddTestResult('');

    try {
      const result = await invoke<boolean>('test_connection', {
        config: {
          connectionString: connString,
          dbType: dbType,
        },
      });
      
      if (result) {
        setAddTestResult('✅ Connection successful!');
      } else {
        setAddTestResult('❌ Connection failed');
      }
    } catch (error) {
      setAddTestResult(`❌ Connection failed: ${error}`);
    } finally {
      setIsTesting(false);
    }
  };

  const saveConnection = async () => {
    const connString = buildConnectionString();
    if (!connString.trim() || !connectionName.trim()) {
      return;
    }

    const newConnection: SavedConnection = {
      id: crypto.randomUUID(),
      name: connectionName.trim(),
      connectionString: connString,
      dbType: dbType,
      createdAt: new Date().toISOString(),
    };

    try {
      await invoke('save_connection', { connection: newConnection });
      await onConnectionsChange();
      resetForm();
      setShowAddForm(false);
    } catch (error) {
      console.error('Failed to save connection:', error);
    }
  };

  const resetForm = () => {
    setConnectionName('');
    setHost('');
    setPort('1433');
    setUsername('');
    setPassword('');
    setDatabase('');
    setConnectionString('');
    setInputMode('fields');
    setAddTestResult('');
  };

  const handleDelete = async (connectionId: string) => {
    setDeletingId(connectionId);
    try {
      await invoke('delete_connection', { id: connectionId });
      await onConnectionsChange();
    } catch (error) {
      console.error('Failed to delete connection:', error);
    } finally {
      setDeletingId(null);
    }
  };

  const handleTestExisting = async (connection: SavedConnection) => {
    setTestingId(connection.id);
    setTestResult(null);
    try {
      const result = await invoke<boolean>('test_connection', {
        config: {
          connectionString: connection.connectionString,
          dbType: connection.dbType,
        },
      });
      setTestResult({
        id: connection.id,
        message: result ? '✅ Connection successful!' : '❌ Connection failed',
        success: result
      });
    } catch (error) {
      setTestResult({
        id: connection.id,
        message: `❌ Connection failed: ${error}`,
        success: false
      });
    } finally {
      setTestingId(null);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const getDbTypeLabel = (type: DatabaseType) => {
    switch (type) {
      case 'MSSQL': return 'MSSQL Server';
      case 'MySQL': return 'MySQL';
      case 'SQLite': return 'SQLite';
      default: return type;
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="manage-db-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Manage Databases</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="manage-db-body">
          {!showAddForm ? (
            <>
              <div className="manage-db-actions">
                <button
                  className="add-db-btn"
                  onClick={() => setShowAddForm(true)}
                >
                  <span>+</span> Add New Database
                </button>
              </div>

              {savedConnections.length === 0 ? (
                <div className="empty-db-list">
                  <div className="empty-icon">🗄️</div>
                  <p>No saved database connections</p>
                  <span>Click "Add New Database" to create one</span>
                </div>
              ) : (
                <div className="db-list">
                  {savedConnections.map((conn) => (
                    <div
                      key={conn.id}
                      className={`db-item ${selectedSourceId === conn.id ? 'selected-source' : ''} ${selectedTargetId === conn.id ? 'selected-target' : ''}`}
                    >
                      <div className="db-item-info">
                        <div className="db-item-header">
                          <span className="db-item-name">{conn.name}</span>
                          <span className={`db-item-type db-type-${conn.dbType.toLowerCase()}`}>
                            {getDbTypeLabel(conn.dbType)}
                          </span>
                        </div>
                        <div className="db-item-meta">
                          <span>Created {formatDate(conn.createdAt)}</span>
                          {selectedSourceId === conn.id && (
                            <span className="db-badge source">Source</span>
                          )}
                          {selectedTargetId === conn.id && (
                            <span className="db-badge target">Target</span>
                          )}
                        </div>
                        {testResult?.id === conn.id && (
                          <div className={`test-result-inline ${testResult.success ? 'success' : 'error'}`}>
                            {testResult.message}
                          </div>
                        )}
                      </div>
                      <div className="db-item-actions">
                        <button
                          className="db-action-btn test"
                          onClick={() => handleTestExisting(conn)}
                          disabled={testingId === conn.id}
                          title="Test connection"
                        >
                          {testingId === conn.id ? '⏳' : '🔌'}
                        </button>
                        <button
                          className="db-action-btn use-source"
                          onClick={() => onSelectConnection(conn.id, 'source')}
                          disabled={selectedSourceId === conn.id}
                          title="Use as source"
                        >
                          📤
                        </button>
                        <button
                          className="db-action-btn use-target"
                          onClick={() => onSelectConnection(conn.id, 'target')}
                          disabled={selectedTargetId === conn.id}
                          title="Use as target"
                        >
                          📥
                        </button>
                        <button
                          className="db-action-btn delete"
                          onClick={() => handleDelete(conn.id)}
                          disabled={deletingId === conn.id}
                          title="Delete connection"
                        >
                          {deletingId === conn.id ? '⏳' : '🗑️'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="add-db-form">
              <h4>Add New Database Connection</h4>
              
              <div className="form-group">
                <label>Connection Name</label>
                <input
                  type="text"
                  value={connectionName}
                  onChange={(e) => setConnectionName(e.target.value)}
                  placeholder="e.g., Production DB"
                  className="form-input"
                />
              </div>

              <div className="form-group">
                <label>Database Type</label>
                <select
                  value={dbType}
                  onChange={(e) => setDbType(e.target.value as DatabaseType)}
                  className="form-select"
                >
                  <option value="MSSQL">MSSQL Server</option>
                  <option value="MySQL">MySQL</option>
                  <option value="SQLite">SQLite</option>
                </select>
              </div>

              <div className="input-mode-toggle">
                <button
                  className={`toggle-btn ${inputMode === 'fields' ? 'active' : ''}`}
                  onClick={() => setInputMode('fields')}
                >
                  Enter Fields
                </button>
                <button
                  className={`toggle-btn ${inputMode === 'connectionString' ? 'active' : ''}`}
                  onClick={() => setInputMode('connectionString')}
                >
                  Connection String
                </button>
              </div>

              {inputMode === 'fields' ? (
                <>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Host</label>
                      <input
                        type="text"
                        value={host}
                        onChange={(e) => setHost(e.target.value)}
                        placeholder="localhost"
                        className="form-input"
                      />
                    </div>
                    <div className="form-group small">
                      <label>Port</label>
                      <input
                        type="text"
                        value={port}
                        onChange={(e) => setPort(e.target.value)}
                        placeholder="1433"
                        className="form-input"
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Database</label>
                    <input
                      type="text"
                      value={database}
                      onChange={(e) => setDatabase(e.target.value)}
                      placeholder="Database name"
                      className="form-input"
                    />
                  </div>

                  <div className="form-group">
                    <label>Username</label>
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="Username"
                      className="form-input"
                    />
                  </div>

                  <div className="form-group">
                    <label>Password</label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Password"
                      className="form-input"
                    />
                  </div>
                </>
              ) : (
                <div className="form-group">
                  <label>Connection String</label>
                  <textarea
                    value={connectionString}
                    onChange={(e) => setConnectionString(e.target.value)}
                    placeholder="Server=localhost;Database=myDB;User Id=sa;Password=..."
                    className="form-textarea"
                    rows={4}
                  />
                </div>
              )}

              {addTestResult && (
                <div className={`test-result ${addTestResult.includes('✅') ? 'success' : 'error'}`}>
                  {addTestResult}
                </div>
              )}

              <div className="add-db-form-actions">
                <button
                  className="test-connection-btn"
                  onClick={testConnection}
                  disabled={isTesting}
                >
                  {isTesting ? 'Testing...' : 'Test Connection'}
                </button>
                <div className="form-action-buttons">
                  <button
                    className="cancel-btn"
                    onClick={() => {
                      setShowAddForm(false);
                      resetForm();
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    className="save-connection-btn"
                    onClick={saveConnection}
                    disabled={!connectionName.trim() || !buildConnectionString().trim()}
                  >
                    Save Connection
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
