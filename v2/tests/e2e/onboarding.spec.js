import { test, expect } from '@playwright/test';
import { App } from './helpers.js';

test.describe('first run', () => {
  test('shows the name screen, then an empty overview', async ({ page }) => {
    const app = new App(page);
    await app.open();
    await expect(page.getByRole('heading', { name: 'Who is using the app?' })).toBeVisible();
    await app.signIn('Shubham');
    await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();
    await expect(page.getByText('Nothing here yet')).toBeVisible();
    await expect(app.heroValue()).toHaveText('₹0.00');
    await app.expectClean();
  });

  test('the sign-in screen text is readable on its purple background (light and dark)', async ({ page }) => {
    const app = new App(page);
    await app.open();
    for (const theme of ['light', 'dark']) {
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      await app.settleAnimations();
      const result = await page.evaluate(() => {
        const parse = (c) => c.match(/[\d.]+/g).map(Number);
        const lum = ([r, g, b]) => [r, g, b].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
        const stops = (getComputedStyle(document.documentElement).getPropertyValue('--hero').match(/#[0-9a-f]{6}/gi) || [])
          .map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
        const ratios = {};
        for (const sel of ['.auth-title', '.auth-brand .hint']) {
          const el = document.querySelector(sel);
          const [r, g, b, a = 1] = parse(getComputedStyle(el).color);
          const opacity = Number(getComputedStyle(el).opacity);
          ratios[sel] = Math.min(...stops.map((bg) => {
            const mix = [r, g, b].map((c, i) => c * a * opacity + bg[i] * (1 - a * opacity));
            const [hi, lo] = [lum(mix), lum(bg)].sort((x, y) => y - x);
            return (hi + 0.05) / (lo + 0.05);
          }));
        }
        return { stops: stops.length, ratios };
      });
      expect(result.stops, theme).toBeGreaterThanOrEqual(2);
      for (const [selector, ratio] of Object.entries(result.ratios)) {
        expect(ratio, `${theme}: ${selector} contrast`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  test('an empty name cannot be submitted', async ({ page }) => {
    const app = new App(page);
    await app.open();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Who is using the app?' })).toBeVisible();
    await expect(page.locator('.topbar')).toHaveCount(0);
  });

  test('stays signed in after a reload and remembers the data', async ({ page }) => {
    const app = new App(page);
    await app.open();
    await app.signIn('Shubham');
    await app.addEntry({ kind: 'income', amount: 1000, category: 'Salary' });
    await page.reload();
    await expect(page.locator('.topbar')).toBeVisible();
    await expect(app.heroValue()).toHaveText('₹1,000.00');
  });

  test('signing out and back in as the same person finds the same data', async ({ page }) => {
    const app = new App(page);
    await app.open();
    await app.signIn('Shubham');
    await app.addEntry({ kind: 'income', amount: 2500, category: 'Salary' });
    await app.signOut();
    await app.signIn('  shubham ');
    await app.go('dashboard');
    await expect(app.heroValue()).toHaveText('₹2,500.00');
  });

  test('every screen is reachable by URL hash and an unknown hash falls back to Overview', async ({ page }) => {
    const app = new App(page);
    await app.open();
    await app.signIn('Shubham');
    for (const [route, title] of [['entries', 'Income & expenses'], ['recurring', 'Recurring'], ['goals', 'Goals'], ['settings', 'Settings']]) {
      await app.go(route);
      await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
    }
    await page.goto('/v2/#/not-a-page');
    await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();
    await app.expectClean();
  });
});
