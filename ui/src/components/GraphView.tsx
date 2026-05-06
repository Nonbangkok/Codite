import React, { useCallback, useState, useEffect, useRef } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import * as d3 from 'd3';
import type { GraphData, NodeData, LinkData } from '../types';

interface GraphViewProps {
  graphData: GraphData;
  selectedNode: NodeData | null;
  onNodeSelect: (node: NodeData | null) => void;
  customWidthOffset?: number;
}

const TYPE_COLORS: Record<string, string> = {
  functions: '#d19a66', // Peach/Orange
  structs: '#61afef',   // Blue
  enums: '#c678dd',     // Purple
  traits: '#98c379',    // Green
  default: '#a2a7b6'    // Grey-blue for files/others
};

export const GraphView: React.FC<GraphViewProps> = ({ graphData, selectedNode, onNodeSelect, customWidthOffset = 0 }) => {
  const [hoverNode, setHoverNode] = useState<NodeData | null>(null);
  const [highlightNodes, setHighlightNodes] = useState<Set<string>>(new Set());
  const [highlightLinks, setHighlightLinks] = useState<Set<LinkData>>(new Set());
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const fgRef = useRef<any>(null);

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // ปรับแต่งแรงผลักและระยะห่างของ d3-force เพื่อให้โหนดอยู่ห่างกันพอดีและไม่ซ้อนทับกัน
  useEffect(() => {
    if (fgRef.current) {
      // แรงผลักระดับกลาง ไม่ให้กราฟใหญ่เกินไป (จาก -400 เหลือ -150)
      fgRef.current.d3Force('charge').strength(-150);
      // ระยะเส้นเชื่อม
      fgRef.current.d3Force('link').distance(100);
      // เพิ่ม Force Collide (แรงต้านการชน) เพื่อป้องกันโหนดและข้อความซ้อนทับกัน
      fgRef.current.d3Force('collide', d3.forceCollide().radius((node: any) => {
        const radius = Math.sqrt(node.val || 1) * 2;
        return radius + 25; // เผื่อระยะ 25px รอบๆ โหนดสำหรับข้อความและพื้นที่ว่าง
      }));
    }
  }, []);

  const [fadeOpacity, setFadeOpacity] = useState(1.0);
  const fadeRequestId = useRef<number>(null);

  // เอฟเฟกต์การซูมเมื่อเลือกโหนด (Zoom to Node)
  useEffect(() => {
    if (selectedNode && fgRef.current && selectedNode.x !== undefined && selectedNode.y !== undefined) {
      // พุ่งไปยังตำแหน่งโหนดและซูมเข้าไปใกล้ๆ
      fgRef.current.zoom(2.5, 800); // ซูม 2.5x ในเวลา 800ms
      fgRef.current.centerAt(selectedNode.x, selectedNode.y, 800);
    }
  }, [selectedNode]);

  useEffect(() => {
    const target = hoverNode ? 0.15 : 1.0;
    const step = 0.05; // ความเร็วในการจาง

    const animate = () => {
      setFadeOpacity(prev => {
        if (Math.abs(prev - target) < step) return target;
        return prev + (target > prev ? step : -step);
      });
      fadeRequestId.current = requestAnimationFrame(animate);
    };

    if (fadeRequestId.current) cancelAnimationFrame(fadeRequestId.current);
    fadeRequestId.current = requestAnimationFrame(animate);

    return () => {
      if (fadeRequestId.current) cancelAnimationFrame(fadeRequestId.current);
    };
  }, [hoverNode]);

  const handleNodeHover = useCallback((node: NodeData | null) => {
    const newHighlightNodes = new Set<string>();
    const newHighlightLinks = new Set<LinkData>();

    if (node) {
      newHighlightNodes.add(node.id);
      graphData.links.forEach((link: any) => {
        const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
        const targetId = typeof link.target === 'object' ? link.target.id : link.target;
        if (sourceId === node.id || targetId === node.id) {
          newHighlightLinks.add(link);
          newHighlightNodes.add(sourceId);
          newHighlightNodes.add(targetId);
        }
      });
    }

    setHoverNode(node || null);
    setHighlightNodes(newHighlightNodes);
    setHighlightLinks(newHighlightLinks);
  }, [graphData.links]);

  const paintNode = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const label = node.label;
    const fontSize = 10;
    const radius = Math.sqrt(node.val || 1) * 2;
    
    const isHighlighted = highlightNodes.has(node.id);
    const isSelected = selectedNode?.id === node.id;
    const isHovered = hoverNode?.id === node.id;
    const isNeighbor = hoverNode && highlightNodes.has(node.id) && !isHovered;
    
    // กำหนดสีตามประเภทของโหนด
    const baseColor = TYPE_COLORS[node.group] || TYPE_COLORS.default;
    
    // ถ้าเป็น Focus (Selected/Hovered) ให้ใช้สีเหลือง Highlight
    let color = baseColor;
    if (isSelected || isHovered) {
      color = '#f4d676'; // Highlight yellow
    } else if (isNeighbor) {
      // เพื่อนบ้านให้ใช้สีเดิมแต่สว่างขึ้นนิดหน่อย หรือรักษาสีเดิมไว้
      color = d3.color(baseColor)?.brighter(0.5).toString() || baseColor;
    }

    const opacity = isHighlighted ? 1 : fadeOpacity;

    ctx.beginPath();
    ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
    ctx.fillStyle = d3.color(color)?.copy({ opacity }).toString() || color;
    ctx.fill();

    // แสดงข้อความเมื่อซูมเข้าใกล้ๆ หรือกำลัง Highlight/Select
    if (globalScale > 0.6 || isHighlighted || isSelected) {
      ctx.font = `normal ${fontSize}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = d3.color(color)?.copy({ opacity }).toString() || color;
      ctx.fillText(label, node.x, node.y + radius + 1.5);
    }
  }, [hoverNode, highlightNodes, selectedNode, fadeOpacity]);

  return (
    <ForceGraph2D
      ref={fgRef}
      width={windowWidth - customWidthOffset - 260}
      graphData={graphData}
      nodeCanvasObject={paintNode}
      nodeLabel={() => ""} // ปิด tooltip เพราะเราวาดข้อความเอง
      onNodeHover={handleNodeHover}
      onNodeClick={(node) => onNodeSelect(node as NodeData)}
      onBackgroundClick={() => onNodeSelect(null)}
      // สีของเส้นเชื่อม: ค่อยๆ จางลงตาม fadeOpacity
      linkColor={(link) => {
        const isHighlighted = highlightLinks.has(link as LinkData);
        const opacity = isHighlighted ? 0.6 : (fadeOpacity * 0.15);
        return `rgba(162, 167, 182, ${opacity})`;
      }}
      linkWidth={(link) => highlightLinks.has(link as LinkData) ? 1.5 : 0.5}
      d3AlphaDecay={0.02}
      cooldownTicks={100}
    />
  );
};

