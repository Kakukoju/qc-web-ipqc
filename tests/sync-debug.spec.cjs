const { test, expect } = require('@playwright/test');
const BASE = 'http://localhost/qc-web/';

test('Debug QC → IPQC sync', async ({ page }) => {
  page.on('console', msg => console.log('BROWSER:', msg.text()));

  await page.goto(BASE);
  await page.waitForLoadState('networkidle');

  // Go to QC via __navigateToQcLot
  await page.evaluate(() => window.__navigateToQcLot('K', '261512'));
  await page.waitForSelector('text=表一', { timeout: 10000 });
  await page.waitForTimeout(3000);

  // Verify QC has the lot
  let content = await page.textContent('body');
  console.log('QC has K:', content.includes('K'));
  console.log('QC has 261512:', content.includes('261512'));

  // Check sharedLot state before switching
  const sharedBefore = await page.evaluate(() => {
    // Try to read React state - look for the __navigateToQcLot closure
    return JSON.stringify(window.__debugSharedLot || 'not exposed');
  });
  console.log('sharedLot before switch:', sharedBefore);

  // Click IPQC 工作台 in sidebar
  const sidebarButtons = await page.locator('aside button').all();
  for (const btn of sidebarButtons) {
    const txt = await btn.textContent();
    console.log('Sidebar button:', txt.trim());
  }

  const ipqcBtn = page.locator('aside button', { hasText: 'IPQC 工作台' });
  const ipqcCount = await ipqcBtn.count();
  console.log('IPQC buttons found:', ipqcCount);

  await ipqcBtn.click();
  await page.waitForTimeout(3000);

  content = await page.textContent('body');
  console.log('IPQC has K:', content.includes('K'));
  console.log('IPQC has 原始數據:', content.includes('原始數據'));
  console.log('IPQC has 261512:', content.includes('261512'));

  await page.screenshot({ path: '/tmp/test-sync-debug.png', fullPage: true });
});
