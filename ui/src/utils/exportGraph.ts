import type { GraphData, NodeData } from '../types';
import { linkEndId } from './graphIndex';

export interface SvgStyle {
  background: string;
  link: string;
  label: string;
  colorOf: (node: NodeData) => string;
  showLabels: boolean;
}

const escapeXml = (s: string) =>
  s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);

export const nodeRadius = (node: Pick<NodeData, 'val'>) => Math.sqrt(node.val || 1) * 1.3;

/** Renders the current layout (node x/y set by the simulation) as a standalone SVG document. */
export const graphToSvg = (graph: GraphData, style: SvgStyle): string => {
  const placed = graph.nodes.filter((n) => Number.isFinite(n.x) && Number.isFinite(n.y));
  const byId = new Map(placed.map((n) => [n.id, n]));
  const pad = 40;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of placed) {
    const r = nodeRadius(n);
    minX = Math.min(minX, n.x! - r);
    minY = Math.min(minY, n.y! - r);
    maxX = Math.max(maxX, n.x! + r);
    maxY = Math.max(maxY, n.y! + r + (style.showLabels ? 10 : 0));
  }
  if (placed.length === 0) minX = minY = maxX = maxY = 0;
  const width = maxX - minX + pad * 2;
  const height = maxY - minY + pad * 2;
  const vx = minX - pad;
  const vy = minY - pad;

  const lines = graph.links
    .map((l) => {
      const s = byId.get(linkEndId(l.source));
      const t = byId.get(linkEndId(l.target));
      if (!s || !t) return '';
      return `<line x1="${s.x!.toFixed(1)}" y1="${s.y!.toFixed(1)}" x2="${t.x!.toFixed(1)}" y2="${t.y!.toFixed(1)}"/>`;
    })
    .join('');

  const circles = placed
    .map((n) => `<circle cx="${n.x!.toFixed(1)}" cy="${n.y!.toFixed(1)}" r="${nodeRadius(n).toFixed(2)}" fill="${style.colorOf(n)}"><title>${escapeXml(n.id)}</title></circle>`)
    .join('');

  const labels = style.showLabels
    ? placed
        .map((n) => `<text x="${n.x!.toFixed(1)}" y="${(n.y! + nodeRadius(n) + 7).toFixed(1)}">${escapeXml(n.label)}</text>`)
        .join('')
    : '';

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx.toFixed(1)} ${vy.toFixed(1)} ${width.toFixed(1)} ${height.toFixed(1)}" width="${Math.round(width)}" height="${Math.round(height)}">`,
    `<rect x="${vx.toFixed(1)}" y="${vy.toFixed(1)}" width="${width.toFixed(1)}" height="${height.toFixed(1)}" fill="${style.background}"/>`,
    `<g stroke="${style.link}" stroke-width="0.6">${lines}</g>`,
    `<g>${circles}</g>`,
    labels ? `<g fill="${style.label}" font-family="IBM Plex Sans, sans-serif" font-size="5" text-anchor="middle">${labels}</g>` : '',
    '</svg>',
  ].join('');
};

/** Plain JSON of the visible graph, without simulation state or source code. */
export const graphToJson = (graph: GraphData): string =>
  JSON.stringify(
    {
      nodes: graph.nodes.map(({ id, label, group, language, val }) => ({ id, label, group, language, val })),
      links: graph.links.map((l) => ({ source: linkEndId(l.source), target: linkEndId(l.target), type: l.type })),
    },
    null,
    2,
  );

export const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/** Copies a graph canvas onto a solid background and returns it as a PNG blob. */
export const canvasToPng = (canvas: HTMLCanvasElement, background: string): Promise<Blob | null> => {
  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, 0, 0);
  return new Promise((resolve) => out.toBlob(resolve, 'image/png'));
};

export const safeFilename = (name: string) => name.replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'graph';
