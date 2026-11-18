import { test, expect } from '@playwright/test';
import { App } from './helpers.js';

const ROUTES = ['dashboard', 'entries', 'recurring', 'goals', 'settings'];

test.describe('progressive web app', () => {
  test('links a valid manifest and theme colour', async ({ page, request }) => {
    const app = new App(page);
    await app.open();
    const href = await page.locator('link[rel=manifest]').getAttribute('href');
    const response = await request.get(new URL(href, page.url()).toString());
    expect(response.ok()).toBe(true);
    const manifest = await response.json();
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
    await expect(page.locator('meta[name=theme-color]')).toHaveAttribute('content', /^#[0-9a-f]{6}$/i);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('registers a service worker and keeps working offline', async ({ page, context }) => {
    test.skip(test.info().project.name === 'mobile', 'service worker behaviour is identical on both viewports');
    const app = new App(page);
    await app.open();
    await app.signIn('Shubham');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('.topbar')).toBeVisible();

    await app.addEntry({ kind: 'income', amount: 4200, category: 'Salary' });
    await expect(app.heroValue()).toHaveText('₹4,200.00');
    await context.setOffline(false);
  });

  test('the strict content security policy is never violated during normal use', async ({ page }) => {
    const app = new App(page);
    await app.seedHousehold();
    for (const route of ROUTES) await app.go(route);
    await page.getByRole('button', { name: 'Toggle dark mode' }).click();
    await app.go('dashboard');
    await app.expectClean();
  });

  test('database and CDN traffic is never cached by the service worker', async ({ page }) => {
    test.skip(test.info().project.name === 'mobile', 'covered once');
    const app = new App(page);
    await app.open();
    await page.evaluate(() => navigator.serviceWorker.ready);
    const cached = await page.evaluate(async () => {
      const urls = [];
      for (const name of await caches.keys()) for (const req of await (await caches.open(name)).keys()) urls.push(req.url);
      return urls;
    });
    expect(cached.length).toBeGreaterThan(0);
    for (const url of cached) expect(new URL(url).origin).toBe(new URL(page.url()).origin);
  });
});

test.describe('accessibility', () => {
  let app;
  test.beforeEach(async ({ page }) => {
    app = new App(page);
    await app.seedHousehold();
  });

  test('every screen has landmarks and exactly one level-1 heading', async ({ page }) => {
    for (const route of ROUTES) {
      await app.go(route);
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('main')).toHaveCount(1);
      await expect(page.locator('header')).toHaveCount(1);
      await expect(page.locator('nav[aria-label=Main], aside[aria-label=Sidebar]').first()).toBeAttached();
    }
  });

  test('every form control and button has an accessible name', async ({ page }) => {
    for (const route of ROUTES) {
      await app.go(route);
      const unnamed = await page.evaluate(() => {
        const problems = [];
        for (const el of document.querySelectorAll('input:not([type=hidden]), select, textarea')) {
          if (!(el.labels?.length || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby'))) problems.push(`${el.tagName}[${el.type}]`);
        }
        for (const el of document.querySelectorAll('button, a[href]')) {
          if (!(el.textContent.trim() || el.getAttribute('aria-label'))) problems.push(`${el.tagName}.${el.className}`);
        }
        return problems;
      });
      expect(unnamed, route).toEqual([]);
    }
  });

  test('the add-entry dialog is labelled and its fields are named', async ({ page }) => {
    await page.getByRole('button', { name: 'New entry' }).click();
    const dialog = page.getByRole('dialog', { name: 'New entry' });
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    for (const label of ['Amount (₹)', 'Date', 'Category', 'Note']) await expect(dialog.getByLabel(label)).toBeVisible();
  });

  test('progress bars and charts expose their values to assistive tech', async ({ page }) => {
    await expect(page.locator('[role=progressbar]').first()).toHaveAttribute('aria-valuenow', /\d+/);
    await expect(page.getByRole('img', { name: /six months/ })).toBeVisible();
  });

  test('the person filter and basis toggle expose their pressed state', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Together/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Monthly average' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Cash flow' }).click();
    await expect(page.getByRole('button', { name: 'Cash flow' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('the whole app can be operated with the keyboard (Tab reaches the main controls)', async ({ page }) => {
    const reached = new Set();
    for (let i = 0; i < 60; i += 1) {
      await page.keyboard.press('Tab');
      reached.add(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent?.trim().slice(0, 30)));
    }
    for (const control of ['Toggle dark mode', 'Previous month', 'Next month', 'New entry']) {
      expect([...reached].some((r) => r?.includes(control)), `${control} reachable`).toBe(true);
    }
  });

  test('keyboard focus is visibly indicated on every control it lands on', async ({ page }) => {
    const seen = [];
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Tab');
      seen.push(await page.evaluate(() => {
        const el = document.activeElement;
        const s = getComputedStyle(el);
        return { name: el.getAttribute('aria-label') || el.textContent.trim().slice(0, 20) || el.tagName, outline: s.outlineStyle, shadow: s.boxShadow };
      }));
    }
    for (const { name, outline, shadow } of seen) {
      expect(outline !== 'none' || shadow !== 'none', `${name} shows a focus indicator`).toBe(true);
    }
  });

  test('text and controls have usable contrast in dark mode too (no invisible text)', async ({ page }) => {
    await page.getByRole('button', { name: 'Toggle dark mode' }).click();
    await app.settleAnimations();
    const bad = await page.evaluate(() => {
      const parse = (c) => c.match(/[\d.]+/g).map(Number);
      const lum = ([r, g, b]) => [r, g, b].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
      const bgOf = (el) => { for (let n = el; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; const p = parse(c); if (p.length < 4 || p[3] > 0.5) return p.slice(0, 3); } return [11, 16, 32]; };
      const issues = [];
      for (const el of document.querySelectorAll('.card-title, .item-title, .hint, .item-sub, .field-label, h1, h2')) {
        if (!el.textContent.trim() || el.closest('.hero')) continue;
        const fg = parse(getComputedStyle(el).color).slice(0, 3);
        const [a, b] = [lum(fg), lum(bgOf(el))].sort((x, y) => y - x);
        if ((a + 0.05) / (b + 0.05) < 4.5) issues.push(`${el.className || el.tagName}: ${((a + 0.05) / (b + 0.05)).toFixed(2)}`);
      }
      return issues;
    });
    expect(bad).toEqual([]);
  });
});

test.describe('responsive layout', () => {
  test('desktop shows the sidebar; phones show bottom tabs instead', async ({ page }, info) => {
    const app = new App(page);
    await app.seedHousehold();
    const desktop = info.project.name === 'desktop';
    await expect(page.locator('.sidebar')).toBeVisible({ visible: desktop });
    await expect(page.locator('.tabs')).toBeVisible({ visible: !desktop });
    await expect(page.locator('.fab')).toBeVisible();
  });

  for (const route of ROUTES) {
    test(`no horizontal scrolling on ${route}`, async ({ page }) => {
      const app = new App(page);
      await app.seedHousehold();
      await app.go(route);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    });
  }

  test('the floating button never covers the bottom tab bar', async ({ page }, info) => {
    test.skip(info.project.name === 'desktop', 'tab bar is phone-only');
    const app = new App(page);
    await app.seedHousehold();
    const fab = await page.locator('.fab').boundingBox();
    const tabs = await page.locator('.tabs').boundingBox();
    expect(fab.y + fab.height).toBeLessThanOrEqual(tabs.y + 1);
  });

  test('touch targets on phones are comfortably large', async ({ page }, info) => {
    test.skip(info.project.name === 'desktop', 'phone only');
    const app = new App(page);
    await app.seedHousehold();
    for (const selector of ['.tab', '.fab', '.month-switch .icon-btn']) {
      for (const box of await page.locator(selector).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))) {
        expect(Math.min(box.width, box.height), selector).toBeGreaterThanOrEqual(40);
      }
    }
  });

  test('the entry sheet fits on small screens and can scroll', async ({ page }) => {
    const app = new App(page);
    await app.open();
    await app.signIn('Shubham');
    await page.getByRole('button', { name: 'New entry' }).click();
    const box = await page.locator('.sheet').boundingBox();
    const viewport = page.viewportSize();
    expect(box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.height).toBeLessThanOrEqual(viewport.height);
    await expect(page.getByRole('button', { name: /Add entry/ })).toBeVisible();
  });
});
