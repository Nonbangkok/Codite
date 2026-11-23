import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const fixtureText = readFileSync(fileURLToPath(new URL('../fixtures/graph.json', import.meta.url)), 'utf8');

/** Serves the fixture as local data and (optionally) as the result of a remote scan. */
export const mockData = async (page: Page, opts: { local?: boolean; scan?: 'ok' | 'error' } = {}) => {
  await page.route('**/data.json*', (route) =>
    opts.local === false ? route.fulfill({ status: 404, body: 'missing' }) : route.fulfill({ contentType: 'application/json', body: fixtureText }),
  );
  await page.route('**/api/scan', async (route) => {
    if (opts.scan === 'error') {
      return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Repository not found. Make sure it exists and is public.' }) });
    }
    const { url } = route.request().postDataJSON() as { url: string };
    const repo = url.replace('https://github.com/', '');
    // Long enough for tests to observe the scanning state even under parallel load.
    await new Promise((r) => setTimeout(r, 1500));
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ status: 'success', repo, graph: JSON.parse(fixtureText) }),
    });
  });
};

/** Opens search with "/" and picks the first match for `query`. */
export const selectViaSearch = async (page: Page, query: string) => {
  await page.locator('body').press('/');
  await page.getByRole('dialog').getByRole('combobox').fill(query);
  await page.getByRole('dialog').getByRole('combobox').press('Enter');
};

/** The fixture in the analyzer's split format: no inline code, line ranges, and a code map. */
export const splitFixture = () => {
  const graph = JSON.parse(fixtureText);
  const files: Record<string, string> = {};
  for (const n of graph.nodes) if (!n.id.includes('::') && n.code) files[n.id] = n.code;
  for (const n of graph.nodes) {
    const file = files[n.id.split('::')[0]];
    if (n.id.includes('::') && n.code && file) {
      const start = file.slice(0, file.indexOf(n.code.split('\n')[0])).split('\n').length;
      n.start_line = start;
      n.end_line = start + n.code.split('\n').length - 1;
    }
    delete n.code;
  }
  graph.code_file = 'data.code.json';
  return { graph, code: files };
};
