import { test, expect } from '@playwright/test';
import { App } from './helpers.js';

const monthNumber = new Date().getMonth() + 1;

test.describe('two people, one household', () => {
  let app;
  test.beforeEach(async ({ page }) => {
    app = new App(page);
    await app.seedHousehold();
  });

  test('combined overview adds both incomes and all spending', async ({ page }) => {
    await expect(app.heroValue()).toHaveText('₹97,500.00');
    const stats = page.locator('.hero-stats');
    await expect(stats).toContainText('₹1,55,000');
    await expect(stats).toContainText('₹57,500');
    await app.expectClean();
  });

  test('the who-contributed table shows each person separately', async ({ page }) => {
    const rows = page.locator('.table tbody tr');
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: 'Shubham' })).toContainText('₹90,000.00');
    await expect(rows.filter({ hasText: 'Shubham' })).toContainText('₹52,700.00');
    await expect(rows.filter({ hasText: 'Priya' })).toContainText('₹65,000.00');
    await expect(rows.filter({ hasText: 'Priya' })).toContainText('₹4,800.00');
  });

  test('50/30/20 targets use combined income, with each bucket measured against it', async ({ page }) => {
    const bucket = (name) => page.locator(`.ring-card[data-bucket=${name}]`);
    await expect(bucket('needs')).toContainText('₹34,200.00 of ₹77,500.00');
    await expect(bucket('wants')).toContainText('₹8,300.00 of ₹46,500.00');
    await expect(bucket('savings')).toContainText('₹15,000.00 of ₹31,000.00');
    await expect(bucket('needs')).toContainText('On track');
    await expect(bucket('savings')).toContainText('Below target');
  });

  test('each person can be viewed on their own, then back to together', async ({ page }) => {
    const filter = page.locator('.toolbar .segmented');
    await filter.getByRole('button', { name: /Shubham/ }).click();
    await expect(app.heroValue()).toHaveText('₹37,300.00');
    await filter.getByRole('button', { name: /Priya/ }).click();
    await expect(app.heroValue()).toHaveText('₹60,200.00');
    await filter.getByRole('button', { name: /Together/ }).click();
    await expect(app.heroValue()).toHaveText('₹97,500.00');
  });

  test('entries show who entered them, and the filter applies to the list', async ({ page }) => {
    await app.go('entries');
    await expect(page.locator('.list-item')).toHaveCount(7);
    await expect(page.locator('.list-item', { hasText: 'Clothes' })).toContainText('Priya');
    await expect(page.locator('.list-item', { hasText: 'Rent' })).toContainText('Shubham');
    await page.locator('.toolbar .segmented').getByRole('button', { name: /Priya/ }).click();
    await expect(page.locator('.list-item')).toHaveCount(2);
  });

  test('either person can edit or delete the other\'s entry', async ({ page }) => {
    await app.go('entries');
    await page.getByRole('button', { name: 'Delete Housing' }).click();
    await expect(page.locator('.list-item', { hasText: 'Housing' })).toHaveCount(0);
    await app.go('dashboard');
    await expect(app.heroValue()).toHaveText('₹1,25,500.00');
  });

  test('the person filter is available on the overview and entries only', async ({ page }) => {
    await expect(page.locator('.toolbar .segmented')).toHaveCount(1);
    await app.go('goals');
    await expect(page.locator('.toolbar .segmented')).toHaveCount(0);
    await app.go('recurring');
    await expect(page.locator('.toolbar .segmented')).toHaveCount(0);
  });

  test('settings lists both household members', async ({ page }) => {
    await app.go('settings');
    const members = page.locator('.card', { hasText: 'member(s)' });
    await expect(members).toContainText('2 member(s)');
    await expect(members).toContainText('Shubham');
    await expect(members).toContainText('Priya');
  });

  test('recurring bills from either person count in the shared total', async ({ page }) => {
    await app.addRecurring({ name: 'Rent', amount: 20000, category: 'Housing' });
    await app.go('dashboard');
    await expect(app.heroValue()).toHaveText('₹77,500.00');
    await expect(page.locator('.ring-card[data-bucket=needs]')).toContainText('₹54,200.00 of ₹77,500.00');
    await expect(page.locator('.list-item', { hasText: 'Rent' })).toHaveCount(1);
    await page.locator('.toolbar .segmented').getByRole('button', { name: /Shubham/ }).click();
    await expect(page.locator('.list-item', { hasText: 'Rent' })).toHaveCount(0);
  });

  test('yearly bills: monthly-average vs cash-flow views', async ({ page }) => {
    await app.addRecurring({ name: 'Car insurance', amount: 24000, frequency: 'yearly', dueMonth: monthNumber, category: 'Insurance' });
    await app.go('dashboard');
    await expect(page.getByText('spread over 12 months')).toBeVisible();
    await expect(app.heroValue()).toHaveText('₹95,500.00');
    await page.getByRole('button', { name: 'Cash flow' }).click();
    await expect(page.getByText('appear when paid')).toBeVisible();
    await expect(app.heroValue()).toHaveText('₹73,500.00');
    await expect(page.locator('.list-item', { hasText: 'Car insurance' })).toContainText('₹24,000.00');
    await page.getByRole('button', { name: 'Monthly average' }).click();
    await expect(app.heroValue()).toHaveText('₹95,500.00');
  });
});
