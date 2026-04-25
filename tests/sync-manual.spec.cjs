const { test, expect } = require('@playwright/test');
const BASE = 'http://localhost/qc-web/';

test('QC → IPQC sync via __navigateToQcLot then sidebar switch', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');

  // Navigate to QC with specific lot
  await page.evaluate(() => window.__navigateToQcLot('ALP', '261634'));
  await page.waitForSelector('text=表一', { timeout: 10000 });
  await page.waitForTimeout(3000);

  // Verify QC shows it
  let content = await page.textContent('body');
  expect(content).toContain('ALP');
  expect(content).toContain('261634');
  console.log('QC has ALP/261634: OK');

  // Switch to IPQC
  await page.locator('aside button', { hasText: 'IPQC 工作台' }).click();
  await page.waitForTimeout(3000);

  content = await page.textContent('body');
  console.log('IPQC has ALP:', content.includes('ALP'));
  console.log('IPQC has 261634:', content.includes('261634'));
  await page.screenshot({ path: '/tmp/test-qc-to-ipqc.png', fullPage: true });

  expect(content).toContain('ALP');
});

test('IPQC select marker → QC shows same marker', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');

  // Go to IPQC
  await page.locator('aside button', { hasText: 'IPQC 工作台' }).click();
  await page.waitForSelector('text=原始數據', { timeout: 10000 });
  await page.waitForTimeout(2000);

  // Select AST in IPQC marker dropdown
  const markerSelect = page.locator('select').first();
  await markerSelect.selectOption('AST');
  await page.waitForTimeout(2000);

  // Switch to QC
  await page.locator('aside button', { hasText: 'IPQC 管理' }).click();
  await page.waitForSelector('text=表一', { timeout: 10000 });
  await page.waitForTimeout(3000);

  const content = await page.textContent('body');
  console.log('QC has AST:', content.includes('AST'));
  await page.screenshot({ path: '/tmp/test-ipqc-to-qc.png', fullPage: true });

  expect(content).toContain('AST');
});

test('Round trip: QC → IPQC → QC preserves lot', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');

  // Set lot via global function
  await page.evaluate(() => window.__navigateToQcLot('K', '261512'));
  await page.waitForSelector('text=表一', { timeout: 10000 });
  await page.waitForTimeout(2000);

  // Go to IPQC
  await page.locator('aside button', { hasText: 'IPQC 工作台' }).click();
  await page.waitForTimeout(2000);

  // Go back to QC
  await page.locator('aside button', { hasText: 'IPQC 管理' }).click();
  await page.waitForSelector('text=表一', { timeout: 10000 });
  await page.waitForTimeout(3000);

  const content = await page.textContent('body');
  console.log('After round trip - K:', content.includes('K'));
  console.log('After round trip - 261512:', content.includes('261512'));
  await page.screenshot({ path: '/tmp/test-roundtrip.png', fullPage: true });

  expect(content).toContain('K');
  expect(content).toContain('261512');
});
