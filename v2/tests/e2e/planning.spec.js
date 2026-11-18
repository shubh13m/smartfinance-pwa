import { test, expect } from '@playwright/test';
import { App } from './helpers.js';

test.describe('left this month and safe to spend', () => {
  let app;
  test.beforeEach(async ({ page }) => {
    app = new App(page);
    await app.seedHousehold();
  });

  test('shows both numbers, side by side, with the calculation spelled out', async ({ page }) => {
    // Income 1,55,000 − spent 57,500 = 97,500 left. 20% plan target is 31,000, 15,000 already invested,
    // so 16,000 is held back for investing: 81,500 is safe to spend.
    await expect(app.heroValue()).toHaveText('₹97,500.00');
    await expect(page.getByTestId('safe-to-spend')).toHaveText('₹81,500.00');
    await expect(page.locator('.hero')).toContainText('after holding back ₹16,000 to invest');

    const line = (key) => page.locator(`[data-line=${key}] strong`);
    await expect(line('income')).toHaveText('₹1,55,000.00');
    await expect(line('invested')).toHaveText('₹15,000.00');
    await expect(line('left')).toHaveText('₹97,500.00');
    await expect(line('reserve')).toHaveText('₹16,000.00');
    await expect(line('safe')).toHaveText('₹81,500.00');
    await app.expectClean();
  });

  test('tells you a daily allowance for the days left this month', async ({ page }) => {
    await expect(page.locator('.hero')).toContainText(/Day \d+ of \d+ · \d+ days? left/);
    await expect(page.getByTestId('daily-allowance')).toContainText(/You can spend about ₹[\d,]+\.\d\d a day for \d+ more days?/);
  });

  test('each person sees their own left and safe-to-spend', async ({ page }) => {
    await page.locator('.toolbar .segmented').getByRole('button', { name: /Priya/ }).click();
    // Priya: income 65,000, spent 4,800 → left 60,200; target 13,000, nothing invested → 13,000 held back.
    await expect(app.heroValue()).toHaveText('₹60,200.00');
    await expect(page.getByTestId('safe-to-spend')).toHaveText('₹47,200.00');
  });

  test('a recurring bill lowers safe to spend from day one', async ({ page }) => {
    await app.addRecurring({ name: 'Rent', amount: 20000, category: 'Housing' });
    await app.go('dashboard');
    await expect(page.locator('[data-line=bills] strong')).toHaveText('₹20,000.00');
    await expect(page.getByTestId('safe-to-spend')).toHaveText('₹61,500.00');
  });

  test('overspending is called out', async ({ page }) => {
    await app.addEntry({ amount: 90000, category: 'Shopping' });
    await app.go('dashboard');
    await expect(page.getByTestId('plan-status')).toHaveText('Over what is safe');
    await expect(page.getByTestId('daily-allowance')).toContainText('Nothing is left to spend safely');
  });

  test('upcoming bills lists a bill once, with when it is due', async ({ page }) => {
    await app.addRecurring({ name: 'Internet', amount: 1000, category: 'Utilities' });
    await app.go('dashboard');
    await expect(page.locator('[data-bill=Internet]')).toHaveCount(1);
    await expect(page.locator('[data-bill=Internet]')).toContainText('today');
  });
});

test.describe('removing a person from the household', () => {
  let app;
  test.beforeEach(async ({ page }) => {
    app = new App(page);
    await app.seedHousehold();
    await app.go('settings');
  });

  test('you cannot remove yourself, only the other person', async ({ page }) => {
    const members = page.getByTestId('members');
    await expect(members.locator('li')).toHaveCount(2);
    await expect(members.locator('li', { hasText: 'Priya' }).getByRole('button', { name: /Remove/ })).toHaveCount(0);
    await expect(members.getByRole('button', { name: 'Remove Shubham' })).toBeVisible();
  });

  test('removing asks first, explains the effect, then moves them to former members', async ({ page }) => {
    await page.getByRole('button', { name: 'Remove Shubham' }).click();
    expect(app.confirmations().at(-1)).toMatch(/Remove Shubham.*lose access.*Shubham \(former\)/s);
    await expect(page.getByRole('status')).toContainText('Shubham was removed');
    await expect(page.getByTestId('members').locator('li')).toHaveCount(1);
    await expect(page.getByTestId('former-members')).toContainText('Shubham');
    await expect(page.getByText('1 member(s)')).toBeVisible();
    await app.expectClean();
  });

  test('once only one person is left there is nobody to remove and no Leave button', async ({ page }) => {
    await page.getByRole('button', { name: 'Remove Shubham' }).click();
    await expect(page.getByTestId('former-members')).toBeVisible();
    await expect(page.getByRole('button', { name: /Remove/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Leave household' })).toHaveCount(0);
  });

  test('what the removed person entered stays, labelled "(former)", and still counts', async ({ page }) => {
    await page.getByRole('button', { name: 'Remove Shubham' }).click();
    await expect(page.getByTestId('former-members')).toBeVisible();
    await app.go('entries');
    await expect(page.locator('.list-item', { hasText: 'Rent' })).toContainText('Shubham (former)');
    await app.go('dashboard');
    await expect(app.heroValue()).toHaveText('₹97,500.00');
    await expect(page.locator('.table')).toContainText('Shubham (former)');
    await page.locator('.toolbar .segmented').getByRole('button', { name: /Shubham \(former\)/ }).click();
    await expect(app.heroValue()).toHaveText('₹37,300.00');
  });

  test('declining the confirmation changes nothing', async ({ page }) => {
    page.removeAllListeners('dialog');
    page.on('dialog', (d) => d.dismiss());
    await page.getByRole('button', { name: 'Remove Shubham' }).click();
    await expect(page.getByTestId('members').locator('li')).toHaveCount(2);
    await expect(page.getByTestId('former-members')).toHaveCount(0);
  });
});

test.describe('loans and the emergency fund', () => {
  let app;
  test.beforeEach(async ({ page }) => {
    app = new App(page);
    await app.open();
    await app.signIn('Shubham');
  });

  async function addLoan(page, { name = 'Home loan', balance = 5000000, rate = 9, emi = 60000 } = {}) {
    await app.go('goals');
    const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Add loan' }) });
    await form.getByLabel('Loan name').fill(name);
    await form.getByLabel('Outstanding balance').fill(String(balance));
    await form.getByLabel('Interest rate').fill(String(rate));
    await form.getByLabel('Monthly EMI').fill(String(emi));
    await form.getByRole('button', { name: 'Add loan' }).click();
    await expect(page.locator(`[data-loan="${name}"]`)).toBeVisible();
  }

  test('adding a loan shows when it clears and the interest still to pay', async ({ page }) => {
    await addLoan(page);
    const loan = page.locator('[data-loan="Home loan"]');
    await expect(loan).toContainText('₹50,00,000.00');
    await expect(loan).toContainText('9% a year');
    await expect(page.getByTestId('payoff')).toContainText(/Clears in \d+ months? \(.+\) · ₹[\d,]+\.\d\d interest still to pay/);
    await app.expectClean();
  });

  test('prepaying shows how much sooner you finish and how much interest you save', async ({ page }) => {
    await addLoan(page);
    const result = page.getByTestId('prepay-result');
    await expect(result).toHaveText('Enter an amount to see the effect.');
    await page.getByLabel('One-time prepayment').fill('500000');
    await expect(result).toContainText(/Done \d+ months? sooner/);
    const saved = async () => Number((await result.innerText()).match(/₹([\d,]+)\.\d\d less/)[1].replaceAll(',', ''));
    const first = await saved();
    await page.getByLabel('Extra every month').fill('20000');
    expect(await saved()).toBeGreaterThan(first);
  });

  test('a loan whose EMI cannot cover the interest is flagged', async ({ page }) => {
    await addLoan(page, { name: 'Stuck', balance: 10000000, rate: 12, emi: 5000 });
    await expect(page.locator('[data-loan=Stuck]')).toContainText('EMI is lower than the monthly interest');
  });

  test('bad loan details are rejected', async ({ page }) => {
    await app.go('goals');
    const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Add loan' }) });
    await form.getByLabel('Loan name').fill('Bad');
    await form.getByLabel('Outstanding balance').fill('1000');
    await form.getByLabel('Interest rate').fill('99');
    await form.getByLabel('Monthly EMI').fill('100');
    await form.getByRole('button', { name: 'Add loan' }).click();
    await expect(page.getByRole('status')).toContainText('between 0 and 60 percent');
    await expect(page.locator('[data-loan=Bad]')).toHaveCount(0);
  });

  test('updating the balance and deleting a loan', async ({ page }) => {
    await addLoan(page);
    const loan = page.locator('[data-loan="Home loan"]');
    await loan.getByLabel('New outstanding balance').fill('4000000');
    await loan.getByRole('button', { name: 'Update balance' }).click();
    await expect(loan).toContainText('₹40,00,000.00');
    await page.getByRole('button', { name: 'Delete loan Home loan' }).click();
    await expect(page.locator('[data-loan="Home loan"]')).toHaveCount(0);
  });

  test('double-clicking Add loan saves it once', async ({ page }) => {
    await app.go('goals');
    const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Add loan' }) });
    await form.getByLabel('Loan name').fill('Car');
    await form.getByLabel('Outstanding balance').fill('100000');
    await form.getByLabel('Interest rate').fill('8');
    await form.getByLabel('Monthly EMI').fill('5000');
    await form.getByRole('button', { name: 'Add loan' }).dblclick();
    await expect(page.locator('[data-loan=Car]')).toHaveCount(1);
  });

  test('emergency fund: flag a goal, and the overview shows months covered', async ({ page }) => {
    await app.addEntry({ kind: 'income', amount: 100000, category: 'Salary' });
    await app.addEntry({ amount: 50000, category: 'Housing' });
    await app.go('goals');
    await page.getByLabel('Goal', { exact: true }).fill('Rainy day');
    await page.getByLabel('Target (₹)').fill('300000');
    await page.getByLabel('This is our emergency fund').check();
    await page.getByRole('button', { name: 'Add goal' }).click();
    const card = page.locator('.card', { has: page.getByRole('heading', { name: /Rainy day/ }) });
    await expect(card).toContainText('Emergency fund');
    await card.getByRole('textbox').fill('100000');
    await card.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByLabel('This is our emergency fund')).toHaveCount(0);

    await app.go('dashboard');
    await expect(page.getByTestId('emergency')).toContainText('2.0 of 6 months covered');
    await expect(page.getByTestId('emergency')).toContainText('Build this up');
  });

  test('without an emergency fund the overview invites you to set one up', async ({ page }) => {
    await expect(page.getByText('Not set up yet')).toBeVisible();
    await page.getByRole('link', { name: 'Set it up' }).click();
    await expect(page.getByRole('heading', { name: 'Goals & loans', level: 1 })).toBeVisible();
  });
});
