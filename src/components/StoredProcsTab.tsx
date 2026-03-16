import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { StoredProcComparison, ConnectionConfig } from '../types';
import { DiffViewer } from './DiffViewer';
import { Dialog } from './Dialog';

interface StoredProcsTabProps {
  storedProcs: StoredProcComparison[];
  targetConfig?: ConnectionConfig;
}

type FilterType = 'all' | 'added' | 'removed' | 'modified';

export function StoredProcsTab({ storedProcs, targetConfig }: StoredProcsTabProps) {
  const [expandedProc, setExpandedProc] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>('all');
  const [selectedProcs, setSelectedProcs] = useState<Set<string>>(new Set());
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

  const filteredProcs = storedProcs.filter((proc) => {
    if (filter === 'all') return true;
    return proc.status.toLowerCase() === filter;
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

  const toggleExpand = (procName: string) => {
    setExpandedProc(expandedProc === procName ? null : procName);
  };

  const toggleSelection = (procName: string) => {
    const newSelected = new Set(selectedProcs);
    if (newSelected.has(procName)) {
      newSelected.delete(procName);
    } else {
      newSelected.add(procName);
    }
    setSelectedProcs(newSelected);
  };

  const selectAll = () => {
    const allNames = new Set(filteredProcs.map(p => p.name));
    setSelectedProcs(allNames);
  };

  const deselectAll = () => {
    setSelectedProcs(new Set());
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

  const generateScriptContent = (): string => {
    const selectedProcedures = storedProcs.filter(proc => selectedProcs.has(proc.name));
    
    if (selectedProcedures.length === 0) {
      return '';
    }

    const scripts: string[] = [];
    
    selectedProcedures.forEach((proc, index) => {
      // Use target definition for Added/Modified, source for Removed/Identical
      let definition = proc.targetDefinition || proc.sourceDefinition || '';
      
      if (!definition.trim()) {
        return;
      }

      // Extract schema and procedure name
      const procFullName = proc.name.includes('.') ? proc.name : `dbo.[${proc.name}]`;
      const procNameForDrop = proc.name.includes('.') ? proc.name : `[${proc.name}]`;

      // Remove any existing CREATE OR ALTER and convert to CREATE
      definition = definition.replace(
        /CREATE\s+OR\s+ALTER\s+(PROCEDURE|PROC)\s+/i,
        'CREATE PROCEDURE '
      );

      // Replace CREATE PROCEDURE with standard format
      definition = definition.replace(
        /CREATE\s+(PROCEDURE|PROC)\s+/i,
        'CREATE PROCEDURE '
      );

      // If it doesn't start with CREATE, wrap it
      if (!definition.trim().toUpperCase().startsWith('CREATE')) {
        definition = `CREATE PROCEDURE ${procFullName}\n${definition}`;
      }

      // Add DROP PROCEDURE before CREATE for compatibility with older SQL Server versions
      // Using classic IF OBJECT_ID() pattern for SQL Server 2008+ compatibility
      scripts.push(`IF OBJECT_ID('${procFullName}', 'P') IS NOT NULL`);
      scripts.push(`    DROP PROCEDURE ${procNameForDrop};`);
      scripts.push('GO');
      scripts.push(definition.trim());
      
      // Add GO separator between procedures (but not after the last one)
      if (index < selectedProcedures.length - 1) {
        scripts.push('GO\n');
      }
    });

    return scripts.join('\n');
  };

  const generateScript = () => {
    if (selectedProcs.size === 0) {
      showDialog('No Selection', 'Please select at least one procedure', 'warning');
      return;
    }

    const script = generateScriptContent();
    setGeneratedScript(script);
    setShowScriptModal(true);
  };

  const applyToDestination = async () => {
    if (selectedProcs.size === 0) {
      showDialog('No Selection', 'Please select at least one procedure', 'warning');
      return;
    }

    if (!targetConfig?.connectionString) {
      showDialog('No Target', 'Target database connection is not configured', 'error');
      return;
    }

    const script = generateScriptContent();
    
    // Log the generated script for debugging
    console.log('=== GENERATED SQL SCRIPT ===');
    console.log(script);
    console.log('=== END SCRIPT ===');
    
    if (!script.trim()) {
      showDialog('Empty Script', 'No script to apply', 'warning');
      return;
    }

    showDialog(
      'Confirm Apply',
      `Are you sure you want to apply ${selectedProcs.size} procedure(s) to the destination database?`,
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
          
          setApplyResult(`Successfully applied ${selectedProcs.size} procedure(s) to the destination database.`);
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
    a.download = `stored_procedures_${new Date().toISOString().split('T')[0]}.sql`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showDialog('Downloaded', 'Script downloaded to your Downloads folder!', 'success');
  };

  return (
    <div className="stored-procs-tab">
      <div className="filter-bar">
        <button
          className={`filter-button ${filter === 'all' ? 'active' : ''}`}
          onClick={() => setFilter('all')}
        >
          All ({storedProcs.length})
        </button>
        <button
          className={`filter-button ${filter === 'added' ? 'active' : ''}`}
          onClick={() => setFilter('added')}
        >
          Added ({storedProcs.filter((p) => p.status === 'Added').length})
        </button>
        <button
          className={`filter-button ${filter === 'removed' ? 'active' : ''}`}
          onClick={() => setFilter('removed')}
        >
          Removed ({storedProcs.filter((p) => p.status === 'Removed').length})
        </button>
        <button
          className={`filter-button ${filter === 'modified' ? 'active' : ''}`}
          onClick={() => setFilter('modified')}
        >
          Modified ({storedProcs.filter((p) => p.status === 'Modified').length})
        </button>
      </div>

      <div className="selection-bar">
        <div className="selection-info">
          <span className="selected-count">{selectedProcs.size} selected</span>
          <button className="selection-action-btn" onClick={selectAll}>Select All</button>
          <button className="selection-action-btn" onClick={deselectAll}>Deselect All</button>
        </div>
        <div className="selection-actions">
          <button 
            className="generate-script-btn" 
            onClick={generateScript}
            disabled={selectedProcs.size === 0}
          >
            📄 Generate Script
          </button>
          <button 
            className="apply-destination-btn" 
            onClick={applyToDestination}
            disabled={selectedProcs.size === 0 || !targetConfig?.connectionString || isApplying}
          >
            {isApplying ? '⏳ Applying...' : '🚀 Apply to Destination'}
          </button>
        </div>
      </div>

      {filteredProcs.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">⚡</div>
          <p>No stored procedures found matching the selected filter.</p>
        </div>
      ) : (
        <div className="procs-container">
          {filteredProcs.map((proc) => (
            <div key={proc.name} className="proc-item">
              <div className="proc-header">
                <label className="proc-checkbox-label" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    className="proc-checkbox"
                    checked={selectedProcs.has(proc.name)}
                    onChange={() => toggleSelection(proc.name)}
                  />
                  <span className="checkmark"></span>
                </label>
                <span className={`status-icon ${getStatusClass(proc.status)}`}>
                  {getStatusIcon(proc.status)}
                </span>
                <span 
                  className="proc-name"
                  onClick={() => toggleExpand(proc.name)}
                >
                  {proc.name}
                </span>
                <span 
                  className="proc-expand"
                  onClick={() => toggleExpand(proc.name)}
                >
                  {expandedProc === proc.name ? '▼' : '▶'}
                </span>
              </div>

              {expandedProc === proc.name && (
                <div className="proc-details">
                  <DiffViewer
                    original={proc.sourceDefinition || '-- Not found in source'}
                    modified={proc.targetDefinition || '-- Not found in target'}
                    originalLabel="Source"
                    modifiedLabel="Target"
                  />
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
