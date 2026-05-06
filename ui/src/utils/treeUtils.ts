import type { NodeData } from '../types';

export interface FileTreeItem {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: FileTreeItem[];
}

export const buildFileTree = (nodes: NodeData[]): FileTreeItem[] => {
  const root: FileTreeItem[] = [];

  // Filter only file nodes for the explorer
  const fileNodes = nodes.filter(n => n.group === 'root' || !n.id.includes('::'));

  fileNodes.forEach(node => {
    const parts = node.id.split('/');
    let currentLevel = root;

    parts.forEach((part, index) => {
      const path = parts.slice(0, index + 1).join('/');
      const isLast = index === parts.length - 1;
      
      let existing = currentLevel.find(item => item.name === part);

      if (!existing) {
        existing = {
          name: part,
          path: path,
          type: isLast ? 'file' : 'folder',
          children: isLast ? undefined : []
        };
        currentLevel.push(existing);
      }

      if (existing.children) {
        currentLevel = existing.children;
      }
    });
  });

  // Sort folders first, then files
  const sortTree = (items: FileTreeItem[]) => {
    items.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'folder' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
    items.forEach(item => {
      if (item.children) sortTree(item.children);
    });
  };

  sortTree(root);
  return root;
};
