import { expect, test } from '@playwright/test';
import { splitFixture } from './helpers';

test('local data with a separate code file shows code, lines and search', async ({ page }) => {
  const { graph, code } = splitFixture();
  let codeRequests = 0;
  await page.route('**/data.json*', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(graph) }));
  await page.route('**/data.code.json*', async (r) => {
    codeRequests++;
    await new Promise((res) => setTimeout(res, 300));
    await r.fulfill({ contentType: 'application/json', body: JSON.stringify(code) });
  });
  await page.goto('/');
  await expect(page.getByRole('region', { name: /Dependency graph, 9 nodes/ })).toBeVisible();
  await page.locator('body').press('/');
  await page.getByRole('dialog').getByRole('combobox').fill('helper');
  await page.getByRole('dialog').getByRole('combobox').press('Enter');
  const panel = page.getByRole('complementary', { name: 'helper' });
  await expect(panel.locator('.cm-content')).toContainText('return add(x, 1);');
  await expect(panel.getByText('Line 3', { exact: true })).toBeVisible();
  await expect(panel.locator('.cm-gutterElement', { hasText: /^3$/ })).toBeVisible();
  expect(codeRequests).toBe(1);

  await page.locator('body').press('#');
  await page.getByRole('dialog').getByRole('combobox').pressSequentially('a + b');
  await expect(page.getByRole('dialog').getByRole('option').first()).toContainText('math.ts, line 2');
});

test('a remote scan fetches its code from the scan endpoint', async ({ page }) => {
  const { graph, code } = splitFixture();
  delete (graph as { code_file?: string }).code_file;
  await page.route('**/data.json*', (r) => r.fulfill({ status: 404, body: '' }));
  await page.route('**/api/scan', (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'success', repo: 'o/r', graph, codeUrl: '/api/scans/abc/code' }) }),
  );
  await page.route('**/api/scans/abc/code', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(code) }));
  await page.goto('/?repo=o/r');
  await expect(page.getByText('Showing')).toContainText('o/r');
  await page.locator('body').press('/');
  await page.getByRole('dialog').getByRole('combobox').fill('app.ts');
  await page.getByRole('dialog').getByRole('combobox').press('Enter');
  await expect(page.getByRole('complementary', { name: 'app.ts' }).locator('.cm-content')).toContainText('export function main()');
});
