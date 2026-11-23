export interface NodeData {
  id: string;
  label: string;
  group: string;
  language: string;
  val: number;
  code?: string;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  /** Fixed position (pinned by dragging). */
  fx?: number;
  fy?: number;
  /** Set on the synthetic node that stands in for a collapsed folder. */
  collapsedCount?: number;
  /** Phase 5 analyzer fields (optional for older data files). */
  kind?: string;
  start_line?: number;
  end_line?: number;
}

export interface LinkData {
  source: string | NodeData;
  target: string | NodeData;
  type: string;
}

export interface GraphData {
  nodes: NodeData[];
  links: LinkData[];
}
