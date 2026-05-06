const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost/qc-web/';

test.describe('Template test mode', () => {

  test('IPQC Workbench shows 模板排產 tab', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');

    const ipqcBtn = page.locator('aside button', { hasText: 'IPQC 工作台' });
    await ipqcBtn.waitFor({ timeout: 10000 });
    await ipqcBtn.click();
    await page.waitForTimeout(2000);

    const tabs = ['原始數據', '待檢驗', '排產匯入', '模板排產'];
    for (const label of tabs) {
      const tab = page.locator('button', { hasText: label });
      await expect(tab).toBeVisible({ timeout: 5000 });
      console.log(`Tab "${label}" visible: OK`);
    }
  });

  test('WellConfigModal shows 測試模板 save/load controls', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');

    // Navigate to IPQC
    const ipqcBtn = page.locator('aside button', { hasText: 'IPQC 工作台' });
    await ipqcBtn.waitFor({ timeout: 10000 });
    await ipqcBtn.click();
    await page.waitForTimeout(2000);

    // Open WellConfigModal via "修改 Well 配置" button
    const wellConfigBtn = page.locator('button', { hasText: '修改 Well 配置' });
    await wellConfigBtn.waitFor({ timeout: 10000 });
    await wellConfigBtn.click();
    await page.waitForTimeout(1500);

    // Should see both "Well 模板" and "測試模板" labels
    await expect(page.locator('text=Well 模板')).toBeVisible({ timeout: 5000 });
    console.log('Well 模板 label: OK');

    await expect(page.getByText('測試模板', { exact: true }).first()).toBeVisible({ timeout: 5000 });
    console.log('測試模板 label: OK');

    // Test template dropdown (purple border) should contain K-ALT
    const testTplSelect = page.locator('select[class*="A78BFA"]');
    await expect(testTplSelect).toBeVisible({ timeout: 5000 });
    const testOptions = await testTplSelect.locator('option').allTextContents();
    expect(testOptions.some(o => o.includes('K-ALT'))).toBeTruthy();
    console.log('Test template dropdown with K-ALT: OK');

    // "另存測試模板" button should exist
    await expect(page.getByText('另存測試模板')).toBeVisible({ timeout: 5000 });
    console.log('另存測試模板 button: OK');

    await page.screenshot({ path: '/tmp/test-wellconfig-testtpl.png', fullPage: true });
  });

  test('Load test template into WellConfigModal grid', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');

    const ipqcBtn = page.locator('aside button', { hasText: 'IPQC 工作台' });
    await ipqcBtn.waitFor({ timeout: 10000 });
    await ipqcBtn.click();
    await page.waitForTimeout(2000);

    // Open WellConfigModal
    const wellConfigBtn = page.locator('button', { hasText: '修改 Well 配置' });
    await wellConfigBtn.waitFor({ timeout: 10000 });
    await wellConfigBtn.click();
    await page.waitForTimeout(1500);

    // Select K-ALT test template from the purple-bordered dropdown
    const testTplSelect = page.locator('select[class*="A78BFA"]');
    const options = await testTplSelect.locator('option').allTextContents();
    const kaltOption = options.find(o => o.includes('K-ALT'));
    await testTplSelect.selectOption({ label: kaltOption });
    await page.waitForTimeout(1000);

    // The well grid should now show K and ALT-A assignments
    // Check that the preview line shows both markers
    await expect(page.locator('text=測試模板預覽')).toBeVisible({ timeout: 5000 });
    console.log('Test template preview visible: OK');

    // K and ALT-A should appear in the preview
    const previewText = await page.locator('text=測試模板預覽').locator('..').textContent();
    expect(previewText).toContain('K');
    expect(previewText).toContain('ALT-A');
    console.log('Preview contains K and ALT-A: OK');

    await page.screenshot({ path: '/tmp/test-wellconfig-loaded.png', fullPage: true });
  });

  test('模板排產 tab shows template selector and marker lot inputs', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');

    const ipqcBtn = page.locator('aside button', { hasText: 'IPQC 工作台' });
    await ipqcBtn.waitFor({ timeout: 10000 });
    await ipqcBtn.click();
    await page.waitForTimeout(2000);

    // Click 模板排產 tab
    const schedTab = page.locator('button', { hasText: '模板排產' });
    await schedTab.click();
    await page.waitForTimeout(2000);

    // Template selector
    const tmplSelect = page.locator('select').filter({ hasText: '選擇模板' });
    await expect(tmplSelect).toBeVisible({ timeout: 5000 });

    // Select K-ALT
    const options = await tmplSelect.locator('option').allTextContents();
    const kaltOption = options.find(o => o.includes('K-ALT'));
    await tmplSelect.selectOption({ label: kaltOption });
    await page.waitForTimeout(1000);

    // Marker lot inputs for K and ALT-A
    await expect(page.locator('td', { hasText: 'K' }).first()).toBeVisible();
    await expect(page.locator('td', { hasText: 'ALT-A' }).first()).toBeVisible();
    console.log('Marker lot inputs: OK');

    const lotInputs = page.locator('input[placeholder="批號"]');
    expect(await lotInputs.count()).toBe(2);

    await expect(page.getByRole('button', { name: '匯入', exact: true })).toBeVisible();
    console.log('Import button: OK');
  });

  test('Template API returns existing templates', async ({ page }) => {
    const res = await page.request.get('http://localhost:3201/api/template');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(Array.isArray(data)).toBeTruthy();
    expect(data.length).toBeGreaterThan(0);

    const kalt = data.find(t => t.name === 'K-ALT');
    expect(kalt).toBeTruthy();
    expect(kalt.markers).toContain('K');
    expect(kalt.markers).toContain('ALT-A');
    console.log('Template API:', data.map(t => t.name).join(', '));
  });
});
