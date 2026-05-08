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
