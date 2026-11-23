import { expect, test, type Page } from '@playwright/test';
import { mockData } from './helpers';

const open = async (page: Page, query: string) => {
  await page.locator('body').press('/');
  await page.getByRole('dialog').getByRole('combobox').fill(query);
  await page.getByRole('dialog').getByRole('combobox').press('Enter');
};
const panel = (page: Page, name: string) => page.getByRole('complementary', { name });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 880 });
  await mockData(page);
  await page.goto('/');
  await expect(page.getByText('Showing')).toContainText('demo (local)');
});

test('back and forward move through visited nodes', async ({ page }) => {
  await open(page, 'app.ts');
  await open(page, 'util.ts');
  await open(page, 'helper');
  await page.locator('body').press('Alt+ArrowLeft');
  await expect(panel(page, 'util.ts')).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(panel(page, 'app.ts')).toBeVisible();
  await page.locator('body').press('Alt+ArrowRight');
  await expect(panel(page, 'util.ts')).toBeVisible();
  // Recently opened nodes are offered when search is empty.
  await page.locator('body').press('/');
  await expect(page.getByText('Recently opened')).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('option').first()).toContainText(/helper|app\.ts/);
  await page.keyboard.press('Escape');
});

test('tabs: the preview tab is replaced, pinned tabs stay, closing activates a neighbor', async ({ page }) => {
  const tabs = page.getByRole('list', { name: 'Open nodes' }).getByRole('listitem');
  await open(page, 'app.ts');
  await open(page, 'util.ts');
  await expect(tabs).toHaveCount(1);
  await page.getByRole('button', { name: 'Keep util.ts open' }).click();
  await open(page, 'math.ts');
  await expect(tabs).toHaveCount(2);
  await page.getByRole('button', { name: 'Close math.ts' }).click();
  await expect(tabs).toHaveCount(1);
  await expect(panel(page, 'util.ts')).toBeVisible();
});

test('compare shows two readers side by side and can swap them', async ({ page }) => {
  await open(page, 'app.ts');
  await panel(page, 'app.ts').getByRole('button', { name: 'Compare' }).click();
  await expect(page.getByRole('dialog', { name: 'Compare app.ts with' })).toBeVisible();
  await page.getByRole('dialog').getByRole('combobox').fill('math.ts');
  await page.getByRole('dialog').getByRole('combobox').press('Enter');
  const compare = page.getByRole('region', { name: 'math.ts' });
  await expect(compare).toBeVisible();
  await expect(compare.locator('.cm-content')).toContainText('return a + b;');
  await expect(page.locator('.panel-slot')).toHaveAttribute('data-size', 'wide');
  await compare.getByRole('button', { name: 'Make this the main node' }).click();
  await expect(panel(page, 'math.ts')).toBeVisible();
  await expect(page.getByRole('region', { name: 'app.ts' })).toBeVisible();
  await page.getByRole('button', { name: 'Close comparison' }).click();
  await expect(page.locator('.compare')).toHaveCount(0);
});

test('bookmarks and notes persist and appear in the sidebar', async ({ page }) => {
  await open(page, 'helper');
  await panel(page, 'helper').getByRole('button', { name: 'Bookmark this node' }).click();
  await panel(page, 'helper').getByRole('tab', { name: 'Details' }).click();
  await page.getByLabel('Notes').fill('Adds one. Check overflow.');
  await page.getByLabel('Notes').blur();
  await page.reload();
  const bookmarks = page.locator('details.bookmarks');
  await expect(bookmarks).toContainText('Bookmarks and notes (1)');
  await bookmarks.getByRole('button', { name: /helper/ }).click();
  await expect(panel(page, 'helper').getByRole('button', { name: 'Remove bookmark' })).toBeVisible();
  await panel(page, 'helper').getByRole('tab', { name: 'Details' }).click();
  await expect(page.getByLabel('Notes')).toHaveValue('Adds one. Check overflow.');

  // Export includes the note.
  const download = page.waitForEvent('download');
  await page.locator('body').press('>');
  await page.getByRole('dialog').getByRole('combobox').pressSequentially('export bookmarks');
  await page.getByRole('dialog').getByRole('combobox').press('Enter');
  const file = await download;
  const body = JSON.parse(Buffer.concat(await (await file.createReadStream()).toArray()).toString());
  expect(Object.values(body.notes)).toEqual([expect.objectContaining({ bookmarked: true, note: 'Adds one. Check overflow.' })]);
});

test('commands run from the palette with ">"', async ({ page }) => {
  const before = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.locator('body').press('>');
  await expect(page.getByRole('dialog').getByRole('combobox')).toHaveValue('>');
  await page.getByRole('dialog').getByRole('combobox').pressSequentially('theme');
  await expect(page.getByRole('dialog').getByRole('option').first()).toContainText(/Switch to (light|dark) theme/);
  await page.getByRole('dialog').getByRole('combobox').press('Enter');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).not.toBe(before);
  await page.keyboard.press('ControlOrMeta+Shift+k');
  await expect(page.getByRole('dialog').getByRole('combobox')).toHaveValue('>');
});

test('"#" searches inside code and opens the file at the matching line', async ({ page }) => {
  await page.locator('body').press('#');
  await page.getByRole('dialog').getByRole('combobox').pressSequentially('add(x');
  const hit = page.getByRole('dialog').getByRole('option').first();
  await expect(hit).toContainText('return add(x, 1);');
  await expect(hit).toContainText('util.ts, line 4');
  await page.getByRole('dialog').getByRole('combobox').press('Enter');
  await expect(panel(page, 'util.ts')).toBeVisible();
  await expect(page.locator('.cm-line-highlight')).toHaveCount(1);
  await expect(page).toHaveURL(/L=4$/);
});

test('the sidebar collapses with B and can be resized', async ({ page }) => {
  const sidebar = page.getByRole('navigation', { name: 'Files' });
  await page.locator('body').press('b');
  await expect(sidebar).toBeHidden();
  await page.getByRole('button', { name: 'Show files' }).click();
  await expect(sidebar).toBeVisible();
  const handle = page.getByRole('separator', { name: 'Resize sidebar' });
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + 3, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(380, box.y + 220, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await sidebar.boundingBox())!.width)).toBe(380);
  await page.reload();
  await expect.poll(async () => Math.round((await sidebar.boundingBox())!.width)).toBe(380);
});
