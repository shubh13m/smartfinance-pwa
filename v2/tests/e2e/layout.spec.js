import { test, expect } from '@playwright/test';
import { App } from './helpers.js';
import { ROUTES, seedRichData } from './seed.js';

// Awkward data (very long names, big numbers, a former member, loans, goals, six months of history)
// on every screen, at every common phone/tablet/desktop width, in both themes.
const WIDTHS = [
  { name: 'small phone', width: 320, height: 700 },
  { name: 'phone', width: 360, height: 780 },
  { name: 'large phone', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 900 },
];

async function layoutProblems(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const problems = [];
    if (document.documentElement.scrollWidth > vw + 1) problems.push(`page scrolls sideways (${document.documentElement.scrollWidth}px > ${vw}px)`);
    const label = (el) => `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).join('.')}` : ''}`;
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('.toast, .sheet-overlay, .table-wrap, svg')) continue;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const box = el.getBoundingClientRect();
      if (!box.width || !box.height) continue;
      if (box.right > vw + 1) problems.push(`${label(el)} runs off the right edge (${Math.round(box.right)}px > ${vw}px)`);
      if (box.left < -1) problems.push(`${label(el)} runs off the left edge (${Math.round(box.left)}px)`);
    }
    return [...new Set(problems)].slice(0, 8);
  });
}

test.describe('layout with awkward data', () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== 'desktop', 'sizes are set explicitly, so one project is enough');
  });

  for (const { name, width, height } of WIDTHS) {
    test(`${name} (${width}px): every screen fits, in light and dark`, async ({ page }) => {
      const app = new App(page);
      await page.setViewportSize({ width, height });
      await app.open();
      await seedRichData(page);
      for (const theme of ['light', 'dark']) {
        for (const route of ROUTES) {
          await page.goto(`/v2/#/${route}`);
          await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
          await expect(page.locator('.content')).toBeVisible();
          expect(await layoutProblems(page), `${theme} · ${route} · ${width}px`).toEqual([]);
        }
      }
      await app.expectClean();
    });
  }

  test('the add-entry sheet fits at the smallest width and its button stays reachable', async ({ page }) => {
    const app = new App(page);
    await page.setViewportSize({ width: 320, height: 568 });
    await app.open();
    await app.signIn('Shubham');
    await page.getByRole('button', { name: 'New entry' }).click();
    const sheet = await page.locator('.sheet').boundingBox();
    expect(sheet.x).toBeGreaterThanOrEqual(0);
    expect(sheet.x + sheet.width).toBeLessThanOrEqual(320);
    await page.getByRole('button', { name: /Add entry/ }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: /Add entry/ })).toBeVisible();
  });
});

test.describe('spacing', () => {
  let app;
  test.beforeEach(async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'sizes are set explicitly, so one project is enough');
    app = new App(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await app.open();
    await seedRichData(page);
  });

  test('a day heading has breathing room above it (regression: the margin was dropped)', async ({ page }) => {
    await app.go('entries');
    const gaps = await page.evaluate(() => {
      const days = [...document.querySelectorAll('.day')];
      return days.slice(1).map((day, i) => day.getBoundingClientRect().top - days[i].getBoundingClientRect().bottom);
    });
    expect(gaps.length).toBeGreaterThan(2);
    for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(16);
  });

  test('blocks inside every card are separated, never touching', async ({ page }) => {
    for (const route of ROUTES) {
      await app.go(route);
      const touching = await page.evaluate(() => {
        const out = [];
        for (const card of document.querySelectorAll('.card')) {
          const kids = [...card.children].filter((el) => getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0);
          for (let i = 1; i < kids.length; i += 1) {
            const gap = kids[i].getBoundingClientRect().top - kids[i - 1].getBoundingClientRect().bottom;
            if (gap < 8) out.push(`${kids[i - 1].className || kids[i - 1].tagName} → ${kids[i].className || kids[i].tagName}: ${Math.round(gap)}px`);
          }
        }
        return out;
      });
      expect(touching, route).toEqual([]);
    }
  });

  test('the calculation signs sit on the same line as their labels (regression: they were stacked above)', async ({ page }) => {
    await app.go('dashboard');
    const offsets = await page.evaluate(() => [...document.querySelectorAll('.calc-row')].map((row) => {
      const sign = row.querySelector('.calc-sign');
      if (!sign) return 0;
      const label = row.querySelector('span');
      return Math.abs(sign.getBoundingClientRect().top - label.getBoundingClientRect().top);
    }));
    expect(offsets.length).toBeGreaterThanOrEqual(7);
    for (const offset of offsets) expect(offset).toBeLessThan(6);
  });

  test('the chip next to a name does not touch it', async ({ page }) => {
    await app.go('settings');
    const gap = await page.evaluate(() => {
      const chip = document.querySelector('[data-testid=members] .item-title .chip');
      const title = chip.parentElement;
      const range = document.createRange();
      range.selectNodeContents(title.firstChild);
      return chip.getBoundingClientRect().left - range.getBoundingClientRect().right;
    });
    expect(gap).toBeGreaterThanOrEqual(6);
  });

  test('entry text keeps a readable width on phones (regression: notes were squeezed to one word a line)', async ({ page }) => {
    await app.go('entries');
    const widths = await page.evaluate(() => [...document.querySelectorAll('.entry .grow')].map((el) => el.getBoundingClientRect().width));
    expect(widths.length).toBeGreaterThan(5);
    for (const width of widths) expect(width).toBeGreaterThan(150);
  });

  test('long notes are clamped to two lines so one entry cannot take over the screen', async ({ page }) => {
    await app.go('entries');
    const maxHeight = await page.evaluate(() => Math.max(...[...document.querySelectorAll('.entry .item-sub')].map((el) => el.getBoundingClientRect().height)));
    expect(maxHeight).toBeLessThan(60);
  });

  test('money never wraps onto two lines (regression: "₹9,00,000.0 / 0")', async ({ page }) => {
    for (const route of ['dashboard', 'entries', 'goals']) {
      await app.go(route);
      // A number is "wrapped" when its text is laid out on more than one line.
      const wrapped = await page.evaluate(() => [...document.querySelectorAll('.num, .item-amount, .loan-fact strong, .calc-row strong')]
        .filter((el) => /₹/.test(el.textContent) && el.tagName !== 'TD')
        .filter((el) => {
          const range = document.createRange();
          range.selectNodeContents(el);
          return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size > 1;
        })
        .map((el) => el.textContent.trim()));
      expect(wrapped, route).toEqual([]);
    }
  });

  test('the two prepayment inputs line up (regression: one label wrapped and pushed its input down)', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await app.go('goals');
    const tops = await page.evaluate(() => {
      const first = document.querySelector('.whatif');
      return [...first.querySelectorAll('.form-grid input')].map((el) => Math.round(el.getBoundingClientRect().top));
    });
    expect(tops.length).toBe(2);
    expect(Math.abs(tops[0] - tops[1])).toBeLessThanOrEqual(1);
  });
});
