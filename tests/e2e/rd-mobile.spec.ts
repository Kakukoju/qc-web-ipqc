import { test, expect } from '@playwright/test';

/**
 * Playwright E2E tests for RD Mobile Page fixes:
 * 1. Work Order should display correctly (not same as Lot No)
 * 2. Skyla flower logo should appear in the header
 */

const MOCK_TASKS = [
  {
    id: 16,
    panel_name: 'Core Chem 13',
    lot_no: '1-0000007-26041701',
    marker: 'ALB',
    work_order: 'UMRZ26D036',
    status: 'pending_rd',
    created_at: '2026-01-28 15:31',
    created_by: 'PC Build-Lines',
    assigned_rd_name: null,
    started_at: null,
    completed_at: null,
    action_type: null,
  },
  {
    id: 17,
    panel_name: 'Core Chem 13',
    lot_no: '1-0000007-26041701',
    marker: 'ALP',
    work_order: 'UMRZ26D036',
    status: 'pending_rd',
    created_at: '2026-01-28 15:31',
    created_by: 'PC Build-Lines',
    assigned_rd_name: null,
    started_at: null,
    completed_at: null,
    action_type: null,
  },
];

// In dev mode, the rd-mobile page is served at /rd-mobile.html
const RD_MOBILE_URL = '/rd-mobile.html';

test.describe('RD Mobile Page - Work Order & Logo Fix', () => {

  test.beforeEach(async ({ page }) => {
    // Intercept the API call and return mock data with correct work_order
    await page.route('**/rd-build-line-tasks?*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, data: MOCK_TASKS }),
      });
    });
  });

  test('Work Order displays correctly and differs from Lot No', async ({ page }) => {
    await page.goto(RD_MOBILE_URL);

    // Wait for task cards to load
    await page.waitForSelector('.rd-task-card', { timeout: 10000 });

    // Get all task cards
    const cards = page.locator('.rd-task-card');
    const cardCount = await cards.count();
    expect(cardCount).toBeGreaterThan(0);

    // Check first card
    const firstCard = cards.first();

    // Verify Lot No value
    const lotNoRow = firstCard.locator('.rd-card-row').filter({ has: page.locator('.rd-card-label', { hasText: 'Lot No' }) });
    const lotNoValue = await lotNoRow.locator('.rd-card-value').textContent();
    expect(lotNoValue).toBe('1-0000007-26041701');

    // Verify Work Order value is UMRZ26D036, NOT the same as lot_no
    const workOrderRow = firstCard.locator('.rd-card-row').filter({ has: page.locator('.rd-card-label', { hasText: 'Work Order' }) });
    const workOrderValue = await workOrderRow.locator('.rd-card-value').textContent();
    expect(workOrderValue).toBe('UMRZ26D036');
    expect(workOrderValue).not.toBe(lotNoValue);
  });

  test('Skyla flower logo is visible in the header', async ({ page }) => {
    await page.goto(RD_MOBILE_URL);

    // Wait for the header to be visible
    await page.waitForSelector('.rd-header', { timeout: 10000 });

    // Check that the logo image exists in the header
    const logo = page.locator('.rd-header-logo');
    await expect(logo).toBeVisible();

    // Verify it's an img element with the correct src containing skylaflower.png
    const src = await logo.getAttribute('src');
    expect(src).toContain('skylaflower.png');
  });

  test('Logo appears before the title text in DOM order', async ({ page }) => {
    await page.goto(RD_MOBILE_URL);

    await page.waitForSelector('.rd-header', { timeout: 10000 });

    // Verify the logo comes before the title in DOM order within .rd-header-inner
    const headerInner = page.locator('.rd-header-inner');

    // Get all direct children
    const children = headerInner.locator('> *');
    const count = await children.count();

    let logoIndex = -1;
    let titleIndex = -1;

    for (let i = 0; i < count; i++) {
      const child = children.nth(i);
      const className = await child.getAttribute('class') || '';

      if (className.includes('rd-header-logo')) logoIndex = i;
      if (className.includes('rd-title')) titleIndex = i;
    }

    expect(logoIndex).toBeGreaterThanOrEqual(0);
    expect(titleIndex).toBeGreaterThan(logoIndex);
  });

  test('Header title shows "RD 建線任務" on list view', async ({ page }) => {
    await page.goto(RD_MOBILE_URL);

    await page.waitForSelector('.rd-header', { timeout: 10000 });

    const title = page.locator('.rd-title');
    await expect(title).toHaveText('RD 建線任務');
  });

  test('Work Order row is not shown when work_order is empty', async ({ page }) => {
    // Override with tasks that have no work_order
    await page.route('**/rd-build-line-tasks?*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: [{ ...MOCK_TASKS[0], work_order: null }],
        }),
      });
    });

    await page.goto(RD_MOBILE_URL);
    await page.waitForSelector('.rd-task-card', { timeout: 10000 });

    const firstCard = page.locator('.rd-task-card').first();
    const workOrderRow = firstCard.locator('.rd-card-row').filter({ has: page.locator('.rd-card-label', { hasText: 'Work Order' }) });
    await expect(workOrderRow).toHaveCount(0);
  });
});
