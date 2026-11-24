import { expect, test, type Page } from '@playwright/test';
import { mockData } from './helpers';

const graph = (page: Page, nodes: number, links?: number) =>
  page.getByRole('region', { name: new RegExp(`Dependency graph, ${nodes} nodes${links !== undefined ? ` and ${links} connections` : ''}`) });
const openView = async (page: Page) => {
  await page.getByRole('button', { name: 'View options' }).click();
  return page.getByRole('dialog', { name: 'View options' });
};

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 880 });
  await mockData(page);
  await page.goto('/');
  await expect(graph(page, 9, 7)).toBeVisible();
});

test('tree layout places nodes on dependency levels', async ({ page }) => {
  const view = await openView(page);
  await view.getByRole('button', { name: 'Tree' }).click();
  await expect(view.getByRole('button', { name: 'Tree' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(2500);
  await (await openView(page)).getByRole('button', { name: 'Save layout' }).click();
  const positions = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('codite.layout.'))!;
    return JSON.parse(localStorage.getItem(key)!).positions as Record<string, [number, number]>;
  });
  expect(Object.keys(positions)).toHaveLength(9);
  // Files sit on a few dependency levels, not 9 scattered rows ...
  const files = Object.keys(positions).filter((id) => !id.includes('::'));
  expect(new Set(files.map((id) => Math.round(positions[id][1] / 10))).size).toBeLessThanOrEqual(3);
  // ... and each symbol sits in a block just below its file.
  for (const id of Object.keys(positions).filter((x) => x.includes('::'))) {
    const dy = positions[id][1] - positions[id.split('::')[0]][1];
    expect(dy).toBeGreaterThan(0);
    expect(dy).toBeLessThan(100);
  }
  // L cycles to the radial layout.
  await page.keyboard.press('Escape');
  await page.locator('body').press('l');
  await expect((await openView(page)).getByRole('button', { name: 'Radial' })).toHaveAttribute('aria-pressed', 'true');
});

test('collapsing a folder replaces its contents with one node', async ({ page }) => {
  const view = await openView(page);
  await view.getByLabel('Collapse src').check();
  await expect(graph(page, 5)).toBeVisible();
  await view.getByRole('button', { name: 'Expand all folders' }).click();
  await expect(graph(page, 9)).toBeVisible();
});

test('connection types can be hidden', async ({ page }) => {
  const view = await openView(page);
  await view.getByLabel(/Contains/).uncheck();
  await expect(graph(page, 9, 2)).toBeVisible();
  await view.getByLabel(/Contains/).check();
  await expect(graph(page, 9, 7)).toBeVisible();
});

test('heat colors show a gradient legend', async ({ page }) => {
  await page.getByRole('button', { name: 'Heat', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Heat: complexity' })).toBeVisible();
  const view = await openView(page);
  await view.getByLabel('Heat color metric').selectOption('lines');
  await expect(page.getByRole('heading', { name: 'Heat: lines of code' })).toBeVisible();
  await view.getByLabel('Node size').selectOption('connections');
  await expect(view.getByLabel('Node size')).toHaveValue('connections');
});

test('highlight counts matching nodes', async ({ page }) => {
  // Matches names and paths: 3 .ts files plus the 4 symbols inside them.
  await page.getByLabel('Highlight nodes by name').fill('.ts');
  await expect(page.locator('.toolbar__count')).toHaveText('7');
  await page.getByLabel('Highlight nodes by name').fill('helper');
  await expect(page.locator('.toolbar__count')).toHaveText('1');
  await page.getByRole('button', { name: 'Clear highlight' }).click();
  await expect(page.locator('.toolbar__count')).toHaveCount(0);
});

test('lasso selects nodes; the selection can be isolated and cleared', async ({ page }) => {
  await page.getByRole('button', { name: 'Select an area' }).click();
  const box = (await page.locator('.lasso').boundingBox())!;
  await page.mouse.move(box.x + 5, box.y + 5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 5, box.y + box.height - 5, { steps: 8 });
  await page.mouse.up();
  const banner = page.locator('.focus-banner', { hasText: 'selected' });
  await expect(banner).toContainText('9 selected');
  await banner.getByRole('button', { name: 'Show only these' }).click();
  await expect(graph(page, 9)).toBeVisible();
  await banner.getByRole('button', { name: 'Clear' }).click();
  await expect(banner).toHaveCount(0);
});

test('impact analysis lists what depends on a node', async ({ page }) => {
  await page.locator('body').press('/');
  await page.getByRole('dialog').getByRole('combobox').fill('add');
  await page.getByRole('dialog').getByRole('combobox').press('Enter');
  await page.locator('body').press('i');
  const banner = page.locator('.focus-banner', { hasText: 'depend on' });
  await expect(banner).toContainText('3 nodes depend on add, across 3 files');
  await banner.getByRole('button', { name: 'Show only these' }).click();
  await expect(graph(page, 4)).toBeVisible();
  await page.getByRole('complementary', { name: 'add' }).getByRole('button', { name: 'Impact' }).click();
  await expect(banner).toHaveCount(0);
});

test('layout can be saved and reset', async ({ page }) => {
  const view = await openView(page);
  await view.getByRole('button', { name: 'Save layout' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Layout saved' })).toBeVisible();
  const saved = () => page.evaluate(() => Object.entries(localStorage).find(([k]) => k.startsWith('codite.layout.'))?.[1]);
  expect(JSON.parse((await saved())!).positions).toHaveProperty(['demo/src/app.ts']);
  await view.getByRole('button', { name: 'Reset' }).click();
  expect(JSON.parse((await saved())!)).toEqual({ pinned: {}, positions: {} });
});
