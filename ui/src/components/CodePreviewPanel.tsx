import React from 'react';
import type { NodeData } from '../types';
import { COLORS } from '../utils/constants';

interface CodePreviewPanelProps {
  selectedNode: NodeData;
  onClose: () => void;
}

export const CodePreviewPanel: React.FC<CodePreviewPanelProps> = ({ selectedNode, onClose }) => {
  return (
    <div style={{
      width: '450px',
      flexShrink: 0,
      height: '100vh',
      background: '#1e293b',
      borderLeft: '1px solid rgba(255,255,255,0.1)',
      color: '#e2e8f0',
      padding: '24px',
      boxSizing: 'border-box',
      overflowY: 'auto',
      fontFamily: 'JetBrains Mono, Menlo, monospace',
      zIndex: 100,
      boxShadow: '-10px 0 30px rgba(0,0,0,0.3)'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <span style={{ 
          background: COLORS[selectedNode.group] || '#475569', 
          padding: '4px 10px', 
          borderRadius: '4px', 
          fontSize: '0.75rem',
          fontWeight: 'bold',
          textTransform: 'uppercase'
        }}>
          {selectedNode.group}
        </span>
        <button 
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '1.2rem' }}
        >
          ×
        </button>
      </div>
      
      <h2 style={{ fontSize: '1.2rem', margin: '0 0 8px 0', color: '#fff' }}>{selectedNode.label}</h2>
      <p style={{ fontSize: '0.8rem', color: '#64748b', wordBreak: 'break-all', marginBottom: '24px' }}>{selectedNode.id}</p>
      
      {selectedNode.code ? (
        <pre style={{ 
          background: '#0f172a', 
          padding: '16px', 
          borderRadius: '8px', 
          fontSize: '0.85rem', 
          lineHeight: '1.6',
          border: '1px solid rgba(255,255,255,0.05)',
          whiteSpace: 'pre-wrap'
        }}>
          <code>{selectedNode.code}</code>
        </pre>
      ) : (
        <p style={{ fontStyle: 'italic', opacity: 0.5 }}>No code snippet available for this node.</p>
      )}
    </div>
  );
};
