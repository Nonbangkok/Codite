import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mockData, selectViaSearch } from './helpers';

test.describe('local graph', () => {
  test.beforeEach(async ({ page }) => {
    await mockData(page);
    await page.goto('/');
    await expect(page.getByText('Showing')).toContainText('demo (local)');
  });

  test('renders the graph, legend and minimap', async ({ page }) => {
    await expect(page.getByRole('region', { name: /Dependency graph, 9 nodes/ })).toBeVisible();
    await expect(page.locator('.graph canvas').first()).toBeVisible();
    const legend = page.getByRole('region', { name: 'Kinds' });
    await expect(legend.getByRole('button', { name: /Files\s*4/ })).toBeVisible();
    await expect(legend.getByRole('button', { name: /Functions\s*3/ })).toBeVisible();
    await expect(page.locator('.minimap canvas')).toBeVisible();
  });

  test('search selects a node and the panel shows its connections and source', async ({ page }) => {
    await selectViaSearch(page, 'helper');
    const panel = page.getByRole('complementary', { name: 'helper' });
    await expect(panel).toBeVisible();
    await expect(panel.getByText('Line 3', { exact: true })).toBeVisible();
    await expect(panel.locator('.cm-content')).toContainText('return add(x, 1);');
    await panel.getByRole('tab', { name: /Connections/ }).click();
    await expect(panel.getByRole('heading', { name: /Defined in/ })).toBeVisible();
    await panel.getByRole('button', { name: 'util.ts File' }).click();
    await expect(page.getByRole('complementary', { name: 'util.ts' })).toBeVisible();
    await expect(page.getByRole('treeitem', { name: 'util.ts' })).toHaveAttribute('aria-selected', 'true');
  });

  test('finds a path between two nodes and clears it with Escape', async ({ page }) => {
    await selectViaSearch(page, 'main');
    await page.locator('body').press('p');
    await expect(page.getByRole('dialog', { name: 'Find a path from main' })).toBeVisible();
    await page.getByRole('dialog').getByRole('combobox').fill('add');
    await page.getByRole('dialog').getByRole('combobox').press('Enter');
    const steps = page.getByRole('heading', { name: /Path to add/ }).locator('xpath=..').getByRole('listitem');
    await expect(steps).toHaveCount(5);
    await expect(page.getByRole('heading', { name: /Path to add/ })).toContainText('4 steps');
    await page.locator('body').press('Escape');
    await expect(page.getByRole('heading', { name: /Path to add/ })).toHaveCount(0);
  });

  test('reports when two nodes are not connected', async ({ page }) => {
    await selectViaSearch(page, 'main');
    await page.locator('body').press('p');
    await page.getByRole('dialog').getByRole('combobox').fill('Engine');
    await page.getByRole('dialog').getByRole('combobox').press('Enter');
    await expect(page.getByRole('status').filter({ hasText: 'are not connected' })).toBeVisible();
  });

  test('focus mode limits the graph to the neighborhood', async ({ page }) => {
    await selectViaSearch(page, 'util.ts');
    await page.locator('body').press('x');
    await expect(page.locator('.focus-banner')).toContainText('within 1 step of util.ts');
    await expect(page.getByRole('region', { name: /Dependency graph, 5 nodes/ })).toBeVisible();
    await page.getByRole('button', { name: 'Show everything' }).click();
    await expect(page.getByRole('region', { name: /Dependency graph, 9 nodes/ })).toBeVisible();
  });

  test('legend hides a kind and the folder filter scopes the graph', async ({ page }) => {
    await page.getByRole('region', { name: 'Kinds' }).getByRole('button', { name: /Functions/ }).click();
    await expect(page.getByRole('region', { name: /Dependency graph, 6 nodes/ })).toBeVisible();
    await page.getByRole('button', { name: 'Show all' }).click();
    await page.getByRole('treeitem', { name: 'demo' }).click();
    await page.getByRole('treeitem', { name: 'src' }).click();
    await expect(page.getByText('Only src')).toBeVisible();
    await expect(page.getByRole('region', { name: /Dependency graph, 5 nodes/ })).toBeVisible();
  });

  test('keyboard shortcuts toggle theme and open the shortcut list', async ({ page }) => {
    await page.locator('body').press('t');
    const theme = await page.evaluate(() => document.documentElement.dataset.theme);
    await page.reload();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
    await page.locator('body').press('?');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('exports the visible graph as JSON', async ({ page }) => {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export graph' }).click();
    await page.getByRole('menuitem', { name: /Graph data/ }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('demo.json');
    const body = JSON.parse(await (await file.createReadStream()).toArray().then((c) => Buffer.concat(c).toString()));
    expect(body.nodes).toHaveLength(9);
    expect(body.nodes[0]).not.toHaveProperty('code');
  });

  test('the layout settles and is fitted inside the viewport', async ({ page }) => {
    // Wait for the simulation to settle and the automatic fit to run.
    await page.waitForTimeout(7000);
    await page.screenshot({ path: 'test-results/local-graph.png' });
  });

  for (const colorScheme of ['dark', 'light'] as const) {
    test(`has no accessibility violations (${colorScheme} theme)`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await page.reload();
      await selectViaSearch(page, 'main');
      await expect(page.getByRole('complementary', { name: 'main' })).toBeVisible();
      // Let the panel finish fading in so contrast is measured at full opacity.
      await expect(page.locator('.panel-slot')).toHaveCSS('opacity', '1');
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    });
  }
});

test.describe('remote scans', () => {
  test('scanning a repo loads it, updates the URL and links to GitHub', async ({ page }) => {
    await mockData(page, { local: false });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Map a repository' })).toBeVisible();
    await page.getByLabel('Public GitHub repository URL').fill('https://github.com/owner/demo');
    await page.getByRole('button', { name: 'Scan', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Scanning owner/demo' })).toBeVisible();
    await expect(page.getByText('Showing')).toContainText('owner/demo');
    await expect(page).toHaveURL(/\?repo=owner%2Fdemo/);
    await selectViaSearch(page, 'main');
    await expect(page.getByRole('link', { name: /Open on GitHub/ })).toHaveAttribute(
      'href',
      'https://github.com/owner/demo/blob/HEAD/src/app.ts#L3-L5',
    );
  });

  test('a shared ?repo= link scans automatically and is remembered', async ({ page }) => {
    await mockData(page);
    await page.goto('/?repo=owner/shared');
    await expect(page.getByText('Showing')).toContainText('owner/shared');
    const recent = await page.evaluate(() => localStorage.getItem('codite.recentScans'));
    expect(JSON.parse(recent!)).toContain('owner/shared');
  });

  test('scan errors are explained', async ({ page }) => {
    await mockData(page, { scan: 'error' });
    await page.goto('/');
    await page.getByLabel('Public GitHub repository URL').fill('github.com/nobody/missing');
    await page.getByRole('button', { name: 'Scan', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Repository not found');
  });
});
