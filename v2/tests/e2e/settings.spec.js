import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { App } from './helpers.js';

test.describe('settings', () => {
  let app;
  test.beforeEach(async ({ page }) => {
    app = new App(page);
    await app.open();
    await app.signIn('Shubham');
  });

  test('changing the plan to 60/20/20 changes the targets on the overview', async ({ page }) => {
    await app.addEntry({ kind: 'income', amount: 100000, category: 'Salary' });
    await app.go('settings');
    await page.getByLabel('Needs %').fill('60');
    await page.getByLabel('Wants %').fill('20');
    await expect(page.getByText('Total 100%')).toBeVisible();
    await page.getByRole('button', { name: 'Save plan' }).click();
    await expect(page.getByRole('status')).toContainText('Budget plan saved');
    await app.go('dashboard');
    await expect(page.getByText('Your split: 60 / 20 / 20')).toBeVisible();
    await expect(page.locator('.ring-card[data-bucket=needs]')).toContainText('of ₹60,000.00');
    await expect(page.locator('.ring-card[data-bucket=wants]')).toContainText('of ₹20,000.00');
  });

  test('the live total warns when the plan does not add up, and saving is refused', async ({ page }) => {
    await app.go('settings');
    await page.getByLabel('Needs %').fill('70');
    await expect(page.getByText('Total 120%')).toBeVisible();
    await page.getByRole('button', { name: 'Save plan' }).click();
    await expect(page.getByRole('status')).toContainText('add up to 100');
    await app.go('dashboard');
    await expect(page.getByText('Your split: 50 / 30 / 20')).toBeVisible();
  });

  test('dark mode applies instantly and is remembered after a reload', async ({ page }) => {
    const bodyBg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: 'Toggle dark mode' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await app.settleAnimations();
    const darkBg = await bodyBg();
    expect(darkBg).toBe('rgb(11, 16, 32)');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await app.settleAnimations();
    expect(await bodyBg()).toBe(darkBg);
    await app.go('settings');
    await page.getByRole('button', { name: 'Light', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await app.settleAnimations();
    expect(await bodyBg()).toBe('rgb(245, 246, 251)');
  });

  test('the saved theme is applied before the app script runs (no flash of the wrong theme)', async ({ browser }) => {
    const context = await browser.newContext();
    await context.addInitScript(() => { localStorage.setItem('sf2_theme', 'dark'); localStorage.setItem('sf2_mode', 'local'); });
    const page = await context.newPage();
    await page.route('**/src/main.js', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });
    await page.goto('/v2/', { waitUntil: 'commit' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark', { timeout: 1000 });
    await expect(page.locator('meta[name=theme-color]')).toHaveAttribute('content', '#0b1020');
    await context.close();
  });

  test('follows the operating system dark preference until a choice is made', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'dark' });
    const page = await context.newPage();
    const darkApp = new App(page);
    await darkApp.open();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await context.close();
  });

  test('export downloads a JSON backup containing your entries', async ({ page }) => {
    await app.addEntry({ kind: 'income', amount: 1234, category: 'Salary' });
    await app.go('settings');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export backup' }).click()]);
    expect(download.suggestedFilename()).toMatch(/^smartfinance-\d{4}-\d{2}-\d{2}\.json$/);
    const data = JSON.parse(readFileSync(await download.path(), 'utf8'));
    expect(data.transactions).toHaveLength(1);
    expect(data.transactions[0].amount_paise).toBe(123400);
    expect(data.split).toEqual({ needs: 50, wants: 30, savings: 20 });
    expect(data.members[0].display_name).toBe('Shubham');
  });

  test('import brings in data saved by the original app', async ({ page }) => {
    await page.evaluate(() => new Promise((resolve, reject) => {
      const open = indexedDB.open('SmartFinanceDB_v1', 2);
      open.onupgradeneeded = () => open.result.createObjectStore('months', { keyPath: 'id' });
      open.onsuccess = () => {
        const tx = open.result.transaction('months', 'readwrite');
        tx.objectStore('months').put({
          id: '2026-01', income: { base: 50000, extras: [{ label: 'Bonus', amount: 1000 }] },
          daily: [{ amount: 120.5, category: 'Food & Dining', note: 'Tea', date: '2026-01-02', ts: 1 }],
          recurringMonthly: [{ name: 'Old rent', amount: 12000, ts: 11 }], recurringYearly: [{ name: 'Old insurance', amount: 9000, month: 4, ts: 12 }],
        });
        tx.oncomplete = () => { open.result.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    }));
    await app.go('settings');
    await page.getByRole('button', { name: 'Import from original app' }).click();
    await expect(page.getByRole('status')).toContainText('Imported 5 items');
    await app.go('recurring');
    await expect(page.locator('.list-item', { hasText: 'Old rent' })).toContainText('₹12,000.00 / month');
    await expect(page.locator('.list-item', { hasText: 'Old insurance' })).toContainText('every April');
  });

  test('import with nothing to import says so', async ({ page }) => {
    await app.go('settings');
    await page.getByRole('button', { name: 'Import from original app' }).click();
    await expect(page.getByRole('status')).toContainText('No data from the original app');
  });
});
