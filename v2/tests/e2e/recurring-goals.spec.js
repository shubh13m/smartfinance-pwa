import { test, expect } from '@playwright/test';
import { App } from './helpers.js';

const nextMonthDeadline = () => {
  const d = new Date();
  const target = new Date(d.getFullYear(), d.getMonth() + 5, 28);
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-28`;
};

test.describe('recurring items', () => {
  let app;
  test.beforeEach(async ({ page }) => {
    app = new App(page);
    await app.open();
    await app.signIn('Shubham');
  });

  test('a monthly bill counts in the overview and is listed', async ({ page }) => {
    await app.addEntry({ kind: 'income', amount: 100000, category: 'Salary' });
    await app.addRecurring({ name: 'Rent', amount: 28000, category: 'Housing' });
    await expect(page.locator('.list-item', { hasText: 'Rent' })).toContainText('₹28,000.00 / month');
    await app.go('dashboard');
    await expect(app.heroValue()).toHaveText('₹72,000.00');
    await expect(page.locator('.ring-card[data-bucket=needs]')).toContainText('₹28,000.00 of ₹50,000.00');
  });

  test('recurring income raises the total', async ({ page }) => {
    await app.addRecurring({ kind: 'income', name: 'Salary', amount: 60000, category: 'Salary' });
    await app.go('dashboard');
    await expect(app.heroValue()).toHaveText('₹60,000.00');
  });

  test('the due-month field is only offered for yearly items', async ({ page }) => {
    await app.go('recurring');
    await expect(page.getByLabel('Due month')).toBeHidden();
    await page.getByLabel('How often').selectOption('yearly');
    await expect(page.getByLabel('Due month')).toBeVisible();
  });

  test('"Stop" ends a bill after this month and keeps this month\'s cost', async ({ page }) => {
    await app.addRecurring({ name: 'Gym', amount: 1000, category: 'Personal Care' });
    await page.locator('.list-item', { hasText: 'Gym' }).getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByRole('status')).toContainText('Stopped');
    await expect(page.locator('.list-item', { hasText: 'Gym' }).getByRole('button', { name: 'Stop' })).toHaveCount(0);
    await app.go('dashboard');
    await expect(app.heroValue()).toHaveText('-₹1,000.00');
    await page.getByRole('button', { name: 'Next month' }).click();
    await expect(app.heroValue()).toHaveText('₹0.00');
  });

  test('deleting a recurring item removes it everywhere', async ({ page }) => {
    await app.addRecurring({ name: 'Gym', amount: 1000, category: 'Personal Care' });
    await page.getByRole('button', { name: 'Delete Gym' }).click();
    await expect(page.locator('.list-item', { hasText: 'Gym' })).toHaveCount(0);
    await expect(page.getByText('Nothing recurring yet')).toBeVisible();
  });

  test('validation: a blank name is rejected', async ({ page }) => {
    await app.go('recurring');
    const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Add item' }) });
    await form.getByLabel('Name').fill('   ');
    await form.getByLabel('Amount (₹)').fill('100');
    await form.getByLabel('Category').fill('Utilities');
    await form.getByRole('button', { name: 'Add item' }).click();
    await expect(page.getByRole('status')).toContainText('Name is required');
  });
});

test.describe('goals', () => {
  let app;
  test.beforeEach(async ({ page }) => {
    app = new App(page);
    await app.open();
    await app.signIn('Shubham');
  });

  test('create a goal, contribute, and see progress and the monthly amount needed', async ({ page }) => {
    await app.addGoal({ name: 'Goa trip', target: 60000, deadline: nextMonthDeadline() });
    const card = page.locator('.card', { has: page.getByRole('heading', { name: 'Goa trip' }) });
    await expect(card).toContainText('₹0.00of ₹60,000.00 · 0%');
    await expect(card).toContainText(/Save ₹[\d,]+\.\d\d\/month for \d+ month\(s\)/);

    await card.getByRole('textbox').fill('15000');
    await card.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(card).toContainText('₹15,000.00of ₹60,000.00 · 25%');
    await app.expectClean();
  });

  test('reaching the target marks the goal done', async ({ page }) => {
    await app.addGoal({ name: 'Phone', target: 1000 });
    const card = page.locator('.card', { has: page.getByRole('heading', { name: 'Phone' }) });
    await card.getByRole('textbox').fill('1000');
    await card.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(card).toContainText('Goal reached');
    await expect(card).toContainText('100%');
  });

  test('an invalid target or contribution is rejected', async ({ page }) => {
    await app.go('goals');
    await page.getByLabel('Goal', { exact: true }).fill('Bad goal');
    await page.getByLabel('Target (₹)').fill('lots');
    await page.getByRole('button', { name: 'Add goal' }).click();
    await expect(page.getByRole('status')).toContainText('Enter a valid target');
    await expect(page.getByRole('heading', { name: 'Bad goal' })).toHaveCount(0);
  });

  test('deleting a goal asks first and removes it', async ({ page }) => {
    await app.addGoal({ name: 'Old goal', target: 500 });
    await page.getByRole('button', { name: 'Delete goal Old goal' }).click();
    expect(app.confirmations().at(-1)).toContain('Old goal');
    await expect(page.getByRole('heading', { name: 'Old goal' })).toHaveCount(0);
    await expect(page.getByText('No goals yet')).toBeVisible();
  });

  test('goals are shared: the second person sees them and can contribute', async ({ page }) => {
    await app.addGoal({ name: 'Home', target: 100000 });
    await app.switchTo('Priya');
    await app.go('goals');
    const card = page.locator('.card', { has: page.getByRole('heading', { name: 'Home' }) });
    await expect(card).toBeVisible();
    await card.getByRole('textbox').fill('5000');
    await card.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(card).toContainText('5%');
  });
});
