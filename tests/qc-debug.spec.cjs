const { test, expect } = require('@playwright/test');
const BASE = 'http://localhost/qc-web/';

test('QC page renders and is interactive', async ({ page }) => {
  page.on('console', msg => { if (msg.type() === 'error') console.log('CONSOLE ERROR:', msg.text()); });
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

  await page.goto(BASE);
  await page.waitForLoadState('networkidle');

  // Go to QC
  await page.locator('aside button', { hasText: 'IPQC 管理' }).click();
  await page.waitForTimeout(3000);

  // Check for errors
  const content = await page.textContent('body');
  console.log('Has 表一:', content.includes('表一'));
  console.log('Has Marker:', content.includes('Marker'));
  console.log('Has 年度:', content.includes('年度'));

  // Check if markers loaded
  const markers = page.locator('.w-36 button');
  const markerCount = await markers.count();
  console.log('Marker count:', markerCount);

  // Try clicking a marker
  if (markerCount > 0) {
    const first = markers.first();
    const name = await first.textContent();
    console.log('First marker:', name);
    await first.click({ force: true });
    await page.waitForTimeout(2000);
    console.log('After click - no crash');
  }

  // Check for JS errors in page
  const errors = await page.evaluate(() => {
    return window.__errors || [];
  });
  console.log('JS errors:', errors);

  await page.screenshot({ path: '/tmp/test-qc-debug.png', fullPage: true });
});
