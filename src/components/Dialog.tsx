import { useEffect } from 'react';

interface DialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error' | 'confirm';
  onConfirm?: () => void;
  onCancel?: () => void;
  confirmText?: string;
  cancelText?: string;
}

export function Dialog({
  isOpen,
  title,
  message,
  type,
  onConfirm,
  onCancel,
  confirmText = 'OK',
  cancelText = 'Cancel',
}: DialogProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        onCancel?.();
      }
      if (e.key === 'Enter' && type !== 'confirm') {
        onConfirm?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onConfirm, onCancel, type]);

  if (!isOpen) return null;

  const getIcon = () => {
    switch (type) {
      case 'success':
        return '✅';
      case 'warning':
        return '⚠️';
      case 'error':
        return '❌';
      case 'confirm':
        return '❓';
      default:
        return 'ℹ️';
    }
  };

  const getConfirmButtonClass = () => {
    switch (type) {
      case 'error':
      case 'confirm':
        return 'dialog-btn-danger';
      case 'success':
        return 'dialog-btn-success';
      case 'warning':
        return 'dialog-btn-warning';
      default:
        return 'dialog-btn-primary';
    }
  };

  return (
    <div className="dialog-overlay" onClick={() => onCancel?.()}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className={`dialog-icon dialog-icon-${type}`}>
          {getIcon()}
        </div>
        <h3 className="dialog-title">{title}</h3>
        <p className="dialog-message">{message}</p>
        <div className="dialog-actions">
          {type === 'confirm' ? (
            <>
              <button
                className="dialog-btn dialog-btn-secondary"
                onClick={onCancel}
              >
                {cancelText}
              </button>
              <button
                className={`dialog-btn ${getConfirmButtonClass()}`}
                onClick={onConfirm}
              >
                {confirmText}
              </button>
            </>
          ) : (
            <button
              className={`dialog-btn ${getConfirmButtonClass()}`}
              onClick={onConfirm}
            >
              {confirmText}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
