import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { fixtureText, mockData } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
});

test('overview shows totals, checks and rankings, and opens nodes', async ({ page }) => {
  await mockData(page);
  await page.goto('/');
  await expect(page.getByRole('region', { name: /Dependency graph, 9 nodes/ })).toBeVisible();
  await page.locator('body').press('o');
  const dialog = page.getByRole('dialog', { name: 'Overview of demo' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.overview__totals')).toContainText('Files4');
  await expect(dialog.locator('.overview__totals')).toContainText('Symbols5');
  await expect(dialog.getByText('No problems found by the health checks.')).toBeVisible();
  await expect(dialog.locator('.check-item', { hasText: 'Import cycles' })).toContainText('None');
  const orphans = dialog.locator('.check-item', { hasText: 'Files nothing imports' });
  await orphans.locator('summary').click();
  await expect(orphans.getByRole('button', { name: 'native/core.rs' })).toBeVisible();

  const results = await new AxeBuilder({ page }).include('.overview').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);

  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export Markdown' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('demo-report.md');
  const md = Buffer.concat(await (await file.createReadStream()).toArray()).toString();
  expect(md).toContain('# Codite report: demo');

  await dialog.getByRole('region', { name: 'Largest files' }).getByRole('button', { name: /util\.ts/ }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'util.ts' })).toBeVisible();
});

test('an import cycle is reported and can be shown in the graph', async ({ page }) => {
  const graph = JSON.parse(fixtureText);
  graph.links.push({ source: 'demo/lib/math.ts', target: 'demo/src/util.ts', type: 'imports_module' });
  await page.route('**/data.json*', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(graph) }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Project overview' }).click();
  const dialog = page.getByRole('dialog', { name: /Overview of/ });
  await expect(dialog.getByText('1 check needs attention.')).toBeVisible();
  const cycles = dialog.locator('.check-item', { hasText: 'Import cycles' });
  await cycles.locator('summary').click();
  await cycles.getByRole('button', { name: 'math.ts → util.ts → math.ts' }).click();
  await expect(page.locator('.focus-banner', { hasText: 'selected' })).toContainText('2 selected');
  await expect(page.getByRole('region', { name: /Dependency graph, 2 nodes/ })).toBeVisible();
});
