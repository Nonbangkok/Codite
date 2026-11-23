import { expect, test } from '@playwright/test';
import { mockData, selectViaSearch } from './helpers';

test('phone layout: files live in a drawer and details open full screen', async ({ page }) => {
  await mockData(page);
  await page.goto('/');
  await expect(page.getByRole('region', { name: /Dependency graph/ })).toBeVisible();

  const sidebar = page.getByRole('navigation', { name: 'Files' });
  await expect(sidebar).not.toBeInViewport();
  await page.getByRole('button', { name: 'Show files' }).click();
  await expect(sidebar).toBeInViewport();
  await page.getByRole('treeitem', { name: 'demo' }).click();
  await page.getByRole('treeitem', { name: 'src' }).click();
  await page.getByRole('treeitem', { name: 'app.ts' }).click();
  await expect(sidebar).not.toBeInViewport();

  const panel = page.getByRole('complementary', { name: 'app.ts' });
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  const viewport = page.viewportSize()!;
  expect(Math.round(box!.width)).toBe(viewport.width);
  await page.screenshot({ path: 'test-results/mobile-panel.png' });
  await panel.getByRole('button', { name: 'Close details' }).click();

  await selectViaSearch(page, 'helper');
  await expect(page.getByRole('complementary', { name: 'helper' })).toBeVisible();
});

test('phone layout: chrome does not overflow the screen', async ({ page }) => {
  await mockData(page);
  await page.goto('/');
  await expect(page.locator('.toolbar')).toBeVisible();
  const width = page.viewportSize()!.width;
  for (const selector of ['.scanbar', '.legend']) {
    const box = await page.locator(selector).boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
  }
  await page.screenshot({ path: 'test-results/mobile-graph.png' });
});
