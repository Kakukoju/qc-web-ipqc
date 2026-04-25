const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost/qc-web/';
const THIS_YEAR = new Date().getFullYear().toString();

test.describe('Dashboard year filter and KPI navigation', () => {

  test('Dashboard title shows current year and year selector works', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');

    // Title should contain current year
    const title = page.locator('h1');
    await expect(title).toContainText(THIS_YEAR + '-Beads IPQC 總覽');
    console.log('Title OK: ' + await title.textContent());

    // Year selector exists and defaults to current year
    const yearSelect = page.locator('select');
    await yearSelect.waitFor({ timeout: 5000 });
    const selectedYear = await yearSelect.inputValue();
    expect(selectedYear).toBe(THIS_YEAR);
    console.log('Default year: ' + selectedYear);

    // Switch to 2025
    await yearSelect.selectOption('2025');
    await page.waitForTimeout(2000);

    // Title should update
    await expect(title).toContainText('2025-Beads IPQC 總覽');
    console.log('Switched to 2025 OK');

    // KPI cards should still render (with 2025 data)
    const kpiCards = page.locator('.rounded-xl');
    const count = await kpiCards.count();
    console.log('KPI cards rendered: ' + count);
    expect(count).toBeGreaterThan(0);

    await page.screenshot({ path: '/tmp/test-year-2025.png', fullPage: true });
  });

  test('NG card → modal → row click → QC shows that lot', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('text=IPQC 總覽', { timeout: 10000 });

    const ngCard = page.locator('[data-kpi-clickable="NG 筆數"]');
    await ngCard.waitFor({ timeout: 10000 });
    await ngCard.click();

    const modal = page.locator('#kpi-hover-modal');
    await modal.waitFor({ timeout: 5000 });

    await page.waitForFunction(() => {
      const b = document.querySelector('#kpi-hover-modal .kpm-body');
      return b && !b.querySelector('.kpm-loading');
    }, { timeout: 10000 });

    const firstRow = modal.locator('.kpm-row').first();
    const bead = await firstRow.getAttribute('data-bead');
    const sheet = await firstRow.getAttribute('data-sheet');
    console.log('NG row: ' + bead + ' / ' + sheet);

    await firstRow.click();
    await page.waitForSelector('text=表一', { timeout: 10000 });
    await page.waitForTimeout(3000);

    const content = await page.textContent('body');
    expect(content).toContain(bead);
    expect(content).toContain(sheet);
    console.log('QC shows lot: OK');

    await page.screenshot({ path: '/tmp/test-ng-nav.png', fullPage: true });
  });

  test('__navigateToQcLot works', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('text=IPQC 總覽', { timeout: 10000 });

    const fnExists = await page.evaluate(() => typeof window.__navigateToQcLot === 'function');
    expect(fnExists).toBe(true);

    await page.evaluate(() => window.__navigateToQcLot('K', '261512'));
    await page.waitForSelector('text=表一', { timeout: 10000 });
    await page.waitForTimeout(3000);

    const content = await page.textContent('body');
    expect(content).toContain('261512');
    console.log('Direct nav: OK');
  });

  test('QC ↔ IPQC lot sync', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');

    await page.evaluate(() => window.__navigateToQcLot('K', '261512'));
    await page.waitForSelector('text=表一', { timeout: 10000 });
    await page.waitForTimeout(2000);

    const ipqcBtn = page.locator('aside button', { hasText: 'IPQC 工作台' });
    await ipqcBtn.click();
    await page.waitForTimeout(3000);

    const content = await page.textContent('body');
    expect(content).toContain('K');
    console.log('Sync: OK');
  });
});
