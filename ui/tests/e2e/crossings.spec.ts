import { expect, test, type Page } from '@playwright/test';

// Edge crossings in each layout: the force layout is untangled after it settles, and the
// structure view draws the folder → file → symbol tree without any crossings.

type P = { id: string; x: number; y: number };
type End = string | P;
type DebugWindow = {
  __coditeGraph: {
    data: { nodes: P[]; links: { source: End; target: End }[] };
    layout: string;
    untangle: { before: number; after: number } | null;
  };
};

/** A seeded, code-like graph: files in folders, functions in files, imports and calls. */
const synthetic = (seed = 7) => {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const nodes: { id: string; label: string; group: string; language: string; val: number }[] = [];
  const links: { source: string; target: string; type: string }[] = [];
  const files: string[] = [];
  const fns: string[] = [];
  for (let f = 0; f < 4; f++)
    for (let i = 0; i < 6; i++) {
      const file = `demo/pkg${f}/file${i}.ts`;
      files.push(file);
      nodes.push({ id: file, label: `file${i}.ts`, group: `pkg${f}`, language: 'typescript', val: 20 });
      for (let k = 0; k < 4; k++) {
        const fn = `${file}::fn::f${k}::${k * 10}`;
        fns.push(fn);
        nodes.push({ id: fn, label: `f${f}_${i}_${k}()`, group: 'functions', language: 'typescript', val: 8 });
        links.push({ source: file, target: fn, type: 'contains' });
      }
    }
  for (const file of files) links.push({ source: file, target: files[Math.floor(rnd() * files.length)], type: 'imports_module' });
  for (const fn of fns) links.push({ source: fn, target: fns[Math.floor(rnd() * fns.length)], type: 'calls' });
  return { nodes, links: links.filter((l) => l.source !== l.target) };
};

const load = async (page: Page) => {
  await page.route('**/data.json*', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(synthetic()) }));
  await page.setViewportSize({ width: 1400, height: 880 });
  await page.goto('/');
  await page.locator('.graph canvas').first().waitFor();
};

/** Crossings between the drawn links, counted in the page (shared endpoints do not count). */
const crossings = (page: Page) =>
  page.evaluate(() => {
    const segs = (window as unknown as DebugWindow).__coditeGraph.data.links
      .map((l) => [l.source, l.target])
      .filter((e): e is [P, P] => typeof e[0] === 'object' && typeof e[1] === 'object');
    const o = (a: P, b: P, c: P) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const opposite = (u: number, v: number) => (u > 0 && v < 0) || (u < 0 && v > 0);
    let n = 0;
    for (let i = 0; i < segs.length; i++)
      for (let j = i + 1; j < segs.length; j++) {
        const [a, b] = segs[i];
        const [c, d] = segs[j];
        if (a === c || a === d || b === c || b === d) continue;
        if (opposite(o(c, d, a), o(c, d, b)) && opposite(o(a, b, c), o(a, b, d))) n++;
      }
    return { edges: segs.length, crossings: n };
  });

const untangleStats = (page: Page) => page.evaluate(() => (window as unknown as DebugWindow).__coditeGraph.untangle);

test.describe('edge crossings', () => {
  test.setTimeout(60_000);

  test('the force layout is untangled once it settles', async ({ page }) => {
    await load(page);
    await expect.poll(() => untangleStats(page), { timeout: 20_000 }).not.toBeNull();
    const stats = (await untangleStats(page))!;
    expect(stats.after).toBeLessThan(stats.before);
    // Let the glide to the untangled positions finish, then count what is actually drawn.
    await page.waitForTimeout(800);
    expect((await crossings(page)).crossings).toBeLessThanOrEqual(stats.after);
  });

  test('untangling can be turned off', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('codite.untangle', 'false'));
    await load(page);
    await page.waitForTimeout(6000);
    expect(await untangleStats(page)).toBeNull();
    await page.getByRole('button', { name: 'View options' }).click();
    await expect(page.getByLabel('Untangle crossing lines after layout')).not.toBeChecked();
  });

  test('the structure view has no crossings', async ({ page }) => {
    await load(page);
    await page.getByRole('button', { name: 'View options' }).click();
    await page.getByRole('button', { name: 'Structure' }).click();
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => (window as unknown as DebugWindow).__coditeGraph.layout)).toBe('structure');
    await page.waitForTimeout(1000);
    const drawn = await crossings(page);
    expect(drawn.edges).toBeGreaterThan(100);
    expect(drawn.crossings).toBe(0);
  });
});
