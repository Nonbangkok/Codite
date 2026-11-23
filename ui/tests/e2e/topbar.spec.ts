// The toolbar kept growing and covered the Scan button at common widths; they now share a wrapping row.
import { test, expect } from '@playwright/test';
import { mockData } from './helpers';
for (const width of [1920, 1440, 1180, 1000, 860, 780]) {
  test(`scan bar and toolbar never overlap at ${width}px`, async ({ page }) => {
    await mockData(page);
    await page.setViewportSize({ width, height: 860 });
    await page.goto('/');
    await expect(page.locator('.toolbar')).toBeVisible();
    for (const state of ['closed', 'open']) {
      if (state === 'open') { await page.locator('body').press('/'); await page.getByRole('dialog').getByRole('combobox').fill('util.ts'); await page.getByRole('dialog').getByRole('combobox').press('Enter'); await page.waitForTimeout(500); }
      const scan = (await page.getByRole('button', { name: 'Scan', exact: true }).boundingBox())!;
      const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.textContent?.trim(), [scan.x + scan.width / 2, scan.y + scan.height / 2]);
      const tb = (await page.locator('.toolbar').boundingBox())!;
      const stage = (await page.locator('.stage').boundingBox())!;
      expect(hit, `Scan button covered at ${width}px (${state} panel)`).toBe('Scan');
      expect(tb.x + tb.width, 'toolbar inside the graph area').toBeLessThanOrEqual(stage.x + stage.width + 1);
    }
  });
}
