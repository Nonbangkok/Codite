import { expect, test, type Page } from '@playwright/test';

// Regression tests for graph bugs found by randomized exploration over real repositories:
// nodes flung across the screen, duplicate ids leaving loose nodes, stacked nodes in the tree
// layout, pins lost on layout changes, and nodes too small to drag when zoomed out.

type N = { id: string; label: string; group: string; language: string; val: number };
/** Simulation node as seen through the development debug hook. */
type GNode = N & { x: number; y: number; vx?: number; vy?: number; fx?: number; fy?: number; collapsedCount?: number };
type GEnd = string | GNode;
type GLink = { source: GEnd; target: GEnd; type: string };
type DebugWindow = {
  __coditeGraph: {
    data: { nodes: GNode[]; links: GLink[] };
    screenOf(id: string): { x: number; y: number } | null;
    zoom(): number;
  };
};
type L = { source: string; target: string; type: string };

/** A seeded, code-like graph: folders of files, functions inside files, imports and calls. */
const synthetic = (folders = 6, filesPer = 8, fnsPer = 6, seed = 3) => {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const nodes: N[] = [];
  const links: L[] = [];
  const files: string[] = [];
  const fns: string[] = [];
  for (let f = 0; f < folders; f++) {
    for (let i = 0; i < filesPer; i++) {
      const file = `demo/pkg${f}/file${i}.ts`;
      files.push(file);
      nodes.push({ id: file, label: `file${i}.ts`, group: `pkg${f}`, language: 'typescript', val: 20 });
      for (let k = 0; k < fnsPer; k++) {
        const fn = `${file}::fn::f${k}::${k * 10}`;
        fns.push(fn);
        nodes.push({ id: fn, label: `f${f}_${i}_${k}()`, group: 'functions', language: 'typescript', val: 8 });
        links.push({ source: file, target: fn, type: 'contains' });
      }
    }
  }
  for (const file of files) for (let j = 0; j < 2; j++) links.push({ source: file, target: files[Math.floor(rnd() * files.length)], type: 'imports_module' });
  for (const fn of fns) {
    const other = fns[Math.floor(rnd() * fns.length)];
    links.push({ source: fn, target: other, type: 'calls' });
    if (rnd() < 0.2) links.push({ source: other, target: fn, type: 'calls' });
  }
  return { nodes, links: links.filter((l) => l.source !== l.target) };
};

const load = async (page: Page, graph: unknown) => {
  await page.route('**/data.json*', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(graph) }));
  await page.setViewportSize({ width: 1400, height: 880 });
  await page.goto('/');
  await page.locator('.graph canvas').first().waitFor();
};

/** Highest node speed observed over a short window (graph units per tick). */
const maxSpeed = (page: Page, ms = 1500) =>
  page.evaluate(async (duration) => {
    let max = 0;
    const end = performance.now() + duration;
    while (performance.now() < end) {
      for (const n of (window as unknown as DebugWindow).__coditeGraph.data.nodes) max = Math.max(max, Math.hypot(n.vx ?? 0, n.vy ?? 0));
      await new Promise((r) => requestAnimationFrame(r));
    }
    return max;
  }, ms);

const settle = (page: Page) =>
  page.waitForFunction(() => {
    const ns = (window as unknown as DebugWindow).__coditeGraph.data.nodes;
    let e = 0;
    for (const n of ns) e += (n.vx ?? 0) ** 2 + (n.vy ?? 0) ** 2;
    return ns.length > 0 && e / ns.length < 0.01;
  }, undefined, { timeout: 20_000 });

const nodeState = (page: Page, id: string) =>
  page.evaluate((x) => {
    const n = (window as unknown as DebugWindow).__coditeGraph.data.nodes.find((m: GNode) => m.id === x);
    return n ? { x: n.x, y: n.y, fx: n.fx, fy: n.fy } : null;
  }, id);

/** Drags a node by its current screen position; returns false if it was not grabbable. */
const dragNode = async (page: Page, id: string, dx: number, dy: number) => {
  await settle(page);
  const p = await page.evaluate((x) => (window as unknown as DebugWindow).__coditeGraph.screenOf(x), id);
  const box = (await page.locator('.graph').boundingBox())!;
  if (!p) return false;
  const onCanvas = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName === 'CANVAS', [box.x + p.x, box.y + p.y]);
  if (!onCanvas) return false;
  await page.mouse.move(box.x + p.x, box.y + p.y);
  await page.mouse.down();
  await page.mouse.move(box.x + p.x + dx, box.y + p.y + dy, { steps: 8 });
  await page.mouse.up();
  return true;
};

test.describe('graph stability', () => {
  test.setTimeout(120_000);

  test('big rearrangements glide instead of flinging nodes', async ({ page }) => {
    await load(page, synthetic());
    await settle(page);
    const limit = 24.5; // MAX_NODE_SPEED plus rounding
    const steps: [string, () => Promise<void>][] = [
      ['folder nodes on', () => page.locator('body').press('d')],
      ['radial layout', async () => (await page.locator('body').press('l'), await page.locator('body').press('l'))],
      ['force layout', () => page.locator('body').press('l')],
      ['group by folder', async () => {
        await page.getByRole('button', { name: 'View options' }).click();
        await page.getByLabel('Outline folder groups').check();
        await page.keyboard.press('Escape');
      }],
      ['collapse a folder', async () => {
        await page.getByRole('button', { name: 'View options' }).click();
        await page.getByLabel('Collapse pkg0').check();
        await page.keyboard.press('Escape');
      }],
      ['show a lasso subset', async () => {
        await page.getByRole('button', { name: 'Select an area' }).click();
        const b = (await page.locator('.lasso').boundingBox())!;
        await page.mouse.move(b.x + b.width * 0.3, b.y + b.height * 0.3);
        await page.mouse.down();
        await page.mouse.move(b.x + b.width * 0.7, b.y + b.height * 0.7, { steps: 4 });
        await page.mouse.up();
        await page.locator('.focus-banner', { hasText: 'selected' }).getByRole('button', { name: 'Show only these' }).click();
      }],
    ];
    for (const [name, act] of steps) {
      await act();
      const speed = await maxSpeed(page);
      expect(speed, `max speed after "${name}"`).toBeLessThanOrEqual(limit);
    }
  });

  test('duplicate node ids in the data do not leave loose copies', async ({ page }) => {
    const g = synthetic(2, 3, 2);
    const dup = g.nodes.find((n) => n.id.includes('::fn::'))!;
    g.nodes.push({ ...dup }, { ...dup });
    g.links.push({ ...g.links[0] }, { ...g.links[0] });
    await load(page, g);
    const report = await page.evaluate(() => {
      const { nodes, links } = (window as unknown as DebugWindow).__coditeGraph.data;
      const ids = nodes.map((n: GNode) => n.id);
      const byId = new Map(nodes.map((n: GNode) => [n.id, n]));
      const stale = links.filter((l: GLink) => [l.source, l.target].some((e: GEnd) => typeof e === 'object' && byId.get((e as GNode).id) !== e));
      const keys = links.map((l: GLink) => `${typeof l.source === 'object' ? l.source.id : l.source}>${typeof l.target === 'object' ? l.target.id : l.target}:${l.type}`);
      return { unique: new Set(ids).size === ids.length, stale: stale.length, dupLinks: keys.length - new Set(keys).size };
    });
    expect(report).toEqual({ unique: true, stale: 0, dupLinks: 0 });
  });

  test('the tree layout never stacks nodes, even with a crowded level', async ({ page }) => {
    const nodes: N[] = [{ id: 'demo/hub.ts', label: 'hub.ts', group: 'demo', language: 'typescript', val: 20 }];
    const links: L[] = [];
    for (let i = 0; i < 800; i++) {
      nodes.push({ id: `demo/hub.ts::fn::c${i}::${i}`, label: `c${i}()`, group: 'functions', language: 'typescript', val: 8 });
      links.push({ source: 'demo/hub.ts', target: `demo/hub.ts::fn::c${i}::${i}`, type: 'contains' });
    }
    await load(page, { nodes, links });
    await page.locator('body').press('l');
    await page.waitForTimeout(800);
    const closest = await page.evaluate(() => {
      const ns = (window as unknown as DebugWindow).__coditeGraph.data.nodes;
      let min = Infinity;
      for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) min = Math.min(min, Math.hypot(ns[i].x - ns[j].x, ns[i].y - ns[j].y));
      return min;
    });
    expect(closest).toBeGreaterThanOrEqual(15);
  });

  test('a pinned node keeps its place through tree and radial layouts', async ({ page }) => {
    const g = synthetic(3, 4, 2);
    await load(page, g);
    // Any file node that is not under the legend, minimap or toolbar.
    let id = '';
    for (const candidate of g.nodes.filter((n) => !n.id.includes('::')).map((n) => n.id)) {
      if (await dragNode(page, candidate, 60, 40)) {
        id = candidate;
        break;
      }
    }
    expect(id).not.toBe('');
    await page.waitForTimeout(300);
    const pinned = (await nodeState(page, id))!;
    expect(pinned.fx).toBeDefined();
    for (let i = 0; i < 3; i++) {
      await page.locator('body').press('l'); // tree, radial, force
      await page.waitForTimeout(600);
    }
    const after = (await nodeState(page, id))!;
    expect(after.fx).toBeCloseTo(pinned.fx!, 0);
    expect(after.fy).toBeCloseTo(pinned.fy!, 0);
    // Unpinned nodes were released when leaving the tree layout.
    const fixedCount = await page.evaluate(() => (window as unknown as DebugWindow).__coditeGraph.data.nodes.filter((n: GNode) => n.fx != null).length);
    expect(fixedCount).toBe(1);
  });

  test('small nodes can still be dragged when zoomed far out', async ({ page }) => {
    await load(page, synthetic());
    await settle(page);
    let zoom = 1;
    for (let i = 0; i < 10 && zoom >= 0.3; i++) {
      await page.locator('body').press('-');
      await page.waitForTimeout(400);
      zoom = await page.evaluate(() => (window as unknown as DebugWindow).__coditeGraph.zoom());
    }
    // The view must stay where the user zoomed it (no late auto-fit).
    await page.waitForTimeout(2500);
    zoom = await page.evaluate(() => (window as unknown as DebugWindow).__coditeGraph.zoom());
    expect(zoom).toBeLessThan(0.3);
    const ids: string[] = await page.evaluate(() => (window as unknown as DebugWindow).__coditeGraph.data.nodes.filter((n: GNode) => n.id.includes('::fn::')).slice(0, 40).map((n: GNode) => n.id));
    const box = (await page.locator('.graph').boundingBox())!;
    let tried = 0;
    let pinned = 0;
    for (const id of ids) {
      const p = await page.evaluate((x) => (window as unknown as DebugWindow).__coditeGraph.screenOf(x), id);
      if (!p || p.x < 30 || p.y < 120 || p.x > box.width - 220 || p.y > box.height - 200) continue;
      const onCanvas = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName === 'CANVAS', [box.x + p.x, box.y + p.y]);
      if (!onCanvas) continue;
      await dragNode(page, id, 40, 30);
      await page.waitForTimeout(200);
      tried++;
      if ((await nodeState(page, id))?.fx != null) pinned++;
      if (tried === 5) break;
    }
    expect(tried).toBeGreaterThan(0);
    expect(pinned).toBe(tried);
  });

  test('collapsing a folder while folder nodes are shown leaves no links stuck to old nodes', async ({ page }) => {
    await load(page, synthetic(3, 3, 2));
    await page.locator('body').press('d'); // folder nodes on
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'View options' }).click();
    await page.getByLabel('Collapse pkg1').check();
    await page.getByLabel('Outline folder groups').check();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1500);
    const report = await page.evaluate(() => {
      const { nodes, links } = (window as unknown as DebugWindow).__coditeGraph.data;
      const byId = new Map(nodes.map((n: GNode) => [n.id, n]));
      const stale = links.filter((l: GLink) => [l.source, l.target].some((e: GEnd) => typeof e === 'object' && byId.get((e as GNode).id) !== e));
      const collapsed = nodes.find((n: GNode) => n.collapsedCount);
      return { stale: stale.length, collapsed: collapsed?.id, finite: nodes.every((n: GNode) => Number.isFinite(n.x) && Number.isFinite(n.y)) };
    });
    expect(report).toEqual({ stale: 0, collapsed: 'demo/pkg1', finite: true });
  });

  test('the project root is not offered as a folder to collapse', async ({ page }) => {
    await load(page, {
      nodes: [
        { id: 'flat/a.js', label: 'a.js', group: 'flat', language: 'javascript', val: 20 },
        { id: 'flat/b.js', label: 'b.js', group: 'flat', language: 'javascript', val: 20 },
      ],
      links: [{ source: 'flat/a.js', target: 'flat/b.js', type: 'imports_module' }],
    });
    await page.getByRole('button', { name: 'View options' }).click();
    await expect(page.getByRole('group', { name: 'Collapse folders' }).getByRole('checkbox')).toHaveCount(0);
  });
});
