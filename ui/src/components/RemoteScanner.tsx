import React, { useState } from 'react';

interface RemoteScannerProps {
  onScanSuccess: () => void;
}

export const RemoteScanner: React.FC<RemoteScannerProps> = ({ onScanSuccess }) => {
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<'idle' | 'scanning' | 'error' | 'success'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const handleScan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;

    setStatus('scanning');
    setErrorMessage('');

    try {
      const response = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      const data = await response.json();

      if (response.ok && data.status === 'success') {
        setStatus('success');
        onScanSuccess();
        setTimeout(() => setStatus('idle'), 3000);
      } else {
        throw new Error(data.error || 'Scan failed');
      }
    } catch (err: unknown) {
      console.error(err);
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Connection to scan server failed');
    }
  };

  return (
    <div style={{
      position: 'absolute',
      top: '20px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 1000,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '10px',
    }}>
      <form onSubmit={handleScan} style={{
        background: 'rgba(22, 22, 24, 0.7)',
        backdropFilter: 'blur(12px)',
        padding: '8px 8px 8px 16px',
        borderRadius: '999px',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
        width: '500px',
      }}>
        <input
          type="text"
          placeholder="Paste GitHub repository URL..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={status === 'scanning'}
          style={{
            background: 'none',
            border: 'none',
            color: '#fff',
            fontSize: '0.875rem',
            outline: 'none',
            flex: 1,
            fontFamily: 'Inter, sans-serif',
          }}
        />
        <button
          type="submit"
          disabled={status === 'scanning' || !url}
          style={{
            background: status === 'scanning' ? 'rgba(255, 255, 255, 0.1)' : '#fff',
            color: '#000',
            border: 'none',
            padding: '8px 20px',
            borderRadius: '999px',
            fontSize: '0.75rem',
            fontWeight: 600,
            cursor: status === 'scanning' ? 'wait' : 'pointer',
            transition: 'all 0.2s',
          }}
        >
          {status === 'scanning' ? 'Analyzing...' : 'Visualize'}
        </button>
      </form>
      
      {status === 'error' && (
        <div style={{ color: '#ff6b6b', fontSize: '0.75rem', background: 'rgba(0,0,0,0.6)', padding: '4px 12px', borderRadius: '4px', backdropFilter: 'blur(4px)' }}>
          ⚠️ {errorMessage}
        </div>
      )}
      {status === 'success' && (
        <div style={{ color: '#51cf66', fontSize: '0.75rem', background: 'rgba(0,0,0,0.6)', padding: '4px 12px', borderRadius: '4px', backdropFilter: 'blur(4px)' }}>
          ✅ Scan completed successfully!
        </div>
      )}
    </div>
  );
};
