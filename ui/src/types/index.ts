export interface NodeData {
  id: string;
  label: string;
  group: string;
  val: number;
  code?: string;
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
