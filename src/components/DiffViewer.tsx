import { DiffEditor } from '@monaco-editor/react';

interface DiffViewerProps {
  original: string;
  modified: string;
  originalLabel?: string;
  modifiedLabel?: string;
}

export function DiffViewer({
  original,
  modified,
  originalLabel = 'Source',
  modifiedLabel = 'Target',
}: DiffViewerProps) {
  return (
    <div className="monaco-diff-viewer">
      <div className="diff-editor-header">
        <div className="diff-editor-label">{originalLabel}</div>
        <div className="diff-editor-label">{modifiedLabel}</div>
      </div>
      <DiffEditor
        height={400}
        original={original}
        modified={modified}
        language="sql"
        theme="vs"
        options={{
          renderSideBySide: true,
          readOnly: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 13,
          lineNumbers: 'on',
          renderOverviewRuler: false,
          renderIndicators: true,
          diffWordWrap: 'on',
          scrollbar: {
            alwaysConsumeMouseWheel: false,
          },
        }}
      />
    </div>
  );
}
