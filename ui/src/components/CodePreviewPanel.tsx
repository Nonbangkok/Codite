import React from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { atomDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { NodeData } from '../types';

interface CodePreviewPanelProps {
  selectedNode: NodeData;
  onClose: () => void;
  width: number;
}

export const CodePreviewPanel: React.FC<CodePreviewPanelProps> = ({ selectedNode, onClose, width }) => {
  return (
    <div style={{
      width: '100%',
      height: '100vh',
      background: '#161618',
      borderLeft: '1px solid rgba(255,255,255,0.05)',
      color: '#e2e8f0',
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'Inter, sans-serif'
    }}>
      {/* Fixed Header Section */}
      <div style={{ padding: '24px 24px 0 24px', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <span style={{ 
            background: '#475569',
            padding: '4px 10px', 
            borderRadius: '4px', 
            fontSize: '0.7rem',
            fontWeight: 'bold',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: '#cbd5e1'
          }}>
            {selectedNode.group}
          </span>
          <button 
            onClick={onClose}
            style={{ 
              background: 'none', 
              border: 'none', 
              color: '#64748b', 
              cursor: 'pointer', 
              fontSize: '1.5rem',
              padding: '4px',
              lineHeight: 1,
              transition: 'color 0.2s'
            }}
            onMouseEnter={(e) => e.currentTarget.style.color = '#fff'}
            onMouseLeave={(e) => e.currentTarget.style.color = '#64748b'}
          >
            ×
          </button>
        </div>
        
        <h2 style={{ fontSize: '1.25rem', margin: '0 0 4px 0', color: '#fff', fontWeight: 600 }}>{selectedNode.label}</h2>
        <p style={{ fontSize: '0.75rem', color: '#64748b', wordBreak: 'break-all', marginBottom: '24px', opacity: 0.8 }}>{selectedNode.id}</p>
      </div>
      
      {/* Scrollable Code Section */}
      <div style={{ 
        flex: 1, 
        overflowY: 'auto', 
        padding: '0 24px 24px 24px',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0 // <--- Critical for flexbox scrolling
      }}>
        {selectedNode.code ? (
          <div style={{ 
            borderRadius: '8px', 
            overflow: 'hidden', 
            border: '1px solid rgba(255,255,255,0.05)',
            background: '#1e1e20',
            flex: 1,
            display: 'flex',
            flexDirection: 'column'
          }}>
            <SyntaxHighlighter 
              language="rust" 
              style={atomDark}
              showLineNumbers={true}
              wrapLongLines={true}
              customStyle={{
                margin: 0,
                padding: '20px',
                fontSize: '0.85rem',
                lineHeight: '1.6',
                background: 'transparent',
                flex: 1,
                overflowY: 'auto'
              }}
            >
              {selectedNode.code}
            </SyntaxHighlighter>
          </div>
        ) : (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: '#64748b', fontSize: '0.9rem' }}>
            <p style={{ fontStyle: 'italic' }}>No code content available for this node.</p>
          </div>
        )}
      </div>
    </div>
  );
};
