import { test, expect } from '@playwright/test';
import { App } from './helpers.js';

const row = (page, text) => page.locator('.list-item', { hasText: text });

test.describe('income and expenses', () => {
  let app;
  test.beforeEach(async ({ page }) => {
    app = new App(page);
    await app.open();
    await app.signIn('Shubham');
  });

  test('adding income and an expense updates the overview and the list', async ({ page }) => {
    await app.addEntry({ kind: 'income', amount: 80000, category: 'Salary' });
    await app.addEntry({ amount: 25000, category: 'Housing', note: 'Rent' });
    await expect(app.heroValue()).toHaveText('₹55,000.00');
    await app.go('entries');
    await expect(row(page, 'Housing')).toContainText('−₹25,000.00');
    await expect(row(page, 'Salary')).toContainText('+₹80,000.00');
    await expect(page.locator('.card-sub').first()).toContainText('2 this month · in ₹80,000.00 · out ₹25,000.00');
    await app.expectClean();
  });

  test('amounts accept commas and decimals', async () => {
    await app.addEntry({ kind: 'income', amount: '1,25,000.50', category: 'Salary' });
    await expect(app.heroValue()).toHaveText('₹1,25,000.50');
  });

  test('an invalid amount shows an error and keeps the form open', async ({ page }) => {
    await page.getByRole('button', { name: 'New entry' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Amount (₹)').fill('abc');
    await dialog.getByLabel('Category').fill('Groceries');
    await dialog.getByRole('button', { name: /Add entry/ }).click();
    await expect(page.getByRole('status')).toContainText('Enter a valid amount');
    await expect(dialog).toBeVisible();
  });

  test('a zero amount is rejected by validation', async ({ page }) => {
    await page.getByRole('button', { name: 'New entry' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Amount (₹)').fill('0');
    await dialog.getByLabel('Category').fill('Groceries');
    await dialog.getByRole('button', { name: /Add entry/ }).click();
    await expect(page.getByRole('status')).toContainText('greater than zero');
    await expect(dialog).toBeVisible();
  });

  test('typing a known category picks its plan bucket; income hides the bucket', async ({ page }) => {
    await page.getByRole('button', { name: 'New entry' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Category').fill('Dining Out');
    await expect(dialog.getByLabel('Plan bucket')).toHaveValue('wants');
    await dialog.getByRole('button', { name: 'Income', exact: true }).click();
    await expect(dialog.getByLabel('Plan bucket')).toBeHidden();
  });

  test('double-clicking Add entry saves it once, not twice', async ({ page }) => {
    await page.getByRole('button', { name: 'New entry' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Amount (₹)').fill('250');
    await dialog.getByLabel('Category').fill('Groceries');
    await dialog.getByRole('button', { name: /Add entry/ }).dblclick();
    await expect(dialog).toBeHidden();
    await app.go('entries');
    await expect(page.locator('.list-item')).toHaveCount(1);
    await expect(app.heroValue().or(page.locator('.card-sub').first())).toBeVisible();
  });

  test('pressing Enter repeatedly in the amount field saves it once', async ({ page }) => {
    await page.getByRole('button', { name: 'New entry' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Category').fill('Groceries');
    const amount = dialog.getByLabel('Amount (₹)');
    await amount.fill('99');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await app.go('entries');
    await expect(page.locator('.list-item')).toHaveCount(1);
  });

  test('Escape and the close button dismiss the sheet without saving', async ({ page }) => {
    await page.getByRole('button', { name: 'New entry' }).click();
    await page.getByRole('dialog').getByLabel('Amount (₹)').fill('999');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await page.getByRole('button', { name: 'New entry' }).click();
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(app.heroValue()).toHaveText('₹0.00');
  });

  test('focus is trapped inside the open sheet and returns to the opener afterwards', async ({ page }) => {
    const fab = page.getByRole('button', { name: 'New entry' });
    await fab.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    for (let i = 0; i < 14; i += 1) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(fab).toBeFocused();
  });

  test('editing an entry changes it in place', async ({ page }) => {
    await app.addEntry({ amount: 1000, category: 'Groceries', note: 'Milk' });
    await app.go('entries');
    await page.getByRole('button', { name: 'Edit Groceries' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Amount (₹)')).toHaveValue('1000');
    await expect(dialog.getByLabel('Note')).toHaveValue('Milk');
    await dialog.getByLabel('Amount (₹)').fill('1500');
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('.list-item')).toHaveCount(1);
    await expect(row(page, 'Groceries')).toContainText('−₹1,500.00');
  });

  test('deleting asks for confirmation', async ({ page }) => {
    await app.addEntry({ amount: 1000, category: 'Groceries' });
    await app.go('entries');
    await page.getByRole('button', { name: 'Delete Groceries' }).click();
    await expect(page.locator('.list-item')).toHaveCount(0);
    expect(app.confirmations().at(-1)).toContain('Delete this entry');
    await expect(page.getByText('No entries yet')).toBeVisible();
  });

  test('markup typed into notes is shown as text and never executed', async ({ page }) => {
    await app.addEntry({ amount: 10, category: '<b>Bold</b>', note: '<img src=x onerror=alert(1)><script>alert(2)</script>' });
    await app.go('entries');
    await expect(row(page, 'Bold')).toContainText('<img src=x onerror=alert(1)>');
    await expect(page.locator('.list-item img')).toHaveCount(0);
    await expect(page.locator('.list-item b')).toHaveCount(0);
    await page.waitForTimeout(200);
    await app.expectClean();
  });

  test('month navigation shows other months, and entries stay in their own month', async ({ page }) => {
    await app.addEntry({ amount: 500, category: 'Groceries' });
    await app.go('entries');
    await page.getByRole('button', { name: 'Previous month' }).click();
    await expect(page.getByText('No entries yet')).toBeVisible();
    await page.getByRole('button', { name: 'Next month' }).click();
    await expect(row(page, 'Groceries')).toBeVisible();
  });

  test('an entry dated in another month lands in that month', async ({ page }) => {
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 15);
    const iso = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-15`;
    await app.addEntry({ amount: 700, category: 'Groceries', date: iso });
    await app.go('entries');
    await expect(page.locator('.list-item')).toHaveCount(0);
    await page.getByRole('button', { name: 'Previous month' }).click();
    await expect(row(page, 'Groceries')).toContainText('₹700.00');
  });
});
