import { X } from 'lucide-react';

export type ScanStatus = 'idle' | 'scanning' | 'done' | 'error';

interface ScanBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (url: string) => void;
  status: ScanStatus;
  message: string | null;
  onDismissMessage: () => void;
  recent: readonly string[];
}

export const ScanBar = ({ value, onChange, onSubmit, status, message, onDismissMessage, recent }: ScanBarProps) => {
  const scanning = status === 'scanning';
  return (
    <div className="floating scanbar">
      <form
        role="search"
        aria-label="Scan a GitHub repository"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onSubmit(value.trim());
        }}
      >
        <label htmlFor="scan-url" className="visually-hidden">
          Public GitHub repository URL
        </label>
        <input
          id="scan-url"
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          list="recent-scans"
          placeholder="github.com/owner/repository"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={scanning}
          aria-describedby={message ? 'scan-message' : undefined}
        />
        <datalist id="recent-scans">
          {recent.map((repo) => (
            <option key={repo} value={`github.com/${repo}`} />
          ))}
        </datalist>
        <button type="submit" className="btn btn--primary" disabled={scanning || !value.trim()}>
          {scanning ? 'Scanning…' : 'Scan'}
        </button>
      </form>
      {message && status !== 'scanning' && (
        <div id="scan-message" className="scanbar__message" data-tone={status === 'error' ? 'error' : 'success'} role={status === 'error' ? 'alert' : 'status'}>
          <p>{message}</p>
          <button type="button" className="icon-btn" style={{ width: 22, height: 22 }} aria-label="Dismiss message" onClick={onDismissMessage}>
            <X size={13} />
          </button>
        </div>
      )}
    </div>
  );
};
