import { expect, test, type Page } from '@playwright/test';
import { fixtureText, mockData } from './helpers';

// Deeply nested code with long lines, like the Rust parsers that motivated the reader.
const DEEP = [
  'fn parse(node: Node) {',
  '    for capture in matches {',
  '        match capture_name {',
  '            "func" => {',
  '                if let Some(parent) = node.parent() {',
  '                    if grandparent.kind() == "class_definition" && name != "__init__" && name.starts_with("__") && name.ends_with("__") {',
  '                        let id = format!("{}::method::{}::{}", full_path, name, start, extra_argument_that_is_long, another_one);',
  '                        helper(id);',
  '                    }',
  '                }',
  '            }',
  '            _ => {}',
  '        }',
  '    }',
  '}',
].join('\n');

const withDeepFile = (lines = DEEP) => {
  const graph = JSON.parse(fixtureText);
  graph.nodes.push({ id: 'demo/src/deep.rs', label: 'deep.rs', group: 'src', language: 'rust', val: 20, code: lines });
  graph.nodes.push({ id: 'demo/src/deep.rs::fn::parse::0', label: 'parse', group: 'functions', language: 'rust', val: 8, code: lines });
  graph.links.push({ source: 'demo/src/deep.rs', target: 'demo/src/deep.rs::fn::parse::0', type: 'contains' });
  return graph;
};

const serve = async (page: Page, graph: unknown) => {
  await page.route('**/data.json*', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(graph) }));
};

const open = async (page: Page, query: string) => {
  await page.locator('body').press('/');
  await page.getByRole('dialog').getByRole('combobox').fill(query);
  await page.getByRole('dialog').getByRole('combobox').press('Enter');
};

test.describe('code reader', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
  });

  test('wrapped lines continue under their own indentation, not at column 0', async ({ page }) => {
    await serve(page, withDeepFile());
    await page.goto('/');
    await open(page, 'deep.rs');
    const line = page.locator('.cm-line', { hasText: 'class_definition' });
    await expect(line).toBeVisible();
    const geometry = await line.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0);
      const tops = [...new Set(rects.map((r) => Math.round(r.top)))];
      // Left edge of the first non-space character vs. the leftmost text on later visual lines.
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let first: DOMRect | null = null;
      for (let n = walker.nextNode(); n && !first; n = walker.nextNode()) {
        const i = n.textContent!.search(/\S/);
        if (i >= 0) {
          const r = document.createRange();
          r.setStart(n, i);
          r.setEnd(n, i + 1);
          first = r.getBoundingClientRect();
        }
      }
      const continuation = rects.filter((r) => Math.round(r.top) > tops[0]);
      return { visualLines: tops.length, codeStart: first!.left, continuationLeft: Math.min(...continuation.map((r) => r.left)) };
    });
    expect(geometry.visualLines).toBeGreaterThan(1);
    expect(geometry.continuationLeft).toBeGreaterThanOrEqual(geometry.codeStart);
  });

  test('compact indentation halves the leading whitespace', async ({ page }) => {
    await serve(page, withDeepFile());
    await page.goto('/');
    await open(page, 'deep.rs');
    // CodeMirror re-creates decorated spans, so measure afresh each time.
    const width = () =>
      page.locator('.cm-line', { hasText: 'helper(id)' }).locator('.cm-indent').evaluate((el) => el.getBoundingClientRect().width);
    await expect.poll(width).toBeGreaterThan(0);
    const before = await width();
    await page.getByRole('button', { name: 'Compact indentation' }).click();
    await expect.poll(width).toBeLessThan(before * 0.6);
  });

  test('folds deep blocks, searches, and keeps enclosing scopes visible', async ({ page }) => {
    // Plenty of code inside the deepest block, so it is still on screen below the sticky headers.
    const filler = Array.from({ length: 40 }, (_, i) => `                        log(step_${i});`);
    const lines = DEEP.split('\n');
    lines.splice(8, 0, ...filler);
    await serve(page, withDeepFile(lines.join('\n')));
    await page.goto('/');
    await open(page, 'deep.rs');
    await expect(page.getByText('Nesting depth 6')).toBeVisible();

    await page.getByRole('combobox', { name: 'Fold code' }).selectOption('2');
    await expect(page.locator('.cm-foldPlaceholder')).toHaveCount(1);
    await expect(page.locator('.cm-line', { hasText: 'helper(id)' })).toHaveCount(0);
    await page.getByRole('combobox', { name: 'Fold code' }).selectOption('none');
    await expect(page.locator('.cm-line', { hasText: 'helper(id)' })).toHaveCount(1);

    await page.getByRole('searchbox', { name: 'Find in code' }).fill('name');
    await page.getByRole('searchbox', { name: 'Find in code' }).press('Enter');
    await expect(page.locator('.reader__count')).toHaveText(/^1 of \d+$/);
    await expect(page.locator('.cm-search-match').first()).toBeVisible();

    // Scroll so the deep line is at the top: its enclosing blocks appear above the code.
    await page.locator('.cm-scroller').evaluate((el) => {
      const line = [...el.querySelectorAll('.cm-line')].find((l) => l.textContent?.includes('helper(id)')) as HTMLElement;
      el.scrollTop += line.getBoundingClientRect().top - el.getBoundingClientRect().top;
    });
    const scopes = page.getByRole('navigation', { name: 'Enclosing blocks' });
    await expect(scopes).toContainText('if let Some(parent)');
    await expect(scopes).toContainText('match capture_name');
  });

  test('outline jumps to a symbol, highlights it and records the lines in the URL', async ({ page }) => {
    await mockData(page);
    await page.goto('/');
    await open(page, 'util.ts');
    await page.getByRole('button', { name: 'Outline' }).click();
    await page.getByRole('button', { name: /Store.*line 7/ }).click();
    await expect(page.locator('.cm-line-highlight')).toHaveCount(3);
    await expect(page).toHaveURL(/node=demo%2Fsrc%2Futil\.ts&L=7-9/);
    await expect(page.getByText('Lines 7–9 selected')).toBeVisible();
  });

  test('a shared link opens the node at the selected lines', async ({ page }) => {
    await mockData(page);
    await page.goto('/?node=demo/src/app.ts&L=3-5');
    await expect(page.getByRole('complementary', { name: 'app.ts' })).toBeVisible();
    await expect(page.locator('.cm-line-highlight')).toHaveCount(3);
  });

  test('clicking a known symbol name in code opens it', async ({ page }) => {
    await mockData(page);
    await page.goto('/');
    await open(page, 'app.ts');
    await page.locator('.cm-symbol-link', { hasText: 'helper' }).first().click();
    await expect(page.getByRole('complementary', { name: 'helper' })).toBeVisible();
  });

  test('View in file and the file breadcrumb open the file at the symbol', async ({ page }) => {
    await mockData(page);
    await page.goto('/');
    await open(page, 'helper');
    await page.getByRole('button', { name: 'View in file' }).click();
    await expect(page.getByRole('complementary', { name: 'util.ts' })).toBeVisible();
    await expect(page.locator('.cm-line-highlight')).toHaveCount(3);
  });

  test('panel sizes cycle with E and Escape leaves full screen', async ({ page }) => {
    await mockData(page);
    await page.goto('/');
    await open(page, 'app.ts');
    const slot = page.locator('.panel-slot');
    await page.locator('body').press('e');
    await expect.poll(async () => (await slot.boundingBox())!.width).toBeGreaterThanOrEqual(639);
    await page.locator('body').press('e');
    await expect.poll(async () => (await slot.boundingBox())!.width).toBe(1280);
    await page.locator('body').press('Escape');
    await expect(slot).toHaveAttribute('data-size', 'normal');
    await expect(page.getByRole('complementary', { name: 'app.ts' })).toBeVisible();
  });

  test('Cmd/Ctrl+F searches inside the open code', async ({ page }) => {
    await mockData(page);
    await page.goto('/');
    await open(page, 'app.ts');
    await page.locator('body').press('ControlOrMeta+f');
    await expect(page.getByRole('searchbox', { name: 'Find in code' })).toBeFocused();
  });

  test('the app never scrolls sideways after keyboard navigation', async ({ page }) => {
    await mockData(page);
    await page.goto('/');
    await page.getByRole('treeitem', { name: 'demo' }).focus();
    for (const key of ['ArrowRight', 'ArrowDown', 'ArrowRight', 'ArrowDown', 'ArrowDown', 'Enter']) await page.keyboard.press(key);
    await open(page, 'app.ts');
    const offsets = await page.evaluate(() => ({ app: document.querySelector('.app')!.scrollLeft, body: document.body.scrollLeft, nav: document.querySelector('.sidebar')!.getBoundingClientRect().left }));
    expect(offsets).toEqual({ app: 0, body: 0, nav: 0 });
  });

  test('a 5,000-line file opens fast and renders only visible lines', async ({ page }) => {
    const big = Array.from({ length: 5000 }, (_, i) => `${'    '.repeat(i % 6)}let value_${i} = compute(${i}, "some string literal", another_argument);`).join('\n');
    await serve(page, withDeepFile(big));
    await page.goto('/');
    await page.locator('body').press('/');
    await page.getByRole('dialog').getByRole('combobox').fill('deep.rs');
    const start = Date.now();
    await page.getByRole('dialog').getByRole('combobox').press('Enter');
    await expect(page.locator('.cm-line').first()).toBeVisible();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1500);
    expect(await page.locator('.cm-line').count()).toBeLessThan(300);
    await page.getByRole('searchbox', { name: 'Find in code' }).fill('value_4999');
    await page.getByRole('searchbox', { name: 'Find in code' }).press('Enter');
    await expect(page.locator('.cm-line', { hasText: 'value_4999 ' })).toBeVisible();
    test.info().annotations.push({ type: 'open-ms', description: String(elapsed) });
  });
});

test('G opens go-to-line and jumps to the line', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await mockData(page);
  await page.goto('/');
  await open(page, 'util.ts');
  await page.locator('body').press('g');
  const box = page.getByRole('searchbox', { name: 'Find in code' });
  await expect(box).toBeFocused();
  await expect(box).toHaveValue(':');
  await box.pressSequentially('8');
  await box.press('Enter');
  await expect(page.locator('.cm-line-highlight')).toHaveCount(1);
  await expect(page).toHaveURL(/L=8$/);
});
