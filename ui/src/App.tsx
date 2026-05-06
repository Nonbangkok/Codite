import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { GraphData, NodeData } from './types';
import { GraphView } from './components/GraphView';
import { CodePreviewPanel } from './components/CodePreviewPanel';
import { CommandPalette } from './components/CommandPalette';
import { FileExplorer } from './components/FileExplorer';
import { buildFileTree } from './utils/treeUtils';

function App() {
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [activeFolderPath, setActiveFolderPath] = useState<string | null>(null);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState(900);
  const [isResizing, setIsResizing] = useState(false);
  const prevDataStrRef = useRef<string>('');

  // ดึงข้อมูลจากไฟล์ที่ Backend สร้างขึ้น
  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch('/data.json');
        const data = await response.json();

        const filteredNodes = data.nodes.filter((n: NodeData) => n.group !== 'imports');
        const validNodeIds = new Set(filteredNodes.map((n: NodeData) => n.id));
        const filteredLinks = data.links.filter((l: any) => {
          const sourceId = typeof l.source === 'string' ? l.source : l.source.id;
          const targetId = typeof l.target === 'string' ? l.target : l.target.id;
          return validNodeIds.has(sourceId) && validNodeIds.has(targetId);
        });

        const finalData = { nodes: filteredNodes, links: filteredLinks };
        const dataStr = JSON.stringify(finalData);

        if (dataStr !== prevDataStrRef.current) {
          setGraphData(finalData);
          prevDataStrRef.current = dataStr;
        }
      } catch (error) {
        console.error('Error loading graph data:', error);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  // ปุ่มลัดเปิด Command Palette
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'p')) {
        e.preventDefault();
        setIsCommandPaletteOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // กรองข้อมูลตามโฟลเดอร์ที่เลือก (Folder Filtering)
  const filteredData = useMemo(() => {
    if (!activeFolderPath) return graphData;

    const nodes = graphData.nodes.filter(n => n.id.startsWith(activeFolderPath));
    const nodeIds = new Set(nodes.map(n => n.id));

    const links = graphData.links.filter(l => {
      const sourceId = typeof l.source === 'object' ? l.source.id : l.source;
      const targetId = typeof l.target === 'object' ? l.target.id : l.target;
      return sourceId && targetId && nodeIds.has(sourceId) && nodeIds.has(targetId);
    });

    return { nodes, links };
  }, [graphData, activeFolderPath]);

  const fileTree = useMemo(() => buildFileTree(graphData.nodes), [graphData.nodes]);

  // ระบบขยายขนาดแถบข้าง (Resizing Logic)
  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  const stopResizing = useCallback(() => {
    setIsResizing(false);
  }, []);

  const resize = useCallback((e: MouseEvent) => {
    if (isResizing) {
      const newWidth = document.body.clientWidth - e.clientX;
      if (newWidth > 300 && newWidth < 900) {
        setPanelWidth(newWidth);
      }
    }
  }, [isResizing]);

  useEffect(() => {
    window.addEventListener('mousemove', resize);
    window.addEventListener('mouseup', stopResizing);
    return () => {
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
    };
  }, [resize, stopResizing]);

  const selectedNode = useMemo(() => {
    return graphData.nodes.find(n => n.id === selectedNodeId) || null;
  }, [graphData.nodes, selectedNodeId]);

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#161618', overflow: 'hidden', display: 'flex' }}>
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        nodes={graphData.nodes}
        onSelect={(node) => {
          // ถ้าโหนดอยู่ข้างนอกโฟลเดอร์ที่กรองอยู่ ให้ล้างตัวกรองก่อน
          if (activeFolderPath && !node.id.startsWith(activeFolderPath)) {
            setActiveFolderPath(null);
          }
          setSelectedNodeId(node.id);
        }}
      />

      <FileExplorer
        tree={fileTree}
        activeFolderPath={activeFolderPath}
        onFolderSelect={setActiveFolderPath}
        onFileSelect={setSelectedNodeId}
      />

      {/* Main Graph Area */}
      <div style={{ flex: 1, position: 'relative' }}>
        {/* Header Info */}
        <div style={{
          position: 'absolute',
          top: 20,
          left: 20,
          zIndex: 10,
          color: '#a2a7b6',
          fontFamily: 'Inter, sans-serif',
          pointerEvents: 'none'
        }}>
          <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 600 }}>AtloGraph</h1>
          {activeFolderPath ? (
            <p style={{ margin: '4px 0', color: '#f4d676', fontSize: '0.9rem', display: 'flex', alignItems: 'center' }}>
              Viewing Scope: {activeFolderPath}
            </p>
          ) : (
            <p style={{ margin: '4px 0', opacity: 0.6, fontSize: '0.9rem' }}>Visualizing Codebase like Obsidian</p>
          )}
        </div>

        <GraphView
          graphData={filteredData}
          selectedNode={selectedNode}
          onNodeSelect={(node) => setSelectedNodeId(node ? node.id : null)}
          customWidthOffset={selectedNode ? panelWidth : 0}
        />
      </div>

      {/* Resizer Handle */}
      {selectedNode && (
        <div
          onMouseDown={startResizing}
          style={{
            width: '4px',
            cursor: 'col-resize',
            background: isResizing ? '#f4d676' : 'transparent',
            zIndex: 150,
            transition: 'background 0.2s',
            borderLeft: '1px solid rgba(255,255,255,0.05)'
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(244, 214, 118, 0.3)'}
          onMouseLeave={(e) => e.currentTarget.style.background = isResizing ? '#f4d676' : 'transparent'}
        />
      )}

      {/* Code Preview Panel */}
      <div style={{
        width: selectedNode ? `${panelWidth}px` : '0px',
        opacity: selectedNode ? 1 : 0,
        transition: isResizing ? 'none' : 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
        overflow: 'hidden',
        flexShrink: 0,
        zIndex: 100,
        boxShadow: '-10px 0 30px rgba(0,0,0,0.5)',
        display: 'flex'
      }}>
        {selectedNode && (
          <CodePreviewPanel
            selectedNode={selectedNode}
            onClose={() => setSelectedNodeId(null)}
            width={panelWidth}
          />
        )}
      </div>

      <style>{`
        body { margin: 0; padding: 0; background: #161618; font-family: 'Inter', sans-serif; }
        canvas { cursor: crosshair; }
        * { box-sizing: border-box; }
      `}</style>
    </div>
  );
}

export default App;
