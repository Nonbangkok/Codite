import type { LinkData, NodeData } from '../types';

export interface SimNode extends NodeData {
  fx?: number | null;
  fy?: number | null;
}

export interface SimLink extends Omit<LinkData, 'source' | 'target' | 'type'> {
  source: string | SimNode;
  target: string | SimNode;
  type?: string;
}

const LEAF_GROUPS = new Set(['functions', 'structs', 'enums', 'traits']);

const nodeId = (node: string | SimNode): string => (
  typeof node === 'string' ? node : node.id
);

const nodeGroup = (node: string | SimNode): string | null => (
  typeof node === 'string' ? null : node.group
);

export const isLeafNode = (node: string | SimNode): boolean => {
  const group = nodeGroup(node);
  return group ? LEAF_GROUPS.has(group) : false;
};

export const createDegreeMap = (nodes: SimNode[], links: SimLink[]): Map<string, number> => {
  const degree = new Map<string, number>();
  for (const node of nodes) degree.set(node.id, 0);

  for (const link of links) {
    const source = nodeId(link.source);
    const target = nodeId(link.target);
    degree.set(source, (degree.get(source) ?? 0) + 1);
    degree.set(target, (degree.get(target) ?? 0) + 1);
  }

  return degree;
};

export const getGraphLinkDistance = (link: SimLink, sqrtNodeCount: number): number => {
  if (isLeafNode(link.source) || isLeafNode(link.target)) {
    return Math.max(34, 58 - sqrtNodeCount * 1.3);
  }

  if (link.type === 'implements') return 68;
  if (link.type === 'declares_module') return 82;
  return 74;
};

export const getGraphLinkStrength = (link: SimLink): number => {
  if (isLeafNode(link.source) || isLeafNode(link.target)) return 0.72;
  if (link.type === 'implements') return 0.58;
  if (link.type === 'declares_module') return 0.48;
  return 0.45;
};

export const getGraphChargeStrength = (
  node: SimNode,
  degree: ReadonlyMap<string, number>
): number => {
  if (isLeafNode(node)) return -55;

  const nodeDegree = degree.get(node.id) ?? 1;
  return -145 - Math.min(120, nodeDegree * 9);
};

export const getCollisionRadius = (node: SimNode): number => {
  const radius = Math.sqrt(node.val || 1) * 1.5;
  return radius + 10;
};

const hasPoint = (node: string | SimNode): node is SimNode => (
  typeof node === 'object'
  && Number.isFinite(node.x)
  && Number.isFinite(node.y)
);

const ccw = (
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number
): boolean => (cy - ay) * (bx - ax) > (by - ay) * (cx - ax);

const crosses = (first: SimLink, second: SimLink): boolean => {
  const a = first.source;
  const b = first.target;
  const c = second.source;
  const d = second.target;

  if (a === c || a === d || b === c || b === d) return false;
  if (!hasPoint(a) || !hasPoint(b) || !hasPoint(c) || !hasPoint(d)) return false;

  return ccw(a.x!, a.y!, c.x!, c.y!, d.x!, d.y!)
    !== ccw(b.x!, b.y!, c.x!, c.y!, d.x!, d.y!)
    && ccw(a.x!, a.y!, b.x!, b.y!, c.x!, c.y!)
    !== ccw(a.x!, a.y!, b.x!, b.y!, d.x!, d.y!);
};

const normalFor = (source: SimNode, target: SimNode): { x: number; y: number } => {
  const dx = target.x! - source.x!;
  const dy = target.y! - source.y!;
  const length = Math.hypot(dx, dy) || 1;
  return { x: -dy / length, y: dx / length };
};

const pushNode = (node: SimNode, normal: { x: number; y: number }, amount: number) => {
  if (node.fx != null || node.fy != null) return;
  node.vx = (node.vx ?? 0) + normal.x * amount;
  node.vy = (node.vy ?? 0) + normal.y * amount;
};

export const createCrossingReductionForce = (
  links: SimLink[],
  samplesPerTick = 1200
) => {
  let firstIndex = 0;
  let secondIndex = 1;

  const advancePair = () => {
    secondIndex++;
    if (secondIndex >= links.length) {
      firstIndex++;
      secondIndex = firstIndex + 1;
    }
    if (firstIndex >= links.length - 1) {
      firstIndex = 0;
      secondIndex = 1;
    }
  };

  const force = (alpha: number) => {
    if (alpha < 0.003 || links.length < 2) return;

    const checks = Math.min(samplesPerTick, (links.length * (links.length - 1)) >> 1);
    for (let i = 0; i < checks; i++) {
      const first = links[firstIndex];
      const second = links[secondIndex];
      advancePair();
      if (!crosses(first, second)) continue;

      const a = first.source;
      const b = first.target;
      const c = second.source;
      const d = second.target;
      if (!hasPoint(a) || !hasPoint(b) || !hasPoint(c) || !hasPoint(d)) continue;

      const firstNormal = normalFor(a, b);
      const secondNormal = normalFor(c, d);
      const firstMidX = (a.x! + b.x!) / 2;
      const firstMidY = (a.y! + b.y!) / 2;
      const secondMidX = (c.x! + d.x!) / 2;
      const secondMidY = (c.y! + d.y!) / 2;
      const firstDirection = Math.sign(
        (firstMidX - secondMidX) * firstNormal.x + (firstMidY - secondMidY) * firstNormal.y
      ) || 1;
      const secondDirection = Math.sign(
        (secondMidX - firstMidX) * secondNormal.x + (secondMidY - firstMidY) * secondNormal.y
      ) || -1;
      const push = 36 * alpha;

      pushNode(a, firstNormal, firstDirection * push);
      pushNode(b, firstNormal, firstDirection * push);
      pushNode(c, secondNormal, secondDirection * push);
      pushNode(d, secondNormal, secondDirection * push);
    }
  };

  force.initialize = () => undefined;

  return force;
};
