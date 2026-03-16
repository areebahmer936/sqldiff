import { useState } from 'react';
import { FunctionComparison } from '../types';
import { DiffViewer } from './DiffViewer';

interface FunctionsTabProps {
  functions: FunctionComparison[];
}

type FilterType = 'all' | 'added' | 'removed' | 'modified';

export function FunctionsTab({ functions }: FunctionsTabProps) {
  const [expandedFunc, setExpandedFunc] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>('all');

  const filteredFunctions = functions.filter((func) => {
    if (filter === 'all') return true;
    return func.status.toLowerCase() === filter;
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

  const toggleExpand = (funcName: string) => {
    setExpandedFunc(expandedFunc === funcName ? null : funcName);
  };

  return (
    <div className="functions-tab">
      <div className="filter-bar">
        <button
          className={`filter-button ${filter === 'all' ? 'active' : ''}`}
          onClick={() => setFilter('all')}
        >
          All ({functions.length})
        </button>
        <button
          className={`filter-button ${filter === 'added' ? 'active' : ''}`}
          onClick={() => setFilter('added')}
        >
          Added ({functions.filter((f) => f.status === 'Added').length})
        </button>
        <button
          className={`filter-button ${filter === 'removed' ? 'active' : ''}`}
          onClick={() => setFilter('removed')}
        >
          Removed ({functions.filter((f) => f.status === 'Removed').length})
        </button>
        <button
          className={`filter-button ${filter === 'modified' ? 'active' : ''}`}
          onClick={() => setFilter('modified')}
        >
          Modified ({functions.filter((f) => f.status === 'Modified').length})
        </button>
      </div>

      {filteredFunctions.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🔧</div>
          <p>No functions found matching the selected filter.</p>
        </div>
      ) : (
        <div className="functions-container">
          {filteredFunctions.map((func) => (
            <div key={func.name} className="function-item">
              <div
                className="function-header"
                onClick={() => toggleExpand(func.name)}
              >
                <span className={`status-icon ${getStatusClass(func.status)}`}>
                  {getStatusIcon(func.status)}
                </span>
                <span className="function-name">{func.name}</span>
                <span className="function-expand">
                  {expandedFunc === func.name ? '▼' : '▶'}
                </span>
              </div>

              {expandedFunc === func.name && (
                <div className="function-details">
                  {func.status === 'Modified' ? (
                    <DiffViewer
                      original={func.sourceDefinition || ''}
                      modified={func.targetDefinition || ''}
                      originalLabel="Source"
                      modifiedLabel="Target"
                    />
                  ) : func.status === 'Added' ? (
                    <DiffViewer
                      original=""
                      modified={func.targetDefinition || ''}
                      originalLabel="Source"
                      modifiedLabel="Target"
                    />
                  ) : func.status === 'Removed' ? (
                    <DiffViewer
                      original={func.sourceDefinition || ''}
                      modified=""
                      originalLabel="Source"
                      modifiedLabel="Target"
                    />
                  ) : (
                    <DiffViewer
                      original={func.sourceDefinition || ''}
                      modified={func.targetDefinition || ''}
                      originalLabel="Source"
                      modifiedLabel="Target"
                    />
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
