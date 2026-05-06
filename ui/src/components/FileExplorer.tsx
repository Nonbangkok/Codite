import React, { useState } from 'react';
import { Folder, FileText, ChevronRight, ChevronDown, Filter, X } from 'lucide-react';
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
  const [isOpen, setIsOpen] = useState(true);
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
        padding: '16px', 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        borderBottom: '1px solid rgba(255, 255, 255, 0.03)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', color: '#94a3b8', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          <Filter size={14} style={{ marginRight: '8px' }} />
          Explorer
        </div>
        {activeFolderPath && (
          <button
            onClick={() => onFolderSelect(null)}
            style={{
              background: 'rgba(244, 214, 118, 0.1)',
              border: 'none',
              color: '#f4d676',
              borderRadius: '4px',
              padding: '2px 6px',
              fontSize: '0.65rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            Clear <X size={10} style={{ marginLeft: '4px' }} />
          </button>
        )}
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
