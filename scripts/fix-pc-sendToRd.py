#!/usr/bin/env python3
"""Fix the sendToRd function in PC build-lines page to properly extract lot_no from results."""

PC_PAGE = "/home/ubuntu/pre-assignment/pc/src/pages/AssayProcessBaselinePage.tsx"

with open(PC_PAGE, 'r') as f:
    content = f.read()

old_fn = '''  const sendToRd = async () => {
    const c1 = conditions[0];
    const c2 = conditions[1];
    if (!c1?.value || !c2?.value) {
      setMessage('請先設定 panel_name 與 analyze_date 查詢條件');
      return;
    }
    const panelName = c1.value.split('||')[0];
    const lotNo = c2.value;
    setRdSending(true);
    try {
      const resp = await createRdBuildLineTask({
        panel_name: panelName,
        lot_no: lotNo,
        created_by: 'PC Build-Lines',
      });
      if (resp.ok) {
        const msg = resp.data?.existing
          ? `此筆已在 RD 待建線清單中 (ID: ${resp.data.task_id})`
          : `已送出 RD 建線任務 · ${panelName} / ${lotNo}`;
        setRdResult({ ok: true, message: msg });
      } else {
        setRdResult({ ok: false, message: resp.error?.message || '送出失敗' });
      }
    } catch {
      setRdResult({ ok: false, message: '網路錯誤' });
    } finally {
      setRdSending(false);
      setTimeout(() => setRdResult(null), 5000);
    }
  };'''

new_fn = '''  const sendToRd = async () => {
    // Extract panel_name from condition 1, lot_no from result rows (mfg_lot_no column)
    const c1 = conditions[0];
    if (!c1?.value) {
      setMessage('請先設定 panel_name 查詢條件並執行查詢');
      return;
    }
    const rows = result?.rows || [];
    if (rows.length === 0) {
      setMessage('請先執行查詢，取得建線資料後再送出');
      return;
    }
    const panelName = c1.value.split('||')[0];
    // Extract lot_no from first row's mfg_lot_no or Lot code column
    const firstRow = rows[0];
    const lotNo = firstRow['mfg_lot_no'] || firstRow['Lot code'] || firstRow['lot_no'] || '';
    if (!lotNo) {
      setMessage('查詢結果中找不到 mfg_lot_no，無法送出');
      return;
    }
    // Extract unique markers from results
    const markers = [...new Set(rows.map(r => r['analyze_item']).filter(Boolean))];
    const analyzeDate = firstRow['analyze_date'] || '';
    // Get baseline_equation from first row if available
    const equation = firstRow['baseline_equation'] || '';

    setRdSending(true);
    try {
      // Send one task per marker (or one combined task if preferred)
      const resp = await createRdBuildLineTask({
        panel_name: panelName,
        lot_no: lotNo,
        marker: markers.length === 1 ? markers[0] : markers.join(', '),
        work_order: lotNo,
        source_fit_id: `${panelName}|${lotNo}|${analyzeDate}`,
        created_by: 'PC Build-Lines',
        fit_data: {
          panel_name: panelName,
          mfg_lot_no: lotNo,
          analyze_date: analyzeDate,
          markers,
          equation,
          row_count: rows.length,
        },
      });
      if (resp.ok) {
        const msg = resp.data?.existing
          ? `此筆已在 RD 待建線清單中 (ID: ${resp.data.task_id})`
          : `已送出 RD 建線任務 · ${panelName} / ${lotNo}`;
        setRdResult({ ok: true, message: msg });
      } else {
        setRdResult({ ok: false, message: resp.error?.message || '送出失敗' });
      }
    } catch {
      setRdResult({ ok: false, message: '網路錯誤' });
    } finally {
      setRdSending(false);
      setTimeout(() => setRdResult(null), 8000);
    }
  };'''

if old_fn in content:
    content = content.replace(old_fn, new_fn)
    with open(PC_PAGE, 'w') as f:
        f.write(content)
    print("✅ Fixed sendToRd function")
else:
    print("❌ Could not find the old sendToRd function to replace")
    print("Trying line-by-line approach...")
    # Try a more flexible match
    lines = content.split('\n')
    start_idx = None
    end_idx = None
    for i, line in enumerate(lines):
        if 'const sendToRd = async () => {' in line:
            start_idx = i
        if start_idx and i > start_idx and line.strip() == '};' and 'sendToRd' not in line:
            # Check if this is the closing of sendToRd (next non-empty line should be const columns or empty)
            for j in range(i+1, min(i+3, len(lines))):
                if 'const columns' in lines[j] or lines[j].strip() == '':
                    end_idx = i
                    break
            if end_idx:
                break
    
    if start_idx is not None and end_idx is not None:
        new_lines = lines[:start_idx] + new_fn.split('\n') + lines[end_idx+1:]
        content = '\n'.join(new_lines)
        with open(PC_PAGE, 'w') as f:
            f.write(content)
        print(f"✅ Fixed sendToRd function (lines {start_idx}-{end_idx})")
    else:
        print(f"❌ Could not locate sendToRd boundaries (start={start_idx}, end={end_idx})")
