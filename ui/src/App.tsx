import { useState, useEffect } from 'react';
import type { GraphData, NodeData } from './types';
import { GraphView } from './components/GraphView';
import { CodePreviewPanel } from './components/CodePreviewPanel';

function App() {
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });
  const [selectedNode, setSelectedNode] = useState<NodeData | null>(null);

  // ดึงข้อมูลจากไฟล์ที่ Backend สร้างขึ้น
  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch('/data.json');
        const data = await response.json();
        setGraphData(data);
      } catch (error) {
        console.error('Error loading graph data:', error);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#0f172a', overflow: 'hidden', display: 'flex' }}>
      {/* Header Info */}
      <div style={{ 
        position: 'absolute', 
        top: 20, 
        left: 20, 
        zIndex: 10, 
        color: 'white', 
        fontFamily: 'Inter, sans-serif',
        pointerEvents: 'none'
      }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 600 }}>AtloGraph</h1>
        <p style={{ margin: '4px 0', opacity: 0.6, fontSize: '0.9rem' }}>Visualizing Codebase like Obsidian</p>
      </div>

      {/* Main Graph Area */}
      <div style={{ flex: 1, position: 'relative' }}>
        <GraphView 
          graphData={graphData} 
          selectedNode={selectedNode} 
          onNodeSelect={setSelectedNode} 
        />
      </div>

      {/* Code Preview Panel */}
      {selectedNode && (
        <CodePreviewPanel 
          selectedNode={selectedNode} 
          onClose={() => setSelectedNode(null)} 
        />
      )}

      <style>{`
        body { margin: 0; padding: 0; background: #0f172a; }
        canvas { cursor: crosshair; }
      `}</style>
    </div>
  );
}

export default App;
