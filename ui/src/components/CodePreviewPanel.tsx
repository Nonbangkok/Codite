import React from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { atomDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { NodeData } from '../types';

interface CodePreviewPanelProps {
  selectedNode: NodeData;
  onClose: () => void;
}

const LANGUAGE_BADGE: Record<string, { label: string; color: string }> = {
  rust: { label: 'RS', color: '#dea584' },
  typescript: { label: 'TS', color: '#3178c6' },
  javascript: { label: 'JS', color: '#f7df1e' },
  python: { label: 'PY', color: '#4b8bbe' },
};

const HIGHLIGHTER_LANGUAGE: Record<string, string> = {
  rust: 'rust',
  typescript: 'typescript',
  javascript: 'javascript',
  python: 'python',
};

export const CodePreviewPanel: React.FC<CodePreviewPanelProps> = ({ selectedNode, onClose }) => {
  const badge = LANGUAGE_BADGE[selectedNode.language] ?? { label: selectedNode.language.toUpperCase().slice(0, 3), color: '#475569' };
  const highlighterLang = HIGHLIGHTER_LANGUAGE[selectedNode.language] ?? 'text';

  return (
    <div style={{
      width: '100%',
      height: '100vh',
      background: '#161618',
      borderLeft: '1px solid rgba(255,255,255,0.05)',
      color: '#e2e8f0',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'Inter, sans-serif'
    }}>
      <div style={{
        padding: '24px 24px 20px 24px',
        flexShrink: 0,
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        background: 'linear-gradient(to bottom, #1e1e20, #161618)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
          <div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px' }}>
              <span style={{
                background: '#475569',
                padding: '4px 10px',
                borderRadius: '4px',
                fontSize: '0.7rem',
                fontWeight: 'bold',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: '#cbd5e1',
                display: 'inline-block'
              }}>
                TYPE: {selectedNode.group}
              </span>
              <span style={{
                background: badge.color,
                padding: '4px 10px',
                borderRadius: '4px',
                fontSize: '0.7rem',
                fontWeight: 'bold',
                color: '#161618',
                display: 'inline-block'
              }}>
                {badge.label}
              </span>
            </div>
            <h2 style={{ fontSize: '1.4rem', margin: '0 0 8px 0', color: '#fff', fontWeight: 600, wordBreak: 'break-all' }}>
              {selectedNode.label}
            </h2>
          </div>
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
              transition: 'color 0.2s',
              marginTop: '-4px'
            }}
            onMouseEnter={(e) => e.currentTarget.style.color = '#fff'}
            onMouseLeave={(e) => e.currentTarget.style.color = '#64748b'}
          >
            ×
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-start', color: '#64748b', fontSize: '0.8rem' }}>
          <span style={{ fontWeight: 600, marginRight: '8px', opacity: 0.7, marginTop: '2px' }}>PATH:</span>
          <span style={{ wordBreak: 'break-all', opacity: 0.9, lineHeight: 1.4 }}>{selectedNode.id}</span>
        </div>
      </div>

      <div style={{
        flex: 1,
        overflowY: 'auto',
        overflowX: 'hidden',
        padding: '24px',
        minHeight: 0
      }}>
        {selectedNode.code ? (
          <div style={{
            borderRadius: '8px',
            border: '1px solid rgba(255,255,255,0.05)',
            background: '#1e1e20',
            overflow: 'hidden'
          }}>
            <SyntaxHighlighter
              language={highlighterLang}
              style={atomDark}
              showLineNumbers={true}
              wrapLines={true}
              lineProps={{
                style: {
                  display: 'block',
                  paddingLeft: '4em',
                  textIndent: '-4em',
                  wordBreak: 'break-all',
                  whiteSpace: 'pre-wrap'
                }
              }}
              codeTagProps={{
                style: {
                  whiteSpace: 'pre-wrap',
                }
              }}
              customStyle={{
                margin: 0,
                padding: '20px',
                fontSize: '0.85rem',
                lineHeight: '1.6',
                background: 'transparent',
                overflow: 'visible'
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
