import { test } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCREENSHOT_TIMEOUT = 15_000;
const SCREENSHOTS_DIR = path.resolve(__dirname, '../screenshots');

interface CaptureResult {
  name: string;
  success: boolean;
  error?: string;
  duration: number;
}

test('Capture all screenshots', async ({ page }) => {
  const results: CaptureResult[] = [];
  const totalStart = Date.now();

  async function snap(name: string, fn: () => Promise<void>) {
    const start = Date.now();
    try {
      await fn();
      await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `${name}.png`), fullPage: false });
      results.push({ name, success: true, duration: Date.now() - start });
    } catch (err) {
      results.push({ name, success: false, error: err instanceof Error ? err.message : String(err), duration: Date.now() - start });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // DASHBOARD MODULE (1920x1080)
  // ═══════════════════════════════════════════════════════════════════════
  await page.setViewportSize({ width: 1920, height: 1080 });

  await snap('Dashboard_overview_01', async () => {
    await page.goto('/qc-web/', { waitUntil: 'domcontentloaded', timeout: SCREENSHOT_TIMEOUT });
    await page.waitForTimeout(3000); // wait for KPI animations
  });

  await snap('Dashboard_kpi_cards_02', async () => {
    // Click Dashboard in sidebar to ensure we're on dashboard
    await page.click('button:has-text("Dashboard")', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1500);
    // Scroll to show KPI cards area at top
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);
  });

  await snap('Dashboard_refresh_03', async () => {
    // Show the trend chart area (scroll down)
    await page.evaluate(() => {
      const main = document.querySelector('main');
      if (main) main.scrollTop = 400;
    });
    await page.waitForTimeout(1000);
  });

  // Navigate to IPQC 工作台 for import screenshots
  await snap('Dashboard_import_open_01', async () => {
    await page.click('button:has-text("IPQC 工作台")', { timeout: 5000 });
    await page.waitForTimeout(2000);
  });

  await snap('Dashboard_import_select_02', async () => {
    // Click 排產匯入 tab
    await page.click('button:has-text("排產匯入")', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1500);
  });

  await snap('Dashboard_import_confirm_03', async () => {
    // Click 模組計算 tab
    await page.click('button:has-text("模組計算")', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1500);
  });

  await snap('Dashboard_import_result_04', async () => {
    // Click 待檢驗 tab
    await page.click('button:has-text("待檢驗")', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1500);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // DRIED BEADS MODULE (table1) (1920x1080)
  // ═══════════════════════════════════════════════════════════════════════
  await snap('DriedBeads_table_view_01', async () => {
    await page.click('button:has-text("IPQC 管理")', { timeout: 5000 });
    await page.waitForTimeout(2000);
    // Should default to 表一
  });

  await snap('DriedBeads_search_02', async () => {
    // Click on a marker in the left column
    const markerBtn = page.locator('button:has-text("tCREA")').first();
    if (await markerBtn.isVisible()) {
      await markerBtn.click();
      await page.waitForTimeout(1500);
    }
  });

  await snap('DriedBeads_filter_03', async () => {
    // Scroll down to show sheet detail
    await page.evaluate(() => {
      const scrollable = document.querySelector('.overflow-y-auto');
      if (scrollable) scrollable.scrollTop = 300;
    });
    await page.waitForTimeout(1000);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // IPQC / OD ANALYSIS MODULE (table2) (1920x1080)
  // ═══════════════════════════════════════════════════════════════════════
  await snap('IPQC_csv_import_01', async () => {
    // Switch to 表二
    await page.click('button:has-text("表二 · OD 化學特性分析")', { timeout: 5000 });
    await page.waitForTimeout(2000);
  });

  await snap('IPQC_od_analysis_02', async () => {
    // Click on a marker in table2
    const markerBtn = page.locator('button:has-text("tCREA")').first();
    if (await markerBtn.isVisible()) {
      await markerBtn.click();
      await page.waitForTimeout(1500);
    }
  });

  await snap('IPQC_concentration_03', async () => {
    // Scroll to show more detail
    await page.evaluate(() => {
      const scrollable = document.querySelectorAll('.overflow-y-auto');
      const last = scrollable[scrollable.length - 1];
      if (last) last.scrollTop = 400;
    });
    await page.waitForTimeout(1000);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // TUTTI MODULE (1920x1080) - iframe content
  // ═══════════════════════════════════════════════════════════════════════
  await snap('Tutti_import_modal_01', async () => {
    await page.goto('/qc-web/pre-assignment/', { waitUntil: 'domcontentloaded', timeout: SCREENSHOT_TIMEOUT });
    await page.waitForTimeout(3000);
  });

  await snap('Tutti_fields_filled_02', async () => {
    // Scroll down to show more content
    await page.evaluate(() => window.scrollTo(0, 300));
    await page.waitForTimeout(1000);
  });

  await snap('Tutti_file_upload_03', async () => {
    await page.evaluate(() => window.scrollTo(0, 600));
    await page.waitForTimeout(1000);
  });

  await snap('Tutti_success_list_04', async () => {
    await page.evaluate(() => window.scrollTo(0, 900));
    await page.waitForTimeout(1000);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // BUILD LINE PC MODULE (1920x1080)
  // ═══════════════════════════════════════════════════════════════════════
  await snap('BuildLinePC_query_01', async () => {
    await page.goto('/qc-web/pre-assignment/build-lines', { waitUntil: 'domcontentloaded', timeout: SCREENSHOT_TIMEOUT });
    await page.waitForTimeout(3000);
  });

  await snap('BuildLinePC_execute_02', async () => {
    // Try clicking refresh/query button
    await page.click('.icon-button', { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(2000);
  });

  await snap('BuildLinePC_results_03', async () => {
    await page.evaluate(() => window.scrollTo(0, 300));
    await page.waitForTimeout(1000);
  });

  await snap('BuildLinePC_send_rd_04', async () => {
    await page.evaluate(() => window.scrollTo(0, 600));
    await page.waitForTimeout(1000);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // BUILD LINE MOBILE MODULE (375x812)
  // ═══════════════════════════════════════════════════════════════════════
  await page.setViewportSize({ width: 375, height: 812 });

  await snap('BuildLineMobile_scan_machine_01', async () => {
    await page.goto('/qc-web/pre-assignment/tutti-scan', { waitUntil: 'domcontentloaded', timeout: SCREENSHOT_TIMEOUT });
    await page.waitForTimeout(3000);
    // Should show Step 1: scan machine QR
  });

  await snap('BuildLineMobile_position_02', async () => {
    // Open manual input and submit a fake machine QR to advance to step 2
    const manualToggle = page.locator('.skyla-manual-panel__toggle');
    if (await manualToggle.isVisible()) {
      await manualToggle.click();
      await page.waitForTimeout(500);
      await page.fill('.skyla-manual-panel__textarea', '{"machineId":"M001","machineName":"Tutti-01","deviceSn":"SN12345"}');
      await page.click('.skyla-manual-panel__btn--submit');
      await page.waitForTimeout(1500);
    }
  });

  await snap('BuildLineMobile_scan_order_03', async () => {
    // Select Position 1 to advance to step 3
    const posBtn = page.locator('.skyla-position-grid__card').first();
    if (await posBtn.isVisible()) {
      await posBtn.click();
      await page.waitForTimeout(1500);
    }
  });

  await snap('BuildLineMobile_scan_disk_04', async () => {
    // Submit a fake work order QR to advance to step 4
    const manualToggle = page.locator('.skyla-manual-panel__toggle');
    if (await manualToggle.isVisible()) {
      await manualToggle.click();
      await page.waitForTimeout(500);
      await page.fill('.skyla-manual-panel__textarea', 'WO=TEST001;LotNo=LOT001;Batch=B001');
      await page.click('.skyla-manual-panel__btn--submit');
      await page.waitForTimeout(1500);
    }
  });

  await snap('BuildLineMobile_confirm_05', async () => {
    // Scroll to show summary cards
    await page.evaluate(() => window.scrollTo(0, 300));
    await page.waitForTimeout(1000);
  });

  await snap('BuildLineMobile_submit_06', async () => {
    // Scroll further to show bottom area
    await page.evaluate(() => window.scrollTo(0, 600));
    await page.waitForTimeout(1000);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // RD MOBILE MODULE (390x844)
  // ═══════════════════════════════════════════════════════════════════════
  await page.setViewportSize({ width: 390, height: 844 });

  await snap('RdMobile_tasklist_01', async () => {
    await page.goto('/qc-web/pre-assignment/rd-mobile', { waitUntil: 'domcontentloaded', timeout: SCREENSHOT_TIMEOUT });
    await page.waitForTimeout(3000);
    // Should show task list with filter tabs and panel grid
  });

  await snap('RdMobile_panel_detail_02', async () => {
    // Click on first panel icon to open panel detail
    const panelIcon = page.locator('.rd-panel-icon').first();
    if (await panelIcon.isVisible()) {
      await panelIcon.click();
      await page.waitForTimeout(2000);
    }
  });

  await snap('RdMobile_marker_detail_03', async () => {
    // Click on first marker row to open detail
    const markerRow = page.locator('.rd-marker-row').first();
    if (await markerRow.isVisible()) {
      await markerRow.click();
      await page.waitForTimeout(2000);
    }
  });

  await snap('RdMobile_curve_fit_04', async () => {
    // Click "開啟曲線調整" button to enter curve fit mode
    const adjustBtn = page.locator('.rd-btn.rd-btn-secondary, .rd-btn-secondary').first();
    if (await adjustBtn.isVisible()) {
      await adjustBtn.click();
      await page.waitForTimeout(1000);
      // Enter emp_no in auth modal
      const empInput = page.locator('.rd-modal-input');
      if (await empInput.isVisible()) {
        await empInput.fill('10018325');
        await page.click('.rd-btn.rd-btn-primary:has-text("確認")');
        await page.waitForTimeout(4000); // wait for fit data to load
      }
    }
    // Now should show CurveFitAdjust with scatter chart (擬合圖 tab)
  });

  await snap('RdMobile_residual_05', async () => {
    // Switch to 殘差 tab
    const residualTab = page.locator('button:has-text("📉 殘差")');
    if (await residualTab.isVisible()) {
      await residualTab.click();
      await page.waitForTimeout(1500);
    }
  });

  await snap('RdMobile_params_06', async () => {
    // Switch back to 擬合圖 tab to show sliders
    const chartTab = page.locator('button:has-text("📈 擬合圖")');
    if (await chartTab.isVisible()) {
      await chartTab.click();
      await page.waitForTimeout(1000);
    }
    // Scroll the page down to show the slider controls (Shift/Rotation)
    await page.evaluate(() => {
      // Try multiple scroll containers
      const containers = [
        document.querySelector('.rd-curve-fit'),
        document.querySelector('.rd-detail-container'),
        document.querySelector('.rd-app-shell__content'),
        document.documentElement,
      ];
      for (const c of containers) {
        if (c && c.scrollHeight > c.clientHeight) {
          c.scrollTop = c.scrollHeight;
          break;
        }
      }
    });
    await page.waitForTimeout(1000);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SUMMARY REPORT
  // ═══════════════════════════════════════════════════════════════════════
  const totalDuration = Date.now() - totalStart;
  const successCount = results.filter(r => r.success).length;
  const failedCount = results.filter(r => !r.success).length;
  const failedResults = results.filter(r => !r.success);

  console.log('');
  console.log('=== Screenshot Capture Summary ===');
  console.log(`Total: ${results.length} | Success: ${successCount} | Failed: ${failedCount}`);
  console.log(`Duration: ${(totalDuration / 1000).toFixed(1)}s`);

  if (failedResults.length > 0) {
    console.log('--- Failed Screenshots ---');
    for (const failed of failedResults) {
      console.log(`- ${failed.name}: ${failed.error}`);
    }
  }
  console.log('');
});
