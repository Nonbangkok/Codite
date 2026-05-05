import React, { useCallback, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import * as d3 from 'd3';
import type { GraphData, NodeData, LinkData } from '../types';
import { COLORS } from '../utils/constants';

interface GraphViewProps {
  graphData: GraphData;
  selectedNode: NodeData | null;
  onNodeSelect: (node: NodeData | null) => void;
}

export const GraphView: React.FC<GraphViewProps> = ({ graphData, selectedNode, onNodeSelect }) => {
  const [hoverNode, setHoverNode] = useState<NodeData | null>(null);
  const [highlightNodes, setHighlightNodes] = useState<Set<string>>(new Set());
  const [highlightLinks, setHighlightLinks] = useState<Set<LinkData>>(new Set());

  const handleNodeHover = useCallback((node: any) => {
    highlightNodes.clear();
    highlightLinks.clear();

    if (node) {
      highlightNodes.add(node.id);
      graphData.links.forEach((link: any) => {
        if (link.source.id === node.id || link.target.id === node.id) {
          highlightLinks.add(link);
          highlightNodes.add(link.source.id);
          highlightNodes.add(link.target.id);
        }
      });
    }

    setHoverNode(node || null);
    setHighlightNodes(new Set(highlightNodes));
    setHighlightLinks(new Set(highlightLinks));
  }, [graphData]);

  const paintNode = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const label = node.label;
    const fontSize = 12 / globalScale;
    const radius = Math.sqrt(node.val || 1) * 2;
    const color = COLORS[node.group] || "#ffffff";
    
    const isHighlighted = highlightNodes.has(node.id);
    const isSelected = selectedNode?.id === node.id;
    const opacity = hoverNode ? (isHighlighted ? 1 : 0.1) : 1;

    ctx.shadowColor = color;
    ctx.shadowBlur = isHighlighted || isSelected ? 20 : 5;
    
    ctx.beginPath();
    ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
    ctx.fillStyle = d3.color(color)?.copy({ opacity }).toString() || color;
    
    if (isSelected) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2 / globalScale;
      ctx.stroke();
    }
    
    ctx.fill();

    if (globalScale > 1.5 || isHighlighted || isSelected) {
      ctx.shadowBlur = 0;
      ctx.font = `${isHighlighted || isSelected ? 'bold' : 'normal'} ${fontSize}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = `rgba(226, 232, 240, ${opacity})`;
      ctx.fillText(label, node.x, node.y + radius + fontSize);
    }
  }, [hoverNode, highlightNodes, selectedNode]);

  return (
    <ForceGraph2D
      graphData={graphData}
      nodeCanvasObject={paintNode}
      nodeLabel="label"
      onNodeHover={handleNodeHover}
      onNodeClick={(node) => onNodeSelect(node as NodeData)}
      onBackgroundClick={() => onNodeSelect(null)}
      linkColor={(link) => highlightLinks.has(link as LinkData) ? 'rgba(255, 255, 255, 0.8)' : 'rgba(255, 255, 255, 0.05)'}
      linkWidth={(link) => highlightLinks.has(link as LinkData) ? 2 : 1}
      linkDirectionalArrowLength={3}
      linkDirectionalArrowRelPos={1}
      d3Force="charge"
      d3AlphaDecay={0.02}
      cooldownTicks={100}
    />
  );
};
