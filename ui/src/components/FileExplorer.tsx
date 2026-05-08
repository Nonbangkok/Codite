import React, { useState } from 'react';
import { Folder, FileText, ChevronRight, ChevronDown, X } from 'lucide-react';
import type { FileTreeItem } from '../utils/treeUtils';

interface FileExplorerProps {
  tree: FileTreeItem[];
  activeFolderPath: string | null;
  onFolderSelect: (path: string | null) => void;
  onFileSelect: (id: string) => void;
}

const TreeItem: React.FC<{
  item: FileTreeItem;
  level: number;
  activeFolderPath: string | null;
  onFolderSelect: (path: string | null) => void;
  onFileSelect: (id: string) => void;
}> = ({ item, level, activeFolderPath, onFolderSelect, onFileSelect }) => {
  const [isOpen, setIsOpen] = useState(false);
  const isSelected = activeFolderPath === item.path;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (item.type === 'folder') {
      onFolderSelect(item.path);
      setIsOpen(!isOpen);
    } else {
      onFileSelect(item.path);
    }
  };

  return (
    <div>
      <div
        onClick={handleClick}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '4px 8px',
          marginLeft: `${level * 12}px`,
          borderRadius: '4px',
          cursor: 'pointer',
          backgroundColor: isSelected ? 'rgba(244, 214, 118, 0.15)' : 'transparent',
          color: isSelected ? '#f4d676' : '#e2e8f0',
          fontSize: '0.85rem',
          transition: 'background 0.2s',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}
        onMouseEnter={(e) => !isSelected && (e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)')}
        onMouseLeave={(e) => !isSelected && (e.currentTarget.style.backgroundColor = 'transparent')}
      >
        {item.type === 'folder' ? (
          <>
            {isOpen ? <ChevronDown size={14} style={{ marginRight: '4px' }} /> : <ChevronRight size={14} style={{ marginRight: '4px' }} />}
            <Folder size={14} style={{ marginRight: '8px', color: isSelected ? '#f4d676' : '#64748b' }} />
          </>
        ) : (
          <FileText size={14} style={{ marginRight: '8px', marginLeft: '18px', color: '#64748b' }} />
        )}
        {item.name}
      </div>
      {item.type === 'folder' && isOpen && item.children && (
        <div>
          {item.children.map(child => (
            <TreeItem 
              key={child.path} 
              item={child} 
              level={level + 1} 
              activeFolderPath={activeFolderPath}
              onFolderSelect={onFolderSelect}
              onFileSelect={onFileSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const FileExplorer: React.FC<FileExplorerProps> = ({ tree, activeFolderPath, onFolderSelect, onFileSelect }) => {
  return (
    <div style={{
      width: '260px',
      height: '100vh',
      background: '#161618',
      borderRight: '1px solid rgba(255, 255, 255, 0.05)',
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0
    }}>
      <div style={{ 
        padding: '20px 16px', 
        borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
        background: 'rgba(255, 255, 255, 0.01)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ 
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <img src="/logo.svg" alt="Codite Logo" style={{ width: '32px', height: '32px' }} />
            </div>
            <h1 style={{ 
              margin: 0, 
              fontSize: '1.2rem', 
              fontWeight: 800, 
              color: '#f8fafc',
              letterSpacing: '-0.03em',
              textTransform: 'uppercase'
            }}>Codite</h1>
          </div>
          
          {activeFolderPath && (
            <button
              onClick={() => onFolderSelect(null)}
              title="Clear filter"
              style={{
                background: 'rgba(244, 214, 118, 0.1)',
                border: '1px solid rgba(244, 214, 118, 0.2)',
                color: '#f4d676',
                borderRadius: '6px',
                padding: '4px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                transition: 'all 0.2s'
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(244, 214, 118, 0.2)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(244, 214, 118, 0.1)'}
            >
              <X size={14} />
            </button>
          )}
        </div>
        
        <p style={{ 
          margin: 0, 
          fontSize: '0.7rem', 
          color: '#64748b', 
          fontWeight: 500,
          lineHeight: '1.4'
        }}>
          {activeFolderPath ? (
            <span style={{ color: '#f4d676' }}>Scope: {activeFolderPath.split('/').pop()}</span>
          ) : (
            "Visualizing Your Codebase"
          )}
        </p>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 8px' }}>
        {tree.map(item => (
          <TreeItem 
            key={item.path} 
            item={item} 
            level={0} 
            activeFolderPath={activeFolderPath}
            onFolderSelect={onFolderSelect}
            onFileSelect={onFileSelect}
          />
        ))}
      </div>

      <div style={{ padding: '12px', borderTop: '1px solid rgba(255, 255, 255, 0.03)', fontSize: '0.7rem', color: '#475569' }}>
        Click folder to filter graph view
      </div>
    </div>
  );
};
