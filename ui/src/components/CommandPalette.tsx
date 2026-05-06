import React, { useState, useEffect, useMemo, useRef } from 'react';
import Fuse from 'fuse.js';
import { Search, File, Box, FunctionSquare, Zap, Layers } from 'lucide-react';
import type { NodeData } from '../types';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  nodes: NodeData[];
  onSelect: (node: NodeData) => void;
}

const TYPE_ICONS: Record<string, any> = {
  functions: FunctionSquare,
  structs: Box,
  enums: Layers,
  traits: Zap,
  default: File
};

export const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose, nodes, onSelect }) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const fuse = useMemo(() => {
    return new Fuse(nodes, {
      keys: ['label', 'id'],
      threshold: 0.4,
      includeMatches: true
    });
  }, [nodes]);

  const results = useMemo(() => {
    if (!query) return nodes.slice(0, 10); // Show some defaults
    return fuse.search(query).map(r => r.item).slice(0, 15);
  }, [fuse, query, nodes]);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => (prev + 1) % results.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => (prev - 1 + results.length) % results.length);
      } else if (e.key === 'Enter') {
        if (results[selectedIndex]) {
          onSelect(results[selectedIndex]);
          onClose();
        }
      } else if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, results, selectedIndex, onSelect, onClose]);

  if (!isOpen) return null;

  return (
    <div 
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        backdropFilter: 'blur(4px)',
        zIndex: 1000,
        display: 'flex',
        justifyContent: 'center',
        paddingTop: '15vh'
      }}
    >
      <div 
        onClick={e => e.stopPropagation()}
        style={{
          width: 'min(600px, 90vw)',
          height: 'fit-content',
          maxHeight: '60vh',
          backgroundColor: '#1e1e20',
          borderRadius: '12px',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', padding: '16px', borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
          <Search size={20} color="#64748b" style={{ marginRight: '12px' }} />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search files, functions, structs..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{
              flex: 1,
              background: 'none',
              border: 'none',
              color: '#fff',
              fontSize: '1rem',
              outline: 'none',
              fontFamily: 'Inter, sans-serif'
            }}
          />
        </div>

        <div style={{ overflowY: 'auto', padding: '8px' }}>
          {results.length > 0 ? (
            results.map((node, index) => {
              const Icon = TYPE_ICONS[node.group] || TYPE_ICONS.default;
              const isSelected = index === selectedIndex;
              return (
                <div
                  key={node.id}
                  onClick={() => {
                    onSelect(node);
                    onClose();
                  }}
                  onMouseEnter={() => setSelectedIndex(index)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    backgroundColor: isSelected ? 'rgba(244, 214, 118, 0.1)' : 'transparent',
                    transition: 'background 0.2s'
                  }}
                >
                  <Icon 
                    size={18} 
                    color={isSelected ? '#f4d676' : '#64748b'} 
                    style={{ marginRight: '12px', flexShrink: 0 }} 
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: isSelected ? '#fff' : '#e2e8f0', fontSize: '0.9rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {node.label}
                    </div>
                    <div style={{ color: '#64748b', fontSize: '0.7rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {node.id}
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div style={{ padding: '20px', textAlign: 'center', color: '#64748b', fontSize: '0.9rem' }}>
              No results found for "{query}"
            </div>
          )}
        </div>

        <div style={{ padding: '8px 16px', backgroundColor: 'rgba(0, 0, 0, 0.2)', borderTop: '1px solid rgba(255, 255, 255, 0.05)', display: 'flex', gap: '16px' }}>
          <div style={{ fontSize: '0.7rem', color: '#475569' }}>
            <span style={{ backgroundColor: '#334155', padding: '2px 4px', borderRadius: '3px', marginRight: '4px', color: '#94a3b8' }}>↑↓</span>
            Navigate
          </div>
          <div style={{ fontSize: '0.7rem', color: '#475569' }}>
            <span style={{ backgroundColor: '#334155', padding: '2px 4px', borderRadius: '3px', marginRight: '4px', color: '#94a3b8' }}>Enter</span>
            Select
          </div>
          <div style={{ fontSize: '0.7rem', color: '#475569' }}>
            <span style={{ backgroundColor: '#334155', padding: '2px 4px', borderRadius: '3px', marginRight: '4px', color: '#94a3b8' }}>Esc</span>
            Close
          </div>
        </div>
      </div>
    </div>
  );
};
