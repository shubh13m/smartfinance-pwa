import { expect } from '@playwright/test';

/** Page object wrapping the flows every end-to-end test needs. */
export class App {
  constructor(page) {
    this.page = page;
    this.dialogs = [];
    this.errors = [];
    page.on('dialog', (dialog) => { this.dialogs.push(`${dialog.type()}: ${dialog.message()}`); dialog.accept(); });
    page.on('pageerror', (error) => this.errors.push(error.message));
    page.on('console', (msg) => { if (msg.type() === 'error') this.errors.push(msg.text()); });
    // Pin the app to local mode so end-to-end tests never touch the real database,
    // and collect CSP violations so any test can assert the strict policy was never tripped.
    page.addInitScript(() => {
      localStorage.setItem('sf2_mode', 'local');
      window.__csp = [];
      document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
    });
  }

  confirmations() {
    return this.dialogs.filter((d) => d.startsWith('confirm'));
  }

  async expectClean() {
    expect(this.errors, 'console/page errors').toEqual([]);
    expect(await this.page.evaluate(() => window.__csp), 'CSP violations').toEqual([]);
    expect(this.dialogs.filter((d) => d.startsWith('alert')), 'unexpected alert() (script injection?)').toEqual([]);
  }

  async open(route = '') {
    await this.page.goto(`/v2/${route ? `#/${route}` : ''}`);
  }

  async signIn(name) {
    await this.page.getByLabel('Your name').fill(name);
    await this.page.getByRole('button', { name: 'Continue' }).click();
    await expect(this.page.locator('.topbar')).toBeVisible();
  }

  async go(route) {
    await this.page.goto(`/v2/#/${route}`);
    await expect(this.page.locator('.content')).toBeVisible();
  }

  async signOut() {
    await this.go('settings');
    await this.page.getByRole('button', { name: 'Sign out' }).click();
    await expect(this.page.getByLabel('Your name')).toBeVisible();
  }

  async switchTo(name) {
    await this.signOut();
    await this.signIn(name);
  }

  async addEntry({ kind = 'expense', amount, category, note = '', date, bucket }) {
    await this.page.getByRole('button', { name: 'New entry' }).click();
    const dialog = this.page.getByRole('dialog');
    if (kind === 'income') await dialog.getByRole('button', { name: 'Income', exact: true }).click();
    await dialog.getByLabel('Amount (₹)').fill(String(amount));
    await dialog.getByLabel('Category').fill(category);
    if (bucket) await dialog.getByLabel('Plan bucket').selectOption(bucket);
    if (note) await dialog.getByLabel('Note').fill(note);
    if (date) await dialog.getByLabel('Date').fill(date);
    await dialog.getByRole('button', { name: /Add entry/ }).click();
    await expect(dialog).toBeHidden();
  }

  async addRecurring({ kind = 'expense', name, amount, frequency = 'monthly', dueMonth, category, bucket }) {
    await this.go('recurring');
    const form = this.page.locator('form').filter({ has: this.page.getByRole('button', { name: 'Add item' }) });
    await form.getByLabel('Type').selectOption(kind);
    await form.getByLabel('Name').fill(name);
    await form.getByLabel('Amount (₹)').fill(String(amount));
    await form.getByLabel('How often').selectOption(frequency);
    if (frequency === 'yearly') await form.getByLabel('Due month').selectOption(String(dueMonth));
    await form.getByLabel('Category').fill(category);
    if (bucket && kind === 'expense') await form.getByLabel('Plan bucket').selectOption(bucket);
    await form.getByRole('button', { name: 'Add item' }).click();
    await expect(this.page.locator('.list-item', { hasText: name })).toBeVisible();
  }

  async addGoal({ name, target, deadline }) {
    await this.go('goals');
    await this.page.getByLabel('Goal', { exact: true }).fill(name);
    await this.page.getByLabel('Target (₹)').fill(String(target));
    if (deadline) await this.page.getByLabel('Deadline (optional)').fill(deadline);
    await this.page.getByRole('button', { name: 'Add goal' }).click();
    await expect(this.page.getByRole('heading', { name })).toBeVisible();
  }

  heroValue() {
    return this.page.locator('.hero-value');
  }

  // Waits for CSS transitions (theme fade etc.) so computed colours are final.
  async settleAnimations() {
    await this.page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
  }

  async seedHousehold() {
    await this.open();
    await this.signIn('Shubham');
    await this.addEntry({ kind: 'income', amount: 90000, category: 'Salary' });
    await this.addEntry({ amount: 28000, category: 'Housing', note: 'Rent' });
    await this.addEntry({ amount: 6200, category: 'Groceries', note: 'BigBasket' });
    await this.addEntry({ amount: 3500, category: 'Dining Out', note: 'Dinner' });
    await this.addEntry({ amount: 15000, category: 'Savings & Invest', note: 'SIP' });
    await this.switchTo('Priya');
    await this.addEntry({ kind: 'income', amount: 65000, category: 'Salary' });
    await this.addEntry({ amount: 4800, category: 'Shopping', note: 'Clothes' });
    await this.go('dashboard');
  }
}
