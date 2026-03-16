import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ConnectionConfig, SavedConnection } from '../types';
import { ManageDatabasesModal } from './ManageDatabasesModal';

interface ConnectionPanelProps {
  onSourceChange: (config: ConnectionConfig) => void;
  onTargetChange: (config: ConnectionConfig) => void;
  onCompare: () => void;
  loading: boolean;
}

export function ConnectionPanel({
  onSourceChange,
  onTargetChange,
  onCompare,
  loading,
}: ConnectionPanelProps) {
  const [savedConnections, setSavedConnections] = useState<SavedConnection[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string>('');
  const [selectedTargetId, setSelectedTargetId] = useState<string>('');
  const [showManageModal, setShowManageModal] = useState(false);

  useEffect(() => {
    loadSavedConnections();
  }, []);

  const loadSavedConnections = async () => {
    try {
      const connections = await invoke<SavedConnection[]>('load_saved_connections');
      setSavedConnections(connections);
    } catch (error) {
      console.error('Failed to load saved connections:', error);
    }
  };

  const handleSelectConnection = (connectionId: string, type: 'source' | 'target') => {
    const connection = savedConnections.find(c => c.id === connectionId);
    if (connection) {
      const config = {
        connectionString: connection.connectionString,
        dbType: connection.dbType,
      };
      if (type === 'source') {
        setSelectedSourceId(connectionId);
        onSourceChange(config);
      } else {
        setSelectedTargetId(connectionId);
        onTargetChange(config);
      }
    }
  };

  const getSelectedConnectionName = (id: string) => {
    const conn = savedConnections.find(c => c.id === id);
    return conn?.name || 'Select a database...';
  };

  return (
    <div className="connection-panel">
      <div className="connection-header">
        <button 
          className="manage-databases-btn" 
          onClick={() => setShowManageModal(true)}
          title="Manage database connections"
        >
          <span className="btn-icon">🗄️</span>
          Manage Databases
        </button>
      </div>
      
      <div className="connection-row">
        {/* Source Database */}
        <div className="connection-input-group">
          <label>
            <span className="label-icon">📤</span> Source Database
          </label>
          <div className="connection-select-wrapper">
            <div 
              className={`connection-display ${selectedSourceId ? 'has-value' : ''}`}
              onClick={() => setShowManageModal(true)}
            >
              {getSelectedConnectionName(selectedSourceId)}
              <span className="dropdown-arrow">▼</span>
            </div>
          </div>
        </div>

        {/* Target Database */}
        <div className="connection-input-group">
          <label>
            <span className="label-icon">📥</span> Target Database
          </label>
          <div className="connection-select-wrapper">
            <div 
              className={`connection-display ${selectedTargetId ? 'has-value' : ''}`}
              onClick={() => setShowManageModal(true)}
            >
              {getSelectedConnectionName(selectedTargetId)}
              <span className="dropdown-arrow">▼</span>
            </div>
          </div>
        </div>

        {/* Compare Button */}
        <button
          className="compare-button"
          onClick={onCompare}
          disabled={loading}
        >
          {loading ? 'Comparing...' : 'Compare Databases'}
        </button>
      </div>

      {/* Manage Databases Modal */}
      <ManageDatabasesModal
        isOpen={showManageModal}
        savedConnections={savedConnections}
        onClose={() => setShowManageModal(false)}
        onConnectionsChange={loadSavedConnections}
        onSelectConnection={(id, type) => {
          handleSelectConnection(id, type);
          // Don't close modal so user can select both source and target
        }}
        selectedSourceId={selectedSourceId}
        selectedTargetId={selectedTargetId}
      />

    </div>
  );
}
