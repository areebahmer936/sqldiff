import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { TableComparison, ConnectionConfig } from '../types';
import { Dialog } from './Dialog';

interface TablesTabProps {
  tables: TableComparison[];
  targetConfig?: ConnectionConfig;
}

type FilterType = 'all' | 'added' | 'removed' | 'modified';

export function TablesTab({ tables, targetConfig }: TablesTabProps) {
  const [expandedTable, setExpandedTable] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>('all');
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set());
  const [generatedScript, setGeneratedScript] = useState<string>('');
  const [showScriptModal, setShowScriptModal] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<string>('');
  const [showApplyResult, setShowApplyResult] = useState(false);
  
  // Dialog state
  const [dialog, setDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: 'info' | 'success' | 'warning' | 'error' | 'confirm';
    onConfirm?: () => void;
    onCancel?: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    type: 'info',
  });

  const filteredTables = tables.filter((table) => {
    if (filter === 'all') return true;
    return table.status.toLowerCase() === filter;
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'Added':
        return '+';
      case 'Removed':
        return '−';
      case 'Modified':
        return '~';
      default:
        return '✓';
    }
  };

  const getStatusClass = (status: string) => {
    return status.toLowerCase();
  };

  const toggleExpand = (tableName: string) => {
    setExpandedTable(expandedTable === tableName ? null : tableName);
  };

  const toggleSelection = (tableName: string) => {
    const newSelected = new Set(selectedTables);
    if (newSelected.has(tableName)) {
      newSelected.delete(tableName);
    } else {
      newSelected.add(tableName);
    }
    setSelectedTables(newSelected);
  };

  const selectAll = () => {
    const allNames = new Set(filteredTables.map(t => t.name));
    setSelectedTables(allNames);
  };

  const deselectAll = () => {
    setSelectedTables(new Set());
  };

  const showDialog = (title: string, message: string, type: 'info' | 'success' | 'warning' | 'error' | 'confirm', onConfirm?: () => void, onCancel?: () => void) => {
    setDialog({
      isOpen: true,
      title,
      message,
      type,
      onConfirm: () => {
        setDialog(prev => ({ ...prev, isOpen: false }));
        onConfirm?.();
      },
      onCancel: () => {
        setDialog(prev => ({ ...prev, isOpen: false }));
        onCancel?.();
      },
    });
  };

  const generateCreateTableScript = (table: TableComparison): string => {
    const columns = table.sourceDefinition || table.targetDefinition;
    if (!columns || columns.length === 0) return '';

    const columnDefs = table.columns.map(col => {
      const nullable = col.isNullable ? 'NULL' : 'NOT NULL';
      return `    [${col.name}] ${col.dataType} ${nullable}`;
    }).join(',\n');

    return `CREATE TABLE [${table.name}] (\n${columnDefs}\n);`;
  };

  const generateAlterTableScript = (table: TableComparison): string => {
    // Find added columns (in source but not in target)
    const addedColumns = table.columns.filter(col => col.status === 'Added');
    
    if (addedColumns.length === 0) return '';

    const alterStatements = addedColumns.map(col => {
      const nullable = col.isNullable ? 'NULL' : 'NOT NULL';
      return `ALTER TABLE [${table.name}] ADD [${col.name}] ${col.dataType} ${nullable};`;
    });

    return alterStatements.join('\n');
  };

  const generateScriptContent = (): string => {
    const selectedTableData = tables.filter(t => selectedTables.has(t.name));
    
    if (selectedTableData.length === 0) {
      return '';
    }

    const scripts: string[] = [];
    
    selectedTableData.forEach((table) => {
      if (table.status === 'Added') {
        // Generate CREATE TABLE script
        const createScript = generateCreateTableScript(table);
        if (createScript) {
          scripts.push(createScript);
          scripts.push('GO\n');
        }
      } else if (table.status === 'Modified') {
        // Generate ALTER TABLE ADD COLUMN scripts
        const alterScript = generateAlterTableScript(table);
        if (alterScript) {
          scripts.push(alterScript);
          scripts.push('GO\n');
        }
      }
    });

    return scripts.join('\n');
  };

  const generateScript = () => {
    if (selectedTables.size === 0) {
      showDialog('No Selection', 'Please select at least one table', 'warning');
      return;
    }

    const script = generateScriptContent();
    setGeneratedScript(script);
    setShowScriptModal(true);
  };

  const applyToDestination = async () => {
    if (selectedTables.size === 0) {
      showDialog('No Selection', 'Please select at least one table', 'warning');
      return;
    }

    if (!targetConfig?.connectionString) {
      showDialog('No Target', 'Target database connection is not configured', 'error');
      return;
    }

    const script = generateScriptContent();
    if (!script.trim()) {
      showDialog('Empty Script', 'No script to apply', 'warning');
      return;
    }

    showDialog(
      'Confirm Apply',
      `Are you sure you want to apply ${selectedTables.size} table(s) to the destination database?`,
      'confirm',
      async () => {
        setIsApplying(true);
        setApplyResult('');

        try {
          await invoke('execute_sql_script', {
            connectionString: targetConfig.connectionString,
            dbType: targetConfig.dbType,
            script: script,
          });
          
          setApplyResult(`Successfully applied ${selectedTables.size} table(s) to the destination database.`);
          setShowApplyResult(true);
        } catch (error) {
          setApplyResult(`Error applying script: ${error}`);
          setShowApplyResult(true);
        } finally {
          setIsApplying(false);
        }
      }
    );
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(generatedScript).then(() => {
      showDialog('Copied', 'Script copied to clipboard!', 'success');
    });
  };

  const downloadScript = () => {
    const blob = new Blob([generatedScript], { type: 'text/sql' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tables_${new Date().toISOString().split('T')[0]}.sql`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showDialog('Downloaded', 'Script downloaded to your Downloads folder!', 'success');
  };

  return (
    <div className="tables-tab">
      <div className="filter-bar">
        <button
          className={`filter-button ${filter === 'all' ? 'active' : ''}`}
          onClick={() => setFilter('all')}
        >
          All ({tables.length})
        </button>
        <button
          className={`filter-button ${filter === 'added' ? 'active' : ''}`}
          onClick={() => setFilter('added')}
        >
          Added ({tables.filter((t) => t.status === 'Added').length})
        </button>
        <button
          className={`filter-button ${filter === 'removed' ? 'active' : ''}`}
          onClick={() => setFilter('removed')}
        >
          Removed ({tables.filter((t) => t.status === 'Removed').length})
        </button>
        <button
          className={`filter-button ${filter === 'modified' ? 'active' : ''}`}
          onClick={() => setFilter('modified')}
        >
          Modified ({tables.filter((t) => t.status === 'Modified').length})
        </button>
      </div>

      <div className="selection-bar">
        <div className="selection-info">
          <span className="selected-count">{selectedTables.size} selected</span>
          <button className="selection-action-btn" onClick={selectAll}>Select All</button>
          <button className="selection-action-btn" onClick={deselectAll}>Deselect All</button>
        </div>
        <div className="selection-actions">
          <button 
            className="generate-script-btn" 
            onClick={generateScript}
            disabled={selectedTables.size === 0}
          >
            📄 Generate Script
          </button>
          <button 
            className="apply-destination-btn" 
            onClick={applyToDestination}
            disabled={selectedTables.size === 0 || !targetConfig?.connectionString || isApplying}
          >
            {isApplying ? '⏳ Applying...' : '🚀 Apply to Destination'}
          </button>
        </div>
      </div>

      {filteredTables.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📊</div>
          <p>No tables found matching the selected filter.</p>
        </div>
      ) : (
        <div className="tables-container">
          {filteredTables.map((table) => (
            <div key={table.name} className="table-item">
              <div className="table-header">
                <label className="table-checkbox-label" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    className="table-checkbox"
                    checked={selectedTables.has(table.name)}
                    onChange={() => toggleSelection(table.name)}
                  />
                  <span className="checkmark"></span>
                </label>
                <span className={`status-icon ${getStatusClass(table.status)}`}>
                  {getStatusIcon(table.status)}
                </span>
                <span 
                  className="table-name"
                  onClick={() => toggleExpand(table.name)}
                >
                  {table.name}
                </span>
                <span 
                  className="table-expand"
                  onClick={() => toggleExpand(table.name)}
                >
                  {expandedTable === table.name ? '▼' : '▶'}
                </span>
              </div>

              {expandedTable === table.name && table.columns.length > 0 && (
                <div className="table-details">
                  <table className="columns-table">
                    <thead>
                      <tr>
                        <th>Status</th>
                        <th>Column Name</th>
                        <th>Data Type</th>
                        <th>Nullable</th>
                      </tr>
                    </thead>
                    <tbody>
                      {table.columns.map((column) => (
                        <tr key={column.name}>
                          <td>
                            <span className="column-status">
                              <span
                                className={`status-dot ${getStatusClass(
                                  column.status
                                )}`}
                              />
                              {column.status}
                            </span>
                          </td>
                          <td>{column.name}</td>
                          <td>{column.dataType}</td>
                          <td>{column.isNullable ? 'Yes' : 'No'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showScriptModal && (
        <div className="script-modal-overlay" onClick={() => setShowScriptModal(false)}>
          <div className="script-modal" onClick={(e) => e.stopPropagation()}>
            <div className="script-modal-header">
              <h3>Generated SQL Script</h3>
              <button className="close-btn" onClick={() => setShowScriptModal(false)}>×</button>
            </div>
            <div className="script-modal-body">
              <textarea
                className="script-textarea"
                value={generatedScript}
                readOnly
                rows={20}
              />
            </div>
            <div className="script-modal-footer">
              <button className="script-action-btn copy-btn" onClick={copyToClipboard}>
                📋 Copy to Clipboard
              </button>
              <button className="script-action-btn download-btn" onClick={downloadScript}>
                💾 Download .sql
              </button>
              <button className="script-action-btn close-action-btn" onClick={() => setShowScriptModal(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showApplyResult && (
        <div className="script-modal-overlay" onClick={() => setShowApplyResult(false)}>
          <div className="script-modal result-modal" onClick={(e) => e.stopPropagation()}>
            <div className="script-modal-header">
              <h3>Apply Result</h3>
              <button className="close-btn" onClick={() => setShowApplyResult(false)}>×</button>
            </div>
            <div className="script-modal-body">
              <div className={`apply-result ${applyResult.includes('Error') ? 'error' : 'success'}`}>
                {applyResult}
              </div>
            </div>
            <div className="script-modal-footer">
              <button className="script-action-btn close-action-btn" onClick={() => setShowApplyResult(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dialog for alerts/confirms */}
      <Dialog
        isOpen={dialog.isOpen}
        title={dialog.title}
        message={dialog.message}
        type={dialog.type}
        onConfirm={dialog.onConfirm}
        onCancel={dialog.onCancel}
      />
    </div>
  );
}
