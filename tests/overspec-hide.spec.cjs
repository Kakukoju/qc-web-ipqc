const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:5173/';

test('ALP: warning triangles fully visible, not clipped', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('text=IPQC 總覽', { timeout: 15000 });

  const alpCard = page.locator('.text-xs.font-bold').filter({ hasText: /^ALP$/ });
  await alpCard.first().click();
  await page.waitForTimeout(3000);
  await page.locator('text=批次趨勢').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(1000);

  // Check that all red dots + their ⚠ text are within visible area
  const analysis = await page.evaluate(() => {
    const results = [];
    const wrappers = document.querySelectorAll('.recharts-wrapper');
    wrappers.forEach((w, chartIdx) => {
      const container = w.closest('.mt-4');
      const title = container?.querySelector('.text-xs.font-medium')?.textContent || `Chart ${chartIdx}`;
      const wrapperRect = w.getBoundingClientRect();

      // Find red circles (over-spec dots)
      const reds = w.querySelectorAll('circle[stroke="#FF5C73"]');
      reds.forEach((c, i) => {
        const cRect = c.getBoundingClientRect();
        // Find the ⚠ text near this dot (sibling in same <g>)
        const g = c.parentElement;
        const warningText = g?.querySelector('text');
        let warningVisible = true;
        let warningY = null;
        if (warningText) {
          const tRect = warningText.getBoundingClientRect();
          warningY = tRect.y.toFixed(0);
          // Check if warning text top is above chart top
          warningVisible = tRect.y >= wrapperRect.y - 5; // 5px tolerance
        }

        results.push({
          chart: title,
          dotY: cRect.y.toFixed(0),
          warningY,
          warningVisible,
          chartTop: wrapperRect.y.toFixed(0),
          margin: warningY ? (parseFloat(warningY) - wrapperRect.y).toFixed(0) : null,
        });
      });
    });
    return results;
  });

  let allVisible = true;
  analysis.forEach(d => {
    const status = d.warningVisible ? '✓' : '✗ CLIPPED';
    if (!d.warningVisible) allVisible = false;
    console.log(`${status} ${d.chart}: dot@${d.dotY} ⚠@${d.warningY} (chartTop=${d.chartTop}, margin=${d.margin}px)`);
  });

  console.log(`\nAll warnings visible: ${allVisible}`);

  // Also verify all can be hidden
  let hidden = 0;
  for (let i = 0; i < 20; i++) {
    const reds = page.locator('circle[stroke="#FF5C73"]');
    if (await reds.count() === 0) break;
    await reds.first().dblclick({ force: true });
    await page.waitForTimeout(600);
    hidden++;
  }
  const finalReds = await page.locator('circle[stroke="#FF5C73"]').count();
  console.log(`Hidden ${hidden} lots, ${finalReds} remaining`);

  expect(finalReds).toBe(0);
  expect(allVisible).toBe(true);

  // Reset
  const resetBtn = page.locator('button:has-text("顯示全部")');
  if (await resetBtn.count() > 0) await resetBtn.click();

  await page.screenshot({ path: 'test-results/alp-triangle-visible.png', fullPage: true });
});
