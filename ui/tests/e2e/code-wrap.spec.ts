import { expect, test } from '@playwright/test';
import { fixtureText } from './helpers';

// Regression: with line numbers + wrapping, the highlighter made each line a flex row, so every
// token shrank into its own column and long identifiers broke apart ("Forc / eGra / phRef").
const LONG = 'type ForceGraphRef = ForceGraphMethods<NodeObject<NodeData>, LinkObject<NodeData, LinkData>>;';

test('long source lines wrap as text instead of splitting tokens into columns', async ({ page }) => {
  const graph = JSON.parse(fixtureText);
  const file = graph.nodes.find((n: { id: string }) => n.id === 'demo/src/util.ts');
  file.code = `${file.code}\n${LONG}\n`;
  graph.nodes.push({ id: 'demo/src/util.ts::type::ForceGraphRef', label: 'ForceGraphRef', group: 'types', language: 'typescript', val: 8, code: LONG });
  graph.links.push({ source: 'demo/src/util.ts', target: 'demo/src/util.ts::type::ForceGraphRef', type: 'contains' });
  await page.route('**/data.json*', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(graph) }));

  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto('/');
  await page.locator('body').press('/');
  await page.getByRole('dialog').getByRole('combobox').fill('ForceGraphRef');
  await page.getByRole('dialog').getByRole('combobox').press('Enter');

  const panel = page.getByRole('complementary', { name: 'ForceGraphRef' });
  await expect(panel.getByText('Line 11')).toBeVisible();
  await expect(page.locator('.panel-slot')).toHaveCSS('opacity', '1');

  const code = panel.locator('.code-block code');
  const line = code.locator(':scope > span').first();
  await expect(line).toHaveCSS('display', 'block');

  // The identifier must stay on one visual line, and the whole statement should wrap into a few lines.
  const identifier = code.locator('span', { hasText: /^ForceGraphRef$/ }).first();
  expect(await identifier.evaluate((el) => el.getClientRects().length)).toBe(1);
  const lineHeight = await line.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
  const height = (await line.boundingBox())!.height;
  expect(height / lineHeight).toBeLessThanOrEqual(3);
  await panel.screenshot({ path: 'test-results/code-wrap.png' });
});
