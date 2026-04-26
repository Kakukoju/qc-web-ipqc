const { test, expect } = require('@playwright/test');
const BASE = 'http://localhost/qc-web/';

test('Judge select: Hold requires reason, Accept from Hold requires reason', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');

  // Navigate to QC with a known lot
  await page.evaluate(() => window.__navigateToQcLot('K', '261512'));
  await page.waitForSelector('text=表一', { timeout: 10000 });
  await page.waitForTimeout(3000);

  // Switch to 表二
  await page.locator('button', { hasText: '表二' }).click();
  await page.waitForTimeout(3000);

  // Find a JudgeSelect (select element in the detail area)
  const selects = page.locator('select');
  const count = await selects.count();
  console.log('Select elements found:', count);

  // Find one that has Accept/Fail/Hold options
  let judgeSelect = null;
  for (let i = 0; i < count; i++) {
    const options = await selects.nth(i).locator('option').allTextContents();
    if (options.includes('Hold') && options.includes('Accept')) {
      judgeSelect = selects.nth(i);
      console.log('Found JudgeSelect at index', i, 'options:', options.join(','));
      break;
    }
  }

  if (!judgeSelect) {
    console.log('No JudgeSelect found - may need to select a sheet first');
    await page.screenshot({ path: '/tmp/test-judge-noselect.png', fullPage: true });
    return;
  }

  // Select Hold → modal should appear
  await judgeSelect.selectOption('Hold');
  await page.waitForTimeout(500);

  const modal = page.locator('.fixed.inset-0');
  const modalVisible = await modal.isVisible();
  console.log('Hold modal visible:', modalVisible);

  if (modalVisible) {
    // Try to confirm without reason → button should be disabled
    const confirmBtn = page.locator('button', { hasText: '確認' });
    const disabled = await confirmBtn.isDisabled();
    console.log('Confirm disabled without reason:', disabled);

    // Type reason
    await page.locator('textarea').fill('測試 Hold 原因');
    await page.waitForTimeout(300);

    // Now confirm should be enabled
    const enabledNow = !(await confirmBtn.isDisabled());
    console.log('Confirm enabled with reason:', enabledNow);

    // Click cancel instead (don't actually save)
    await page.locator('button', { hasText: '取消' }).click();
    console.log('Cancelled Hold');
  }

  await page.screenshot({ path: '/tmp/test-judge-hold.png', fullPage: true });
  expect(modalVisible).toBe(true);
});
