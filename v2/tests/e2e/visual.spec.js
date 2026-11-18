import { test, expect } from '@playwright/test';
import { App } from './helpers.js';

// Set SHOT_DIR to also write PNGs for eyeballing the design: SHOT_DIR=./shots npm run test:e2e -- visual
const shot = async (page, name) => {
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/${name}.png`, fullPage: true });
};

test.describe('visual theme', () => {
  test('light and dark dashboards render without layout errors', async ({ page }, info) => {
    const app = new App(page);
    await app.seedHousehold();
    await expect(page.locator('.hero')).toBeVisible();
    await shot(page, `${info.project.name}-dashboard-light`);

    await page.getByRole('button', { name: 'Toggle dark mode' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await shot(page, `${info.project.name}-dashboard-dark`);

    for (const route of ['entries', 'recurring', 'goals', 'settings']) {
      await app.go(route);
      await shot(page, `${info.project.name}-${route}-dark`);
    }

    await page.getByRole('button', { name: 'New entry' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await shot(page, `${info.project.name}-sheet-dark`);
    expect(app.errors).toEqual([]);
  });
});
