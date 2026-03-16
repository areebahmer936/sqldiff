import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ConnectionConfig, ComparisonResult } from './types';
import { ConnectionPanel } from './components/ConnectionPanel';
import { TablesTab } from './components/TablesTab';
import { StoredProcsTab } from './components/StoredProcsTab';
import { FunctionsTab } from './components/FunctionsTab';
import './App.css';

type Tab = 'tables' | 'storedprocs' | 'functions';

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('tables');
  const [sourceConfig, setSourceConfig] = useState<ConnectionConfig>({
    connectionString: '',
    dbType: 'MSSQL',
  });
  const [targetConfig, setTargetConfig] = useState<ConnectionConfig>({
    connectionString: '',
    dbType: 'MSSQL',
  });
  const [comparisonResult, setComparisonResult] = useState<ComparisonResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCompare = async () => {
    if (!sourceConfig.connectionString || !targetConfig.connectionString) {
      setError('Please enter both connection strings');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await invoke<ComparisonResult>('compare_databases', {
        source: {
          connectionString: sourceConfig.connectionString,
          dbType: sourceConfig.dbType,
        },
        target: {
          connectionString: targetConfig.connectionString,
          dbType: targetConfig.dbType,
        },
      });
      
      // Map the result to match our TypeScript types
      // @ts-ignore - Rust returns snake_case
      setComparisonResult({
        tables: result.tables || [],
        // @ts-ignore
        storedProcs: result.stored_procs || [],
        // @ts-ignore
        functions: result.functions || [],
      });
    } catch (err) {
      setError(err as string);
    } finally {
      setLoading(false);
    }
  };

  const getStats = () => {
    if (!comparisonResult) return null;

    const stats = {
      tables: {
        added: comparisonResult.tables.filter(t => t.status === 'Added').length,
        removed: comparisonResult.tables.filter(t => t.status === 'Removed').length,
        modified: comparisonResult.tables.filter(t => t.status === 'Modified').length,
        identical: comparisonResult.tables.filter(t => t.status === 'Identical').length,
      },
      storedProcs: {
        added: comparisonResult.storedProcs.filter(sp => sp.status === 'Added').length,
        removed: comparisonResult.storedProcs.filter(sp => sp.status === 'Removed').length,
        modified: comparisonResult.storedProcs.filter(sp => sp.status === 'Modified').length,
        identical: comparisonResult.storedProcs.filter(sp => sp.status === 'Identical').length,
      },
      functions: {
        added: comparisonResult.functions.filter(f => f.status === 'Added').length,
        removed: comparisonResult.functions.filter(f => f.status === 'Removed').length,
        modified: comparisonResult.functions.filter(f => f.status === 'Modified').length,
        identical: comparisonResult.functions.filter(f => f.status === 'Identical').length,
      },
    };

    return stats;
  };

  const stats = getStats();

  return (
    <div className="app">
      <header className="app-header">
        <h1>SqlDiff</h1>
        <p className="subtitle">Database Schema Comparison Tool</p>
      </header>

      <ConnectionPanel
        onSourceChange={(config) => {
          setSourceConfig(config);
        }}
        onTargetChange={(config) => {
          setTargetConfig(config);
        }}
        onCompare={handleCompare}
        loading={loading}
      />

      {error && (
        <div className="error-message">
          <span className="error-icon">⚠️</span>
          {error}
        </div>
      )}

      {comparisonResult && stats && (
        <div className="results-container">
          <div className="tabs">
            <button
              className={`tab ${activeTab === 'tables' ? 'active' : ''}`}
              onClick={() => setActiveTab('tables')}
            >
              <span className="tab-icon">📊</span>
              Tables
              <span className="tab-stats">
                <span className="stat added" title="Added">{stats.tables.added}</span>
                <span className="stat removed" title="Removed">{stats.tables.removed}</span>
                <span className="stat modified" title="Modified">{stats.tables.modified}</span>
              </span>
            </button>
            <button
              className={`tab ${activeTab === 'storedprocs' ? 'active' : ''}`}
              onClick={() => setActiveTab('storedprocs')}
            >
              <span className="tab-icon">⚡</span>
              Stored Procedures
              <span className="tab-stats">
                <span className="stat added" title="Added">{stats.storedProcs.added}</span>
                <span className="stat removed" title="Removed">{stats.storedProcs.removed}</span>
                <span className="stat modified" title="Modified">{stats.storedProcs.modified}</span>
              </span>
            </button>
            <button
              className={`tab ${activeTab === 'functions' ? 'active' : ''}`}
              onClick={() => setActiveTab('functions')}
            >
              <span className="tab-icon">🔧</span>
              Functions
              <span className="tab-stats">
                <span className="stat added" title="Added">{stats.functions.added}</span>
                <span className="stat removed" title="Removed">{stats.functions.removed}</span>
                <span className="stat modified" title="Modified">{stats.functions.modified}</span>
              </span>
            </button>
          </div>

          <div className="tab-content">
            {activeTab === 'tables' && <TablesTab tables={comparisonResult.tables} targetConfig={targetConfig} />}
            {activeTab === 'storedprocs' && <StoredProcsTab storedProcs={comparisonResult.storedProcs} targetConfig={targetConfig} />}
            {activeTab === 'functions' && <FunctionsTab functions={comparisonResult.functions} />}
          </div>
        </div>
      )}

      {!comparisonResult && !loading && (
        <div className="empty-state">
          <div className="empty-state-icon">🔍</div>
          <h3>Welcome to SqlDiff</h3>
          <p>Enter connection strings for two databases and click "Compare Databases" to start comparing schemas.</p>
          <div className="db-type-badges">
            <span className="db-type-badge mssql">MSSQL Server</span>
            <span className="db-type-badge mysql">MySQL</span>
            <span className="db-type-badge sqlite">SQLite</span>
          </div>
        </div>
      )}

      {loading && (
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Comparing databases...</p>
        </div>
      )}
    </div>
  );
}

export default App;
