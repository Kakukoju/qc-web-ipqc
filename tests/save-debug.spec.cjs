const { test } = require('@playwright/test');
const BASE = 'http://localhost/qc-web/';

test('Click cell to edit, check if dirty and save enables', async ({ page }) => {
  page.on('console', msg => { if (msg.type() === 'error') console.log('ERR:', msg.text()); });
  page.on('pageerror', err => console.log('PAGE ERR:', err.message));

  await page.goto(BASE);
  await page.waitForLoadState('networkidle');

  await page.locator('aside button', { hasText: 'IPQC 工作台' }).click();
  await page.waitForSelector('text=原始數據', { timeout: 10000 });
  await page.waitForTimeout(2000);

  await page.locator('select').first().selectOption('tCREA');
  await page.waitForTimeout(2000);
  await page.locator('select').nth(1).selectOption('Z-PEY-PEUZ-PEY-PEX-PEW-PE');
  await page.waitForTimeout(3000);

  // Find a data cell (not header) and try to click it
  const tds = page.locator('td');
  const tdCount = await tds.count();
  console.log('Total tds:', tdCount);

  // Try clicking cells starting from row 3+ (skip headers)
  let clickedCell = false;
  for (let i = 20; i < Math.min(tdCount, 50); i++) {
    const td = tds.nth(i);
    const text = await td.textContent();
    const cls = await td.getAttribute('class');
    if (i < 25) console.log('td[' + i + ']:', JSON.stringify(text?.trim()?.slice(0, 20)), 'class:', cls?.slice(0, 40));
    
    // Try clicking a data cell
    if (text?.trim() === '' || text?.trim() === '—' || text === null) {
      await td.click({ force: true });
      await page.waitForTimeout(500);
      
      // Check if an input appeared
      const inputs = await page.locator('input').count();
      console.log('After click td[' + i + ']: inputs=' + inputs);
      
      if (inputs > 0) {
        // Type a value
        await page.locator('input').first().fill('0.123');
        await page.waitForTimeout(300);
        await page.keyboard.press('Tab');
        await page.waitForTimeout(500);
        
        // Check save button
        const saveDisabled = await page.locator('button', { hasText: '儲存' }).first().isDisabled();
        console.log('After edit - save disabled:', saveDisabled);
        
        // Check dirty count
        const body = await page.textContent('body');
        const dirtyMatch = body.match(/(\d+)\s*筆未儲存/);
        console.log('Dirty count text:', dirtyMatch ? dirtyMatch[0] : 'not found');
        
        clickedCell = true;
        break;
      }
    }
  }

  if (!clickedCell) {
    console.log('Could not find editable cell');
    // Check what the grid looks like
    const rows = page.locator('tr');
    const rowCount = await rows.count();
    for (let i = 0; i < Math.min(rowCount, 5); i++) {
      const text = await rows.nth(i).textContent();
      console.log('row[' + i + ']:', text?.slice(0, 100));
    }
  }

  await page.screenshot({ path: '/tmp/test-cell-edit.png', fullPage: true });
});
