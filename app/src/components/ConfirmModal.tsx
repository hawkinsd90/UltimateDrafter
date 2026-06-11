import { useEffect, useRef } from 'react';

export interface ConfirmOptions {
  title:        string;
  message:      string;
  confirmLabel?: string;
  cancelLabel?:  string;
  danger?:       boolean;
}

interface Props extends ConfirmOptions {
  onConfirm: () => void;
  onCancel:  () => void;
}

export default function ConfirmModal({
  title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false,
  onConfirm, onCancel,
}: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(2px)',
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: '#1e293b',
          border: '1px solid #334155',
          borderRadius: '14px',
          padding: '28px 28px 24px',
          maxWidth: '420px',
          width: 'calc(100vw - 48px)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
          fontFamily: 'system-ui, sans-serif',
          color: '#f1f5f9',
        }}
        onClick={e => e.stopPropagation()}
      >
        <h3 style={{ margin: '0 0 10px', fontSize: '16px', fontWeight: '700', color: '#f1f5f9', lineHeight: '1.3' }}>
          {title}
        </h3>
        <p style={{ margin: '0 0 24px', fontSize: '14px', color: '#94a3b8', lineHeight: '1.55' }}>
          {message}
        </p>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button
            ref={cancelRef}
            onClick={onCancel}
            style={{
              padding: '8px 20px', borderRadius: '8px', fontSize: '14px', fontWeight: '600',
              cursor: 'pointer', border: '1px solid #475569',
              background: 'transparent', color: '#94a3b8',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { (e.target as HTMLButtonElement).style.background = '#334155'; (e.target as HTMLButtonElement).style.color = '#f1f5f9'; }}
            onMouseLeave={e => { (e.target as HTMLButtonElement).style.background = 'transparent'; (e.target as HTMLButtonElement).style.color = '#94a3b8'; }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: '8px 20px', borderRadius: '8px', fontSize: '14px', fontWeight: '600',
              cursor: 'pointer', border: 'none',
              background: danger ? '#dc2626' : '#2563eb',
              color: '#fff',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => { (e.target as HTMLButtonElement).style.background = danger ? '#b91c1c' : '#1d4ed8'; }}
            onMouseLeave={e => { (e.target as HTMLButtonElement).style.background = danger ? '#dc2626' : '#2563eb'; }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
