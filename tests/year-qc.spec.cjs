const { test, expect } = require('@playwright/test');
const BASE = 'http://localhost/qc-web/';

test('2025 QC full flow with screenshots', async ({ page }) => {
  page.on('console', msg => { if (msg.type() === 'error') console.log('ERR:', msg.text()); });
  page.on('pageerror', err => console.log('PAGE ERR:', err.message));

  await page.goto(BASE);
  await page.waitForLoadState('networkidle');

  // Select 2025 on dashboard
  await page.locator('select').first().selectOption('2025');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/step1-dashboard-2025.png', fullPage: true });

  // Go to QC
  await page.locator('aside button', { hasText: 'IPQC 管理' }).click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/step2-qc-page.png', fullPage: true });

  const content1 = await page.textContent('body');
  console.log('Step2 - Has 2025:', content1.includes('2025'));
  console.log('Step2 - Has 表一:', content1.includes('表一'));

  // Click first marker
  const markers = page.locator('.w-36 button');
  const count = await markers.count();
  console.log('Step2 - Markers:', count);

  if (count > 0) {
    const name = await markers.first().textContent();
    console.log('Clicking:', name.trim());
    await markers.first().click({ force: true });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: '/tmp/step3-marker-clicked.png', fullPage: true });

    // Check sheets loaded
    const content2 = await page.textContent('body');
    console.log('Step3 - Has 批次:', content2.includes('批次'));

    // Click first sheet
    const sheets = page.locator('.w-52 button, [class*="sheet"] button');
    const sheetCount = await sheets.count();
    console.log('Step3 - Sheets:', sheetCount);

    if (sheetCount > 0) {
      await sheets.first().click({ force: true });
      await page.waitForTimeout(3000);
      await page.screenshot({ path: '/tmp/step4-sheet-clicked.png', fullPage: true });
      console.log('Step4 - Sheet clicked OK');
    }
  }

  // Now go back to dashboard, switch to 2026, go to QC again
  await page.locator('aside button', { hasText: 'Dashboard' }).click();
  await page.waitForTimeout(2000);
  await page.locator('select').first().selectOption('2026');
  await page.waitForTimeout(2000);
  await page.locator('aside button', { hasText: 'IPQC 管理' }).click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/step5-qc-2026.png', fullPage: true });

  const content3 = await page.textContent('body');
  console.log('Step5 - Has 2026:', content3.includes('2026'));
  console.log('Step5 - Has 表一:', content3.includes('表一'));

  expect(content3).toContain('表一');
});
