import type { NodeData, LinkData } from '../types';

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

export const buildFolderNodes = (
  fileNodes: NodeData[]
): { nodes: NodeData[]; links: LinkData[] } => {
  const folderSet = new Set<string>();

  fileNodes.forEach(node => {
    const parts = node.id.split('/');
    for (let i = 1; i < parts.length; i++) {
      folderSet.add(parts.slice(0, i).join('/'));
    }
  });

  const nodes: NodeData[] = Array.from(folderSet).map(folderPath => ({
    id: folderPath,
    label: folderPath.split('/').pop() ?? folderPath,
    group: 'folders',
    language: '',
    val: 4,
  }));

  const links: LinkData[] = [];

  fileNodes.forEach(node => {
    const parts = node.id.split('/');
    if (parts.length > 1) {
      const parentPath = parts.slice(0, -1).join('/');
      links.push({ source: parentPath, target: node.id, type: 'contains' });
    }
  });

  folderSet.forEach(folderPath => {
    const parts = folderPath.split('/');
    if (parts.length > 1) {
      const parentPath = parts.slice(0, -1).join('/');
      if (folderSet.has(parentPath)) {
        links.push({ source: parentPath, target: folderPath, type: 'contains' });
      }
    }
  });

  return { nodes, links };
};
