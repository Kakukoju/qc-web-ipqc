import { useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { parseQbiQr } from '../../lib/qbiQrParser';
import { parseWorkOrderQr } from '../../lib/workOrderQrParser';
import { verifyTuttiScan } from '../../lib/tuttiScanVerifier';
import type { ParsedQbiQr } from '../../lib/qbiQrParser';
import type { ParsedWorkOrderQr, TuttiWorkOrder } from '../../lib/tuttiScanTypes';
import { apiUrl } from '../../api/base';
import { MOTION, cardVariants } from './motion-config';
import './styles/skyla-theme.css';
import './styles/skyla-animations.css';
import './styles/skyla-components.css';

// ─── Types ────────────────────────────────────────────────────────────────
interface MachineInfo {
  machineId: string;
  machineName: string;
  deviceSn: string;
  rawQr: string;
}

interface ScanState {
  step: number;
  machine: MachineInfo | null;
  position: string | null;
  workOrder: ParsedWorkOrderQr | null;
  workOrderRaw: string;
  disk: ParsedQbiQr | null;
  diskRaw: string;
  dbWorkOrder: TuttiWorkOrder | null;
  submitting: boolean;
  result: SubmitResult | null;
  error: string | null;
}

interface SubmitResult {
  ok: boolean;
  data?: { id: number; workOrderNumber: string; lotNo: string; diskLotNo: string; position: string; scanTime: string };
  error?: { code: string; message: string; details?: unknown };
}

// ─── Step Config ──────────────────────────────────────────────────────────
const STEPS = [
  { id: 1, label: '機器', icon: '🖥️' },
  { id: 2, label: 'Position', icon: '🎯' },
  { id: 3, label: '工單', icon: '📋' },
  { id: 4, label: 'Disk', icon: '💿' },
  { id: 5, label: '確認', icon: '🛡️' },
  { id: 6, label: '送出', icon: '✅' },
];

const PROMPTS: Record<number, { main: string; sub: string }> = {
  1: { main: '現在請掃描機器 QR', sub: '完成後會記錄本次使用的 Tutti 機台與 Device SN' },
  2: { main: '請選擇 Disk 放置的 Tutti Position', sub: '這會用來記錄後續測試位置' },
  3: { main: '請掃描工單 QR', sub: '系統會取得 WorkOrder、Lot No 與成品批次' },
  4: { main: '請掃描 Disk QR', sub: '系統會解析 Panel、Disk Lot、Marker 與 Well' },
  5: { main: '請確認本次掃描資料', sub: '送出後 backend 會再次驗證工單與 marker 批次' },
  6: { main: '正在建立掃描紀錄', sub: '請不要關閉頁面' },
};

const HINTS: Record<number, string> = {
  1: '提示：請將機器 QR 對準掃描框中央',
  2: '提示：Position 代表 Disk 放入 Tutti 的位置',
  3: '提示：工單 QR 會提供 WorkOrder、Lot No、Batch',
  4: '提示：Disk QR 會解析 Panel、Marker 與 Well',
  5: '提示：送出前請確認 Lot No 與 Disk Lot No 一致',
  6: '提示：送出中，請稍候...',
};

// ─── Machine QR Parser (simple key=value format) ──────────────────────────
function parseMachineQr(raw: string): MachineInfo | null {
  // Expected format: "MachineID=XXX;MachineName=YYY;DeviceSN=ZZZ"
  // or JSON: {"machineId":"...","machineName":"...","deviceSn":"..."}
  try {
    const trimmed = raw.trim();
    if (trimmed.startsWith('{')) {
      const obj = JSON.parse(trimmed);
      return {
        machineId: obj.machineId || obj.machine_id || '',
        machineName: obj.machineName || obj.machine_name || '',
        deviceSn: obj.deviceSn || obj.device_sn || '',
        rawQr: raw,
      };
    }
    // key=value;key=value format
    const parts: Record<string, string> = {};
    trimmed.split(/[;\n]/).forEach(seg => {
      const [k, ...v] = seg.split('=');
      if (k && v.length) parts[k.trim().toLowerCase()] = v.join('=').trim();
    });
    return {
      machineId: parts['machineid'] || parts['machine_id'] || parts['id'] || '',
      machineName: parts['machinename'] || parts['machine_name'] || parts['name'] || '',
      deviceSn: parts['devicesn'] || parts['device_sn'] || parts['sn'] || '',
      rawQr: raw,
    };
  } catch {
    return null;
  }
}

// ─── Initial State ────────────────────────────────────────────────────────
const INITIAL_STATE: ScanState = {
  step: 1,
  machine: null,
  position: null,
  workOrder: null,
  workOrderRaw: '',
  disk: null,
  diskRaw: '',
  dbWorkOrder: null,
  submitting: false,
  result: null,
  error: null,
};

// ═══════════════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════════════
export default function MobileScanPage() {
  const [state, setState] = useState<ScanState>(INITIAL_STATE);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualText, setManualText] = useState('');

  const { step } = state;

  // ─── Step Handlers ────────────────────────────────────────────────────
  const handleMachineQr = useCallback((raw: string) => {
    const machine = parseMachineQr(raw);
    if (!machine || (!machine.machineId && !machine.machineName)) {
      setState(s => ({ ...s, error: '無法解析機器 QR，請重新掃描' }));
      return;
    }
    setState(s => ({ ...s, machine, step: 2, error: null }));
    setManualOpen(false);
    setManualText('');
  }, []);

  const handlePositionSelect = useCallback((pos: string) => {
    setState(s => ({ ...s, position: pos, step: 3, error: null }));
  }, []);

  const handleWorkOrderQr = useCallback(async (raw: string) => {
    const parsed = parseWorkOrderQr(raw);
    if (!parsed.ok) {
      setState(s => ({ ...s, error: `工單 QR 解析失敗: ${parsed.errors.join(', ')}` }));
      return;
    }
    // Fetch work order from DB
    try {
      const res = await fetch(apiUrl(`/v1/tutti-work-orders/${parsed.workOrderNumber}`));
      const json = await res.json();
      if (!json.ok) {
        setState(s => ({ ...s, error: `工單查詢失敗: ${json.error?.message || '未知錯誤'}` }));
        return;
      }
      const dbWo: TuttiWorkOrder = {
        workOrderNumber: json.data.workOrderNumber,
        lotNo: json.data.lotNo,
        finishedBatchNo: json.data.finishedBatchNo,
        markerNames: json.data.markers?.map((m: { markerName: string }) => m.markerName) || [],
      };
      setState(s => ({ ...s, workOrder: parsed, workOrderRaw: raw, dbWorkOrder: dbWo, step: 4, error: null }));
    } catch (err) {
      setState(s => ({ ...s, error: `網路錯誤: ${err instanceof Error ? err.message : '連線失敗'}` }));
    }
    setManualOpen(false);
    setManualText('');
  }, []);

  const handleDiskQr = useCallback((raw: string) => {
    const parsed = parseQbiQr(raw);
    if (!parsed.ok) {
      setState(s => ({ ...s, error: `Disk QR 解析失敗: ${parsed.errors.join(', ')}` }));
      return;
    }
    setState(s => ({ ...s, disk: parsed, diskRaw: raw, step: 5, error: null }));
    setManualOpen(false);
    setManualText('');
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!state.workOrder || !state.disk || !state.machine || !state.position || !state.dbWorkOrder) return;

    // Frontend verification
    const verification = verifyTuttiScan({
      workOrderQr: state.workOrder,
      parsedDisk: state.disk,
      dbWorkOrder: state.dbWorkOrder,
    });

    if (!verification.ok) {
      setState(s => ({ ...s, error: `驗證失敗: ${verification.errors.join(', ')}` }));
      return;
    }

    setState(s => ({ ...s, step: 6, submitting: true, error: null }));

    try {
      const payload = {
        workOrder: {
          workOrderNumber: state.workOrder.workOrderNumber,
          lotNo: state.workOrder.lotNo,
          finishedBatchNo: state.workOrder.finishedBatchNo,
          rawQr: state.workOrderRaw,
        },
        disk: {
          discLotNo: state.disk.lot.discLotNo,
          panelName: state.disk.panel.panelName,
          productionDate: state.disk.production.productionDate,
          expirationDate: state.disk.production.expirationDate,
          markers: state.disk.markerWellMap,
          rawQr: state.diskRaw,
        },
        machine: {
          machineId: state.machine.machineId,
          machineName: state.machine.machineName,
          deviceSn: state.machine.deviceSn,
          rawQr: state.machine.rawQr,
        },
        position: state.position,
        scanTime: new Date().toISOString(),
      };

      const res = await fetch(apiUrl('/v1/tutti-scan-records'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      setState(s => ({ ...s, submitting: false, result: json }));
    } catch (err) {
      setState(s => ({
        ...s,
        submitting: false,
        result: { ok: false, error: { code: 'NETWORK_ERROR', message: err instanceof Error ? err.message : '連線失敗' } },
      }));
    }
  }, [state]);

  const handleReset = useCallback(() => {
    setState(INITIAL_STATE);
    setManualOpen(false);
    setManualText('');
  }, []);

  const handleManualSubmit = useCallback(() => {
    if (!manualText.trim()) return;
    if (step === 1) handleMachineQr(manualText);
    else if (step === 3) handleWorkOrderQr(manualText);
    else if (step === 4) handleDiskQr(manualText);
  }, [step, manualText, handleMachineQr, handleWorkOrderQr, handleDiskQr]);

  const goToStep = useCallback((targetStep: number) => {
    setState(s => ({ ...s, step: targetStep, error: null }));
  }, []);

  // ─── Completed steps ──────────────────────────────────────────────────
  const completedSteps: number[] = [];
  if (state.machine) completedSteps.push(1);
  if (state.position) completedSteps.push(2);
  if (state.workOrder) completedSteps.push(3);
  if (state.disk) completedSteps.push(4);
  if (state.result?.ok) { completedSteps.push(5); completedSteps.push(6); }

  // ─── Render ───────────────────────────────────────────────────────────
  return (
    <div className="skyla-app-shell">
      {/* Header */}
      <header className="skyla-header">
        <div className="skyla-header__top">
          <div className="skyla-header__brand">
            <div className="skyla-header__logo">S</div>
            <div>
              <h1 className="skyla-header__title">Skyla QC Scan</h1>
              <p className="skyla-header__subtitle">掃描建線任務</p>
            </div>
          </div>
          <span className={`skyla-header__badge ${
            state.result?.ok ? 'skyla-header__badge--completed' :
            state.error ? 'skyla-header__badge--error' : ''
          }`}>
            步驟 {step} / 6
          </span>
        </div>
        {!state.result && (
          <p className="skyla-header__prompt">{PROMPTS[step]?.main}</p>
        )}
      </header>

      {/* Step Progress */}
      <div className="skyla-progress">
        {STEPS.map(s => (
          <div key={s.id} className="skyla-progress__step">
            <div className={`skyla-progress__dot ${
              completedSteps.includes(s.id) ? 'skyla-progress__dot--completed' :
              s.id === step ? 'skyla-progress__dot--active' :
              state.error && s.id === step ? 'skyla-progress__dot--error' : ''
            }`}>
              {completedSteps.includes(s.id) ? '✓' : s.icon}
            </div>
            <span className={`skyla-progress__label ${
              s.id === step ? 'skyla-progress__label--active' :
              completedSteps.includes(s.id) ? 'skyla-progress__label--completed' : ''
            }`}>{s.label}</span>
          </div>
        ))}
      </div>

      {/* Main Content */}
      <div className="skyla-app-shell__content">
        {/* Completed Summary Cards */}
        {state.machine && step > 1 && (
          <motion.div variants={cardVariants} initial="hidden" animate="visible" className="skyla-summary-card">
            <div className="skyla-summary-card__header">
              <span className="skyla-summary-card__step">✓ 機器</span>
              <span className="skyla-summary-card__check">✓</span>
            </div>
            <div className="skyla-summary-card__body">
              <span className="skyla-summary-card__label">{state.machine.machineName || state.machine.machineId}</span>
              <span className="skyla-summary-card__value">SN: {state.machine.deviceSn || '—'}</span>
            </div>
          </motion.div>
        )}
        {state.position && step > 2 && (
          <motion.div variants={cardVariants} initial="hidden" animate="visible" className="skyla-summary-card">
            <div className="skyla-summary-card__header">
              <span className="skyla-summary-card__step">✓ Position</span>
              <span className="skyla-summary-card__check">✓</span>
            </div>
            <div className="skyla-summary-card__body">
              <span className="skyla-summary-card__value">Position {state.position}</span>
            </div>
          </motion.div>
        )}
        {state.workOrder && step > 3 && (
          <motion.div variants={cardVariants} initial="hidden" animate="visible" className="skyla-summary-card">
            <div className="skyla-summary-card__header">
              <span className="skyla-summary-card__step">✓ 工單</span>
              <span className="skyla-summary-card__check">✓</span>
            </div>
            <div className="skyla-summary-card__body">
              <span className="skyla-summary-card__label">{state.workOrder.workOrderNumber}</span>
              <span className="skyla-summary-card__value">Lot: {state.workOrder.lotNo}</span>
            </div>
          </motion.div>
        )}
        {state.disk && step > 4 && (
          <motion.div variants={cardVariants} initial="hidden" animate="visible" className="skyla-summary-card">
            <div className="skyla-summary-card__header">
              <span className="skyla-summary-card__step">✓ Disk</span>
              <span className="skyla-summary-card__check">✓</span>
            </div>
            <div className="skyla-summary-card__body">
              <span className="skyla-summary-card__label">{state.disk.lot.discLotNo}</span>
              <span className="skyla-summary-card__value">{state.disk.panel.panelName}</span>
            </div>
          </motion.div>
        )}

        {/* Error Display */}
        {state.error && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: MOTION.duration.fast }}
            className="skyla-status skyla-status--error"
            style={{ marginBottom: 12 }}
          >
            <span className="skyla-status__icon">⚠️</span>
            <p className="skyla-status__message">{state.error}</p>
            <button
              className="skyla-cta-btn skyla-cta-btn--secondary"
              onClick={() => setState(s => ({ ...s, error: null }))}
              style={{ marginTop: 8 }}
            >
              關閉
            </button>
          </motion.div>
        )}

        {/* Step Content */}
        <AnimatePresence mode="wait">
          {/* Step 1: Machine QR */}
          {step === 1 && !state.result && (
            <motion.div key="step1" variants={cardVariants} initial="hidden" animate="visible" exit="exit" className="skyla-mission-card">
              <span className="skyla-mission-card__step-label">STEP 1</span>
              <h2 className="skyla-mission-card__title">掃描機器 QR</h2>
              <p className="skyla-mission-card__instruction">{PROMPTS[1].sub}</p>
              <button className="skyla-cta-btn" onClick={() => setManualOpen(true)}>
                📷 開啟相機掃描
                <span className="skyla-cta-btn__shimmer" />
              </button>
              <ManualInput
                open={manualOpen}
                text={manualText}
                onToggle={() => setManualOpen(!manualOpen)}
                onChange={setManualText}
                onSubmit={handleManualSubmit}
                onClear={() => setManualText('')}
              />
            </motion.div>
          )}

          {/* Step 2: Position */}
          {step === 2 && !state.result && (
            <motion.div key="step2" variants={cardVariants} initial="hidden" animate="visible" exit="exit" className="skyla-mission-card">
              <span className="skyla-mission-card__step-label">STEP 2</span>
              <h2 className="skyla-mission-card__title">選擇 Position</h2>
              <p className="skyla-mission-card__instruction">{PROMPTS[2].sub}</p>
              <div className="skyla-position-grid">
                {['1', '2', '3', '4'].map(pos => (
                  <button
                    key={pos}
                    className={`skyla-position-grid__card ${state.position === pos ? 'skyla-position-grid__card--selected' : ''}`}
                    onClick={() => handlePositionSelect(pos)}
                  >
                    <span className="skyla-position-grid__card-label">Position {pos}</span>
                    <span className="skyla-position-grid__card-sub">Tutti Slot {pos}</span>
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {/* Step 3: Work Order QR */}
          {step === 3 && !state.result && (
            <motion.div key="step3" variants={cardVariants} initial="hidden" animate="visible" exit="exit" className="skyla-mission-card">
              <span className="skyla-mission-card__step-label">STEP 3</span>
              <h2 className="skyla-mission-card__title">掃描工單 QR</h2>
              <p className="skyla-mission-card__instruction">{PROMPTS[3].sub}</p>
              <button className="skyla-cta-btn" onClick={() => setManualOpen(true)}>
                📷 開啟相機掃描
                <span className="skyla-cta-btn__shimmer" />
              </button>
              <ManualInput
                open={manualOpen}
                text={manualText}
                onToggle={() => setManualOpen(!manualOpen)}
                onChange={setManualText}
                onSubmit={handleManualSubmit}
                onClear={() => setManualText('')}
              />
            </motion.div>
          )}

          {/* Step 4: Disk QR */}
          {step === 4 && !state.result && (
            <motion.div key="step4" variants={cardVariants} initial="hidden" animate="visible" exit="exit" className="skyla-mission-card">
              <span className="skyla-mission-card__step-label">STEP 4</span>
              <h2 className="skyla-mission-card__title">掃描 Disk QR</h2>
              <p className="skyla-mission-card__instruction">{PROMPTS[4].sub}</p>
              <button className="skyla-cta-btn" onClick={() => setManualOpen(true)}>
                📷 開啟相機掃描
                <span className="skyla-cta-btn__shimmer" />
              </button>
              <ManualInput
                open={manualOpen}
                text={manualText}
                onToggle={() => setManualOpen(!manualOpen)}
                onChange={setManualText}
                onSubmit={handleManualSubmit}
                onClear={() => setManualText('')}
              />
            </motion.div>
          )}

          {/* Step 5: Review */}
          {step === 5 && !state.result && state.workOrder && state.disk && state.machine && (
            <motion.div key="step5" variants={cardVariants} initial="hidden" animate="visible" exit="exit">
              <ReviewCard
                machine={state.machine}
                position={state.position!}
                workOrder={state.workOrder}
                disk={state.disk}
                dbWorkOrder={state.dbWorkOrder}
                onConfirm={handleSubmit}
                onBack={() => goToStep(4)}
              />
            </motion.div>
          )}

          {/* Step 6: Submitting / Result */}
          {step === 6 && (
            <motion.div key="step6" variants={cardVariants} initial="hidden" animate="visible" exit="exit">
              {state.submitting && (
                <div className="skyla-mission-card" style={{ textAlign: 'center' }}>
                  <div className="skyla-spinner" />
                  <p style={{ color: 'var(--skyla-text-muted)', fontSize: 'var(--skyla-font-size-sm)' }}>
                    正在建立掃描紀錄...
                  </p>
                </div>
              )}
              {state.result?.ok && state.result.data && (
                <div className="skyla-status skyla-status--success">
                  <span className="skyla-status__icon">✅</span>
                  <h3 className="skyla-status__title">建立成功</h3>
                  <div className="skyla-status__details">
                    <div className="skyla-status__detail-row">
                      <span className="skyla-status__detail-label">Scan Record ID</span>
                      <span className="skyla-status__detail-value">{state.result.data.id}</span>
                    </div>
                    <div className="skyla-status__detail-row">
                      <span className="skyla-status__detail-label">WorkOrder</span>
                      <span className="skyla-status__detail-value">{state.result.data.workOrderNumber}</span>
                    </div>
                    <div className="skyla-status__detail-row">
                      <span className="skyla-status__detail-label">Disk Lot</span>
                      <span className="skyla-status__detail-value">{state.result.data.diskLotNo}</span>
                    </div>
                    <div className="skyla-status__detail-row">
                      <span className="skyla-status__detail-label">Position</span>
                      <span className="skyla-status__detail-value">{state.result.data.position}</span>
                    </div>
                    <div className="skyla-status__detail-row">
                      <span className="skyla-status__detail-label">Scan Time</span>
                      <span className="skyla-status__detail-value">{state.result.data.scanTime?.slice(0, 16).replace('T', ' ')}</span>
                    </div>
                  </div>
                  <div className="skyla-status__actions">
                    <button className="skyla-cta-btn" onClick={handleReset}>
                      掃描下一筆
                      <span className="skyla-cta-btn__shimmer" />
                    </button>
                  </div>
                </div>
              )}

              {state.result && !state.result.ok && state.result.error && (
                <div className="skyla-status skyla-status--error">
                  <span className="skyla-status__icon">❌</span>
                  <h3 className="skyla-status__title">建立失敗</h3>
                  <p className="skyla-status__message">
                    錯誤代碼：{state.result.error.code}
                  </p>
                  <p className="skyla-status__message">
                    原因：{state.result.error.message}
                  </p>
                  <div className="skyla-status__actions">
                    <button className="skyla-cta-btn skyla-cta-btn--secondary" onClick={() => goToStep(3)}>
                      回到工單 QR
                    </button>
                    <button className="skyla-cta-btn skyla-cta-btn--secondary" onClick={() => goToStep(4)}>
                      回到 Disk QR
                    </button>
                    <button className="skyla-cta-btn" onClick={handleReset}>
                      重新開始
                      <span className="skyla-cta-btn__shimmer" />
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Bottom Hint Bar */}
      {!state.result && (
        <div className="skyla-hint-bar">
          <p className="skyla-hint-bar__text">
            <span className="skyla-hint-bar__icon">💡</span>
            {HINTS[step]}
          </p>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Sub-Components
// ═══════════════════════════════════════════════════════════════════════════

function ManualInput({ open, text, onToggle, onChange, onSubmit, onClear }: {
  open: boolean;
  text: string;
  onToggle: () => void;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onClear: () => void;
}) {
  return (
    <div className="skyla-manual-panel">
      <button className="skyla-manual-panel__toggle" onClick={onToggle}>
        {open ? '收合手動輸入' : '手動貼上 QR 內容'}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="skyla-manual-panel__body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: MOTION.duration.normal }}
          >
            <textarea
              className="skyla-manual-panel__textarea"
              value={text}
              onChange={e => onChange(e.target.value)}
              placeholder="貼上 QR 內容..."
              rows={4}
            />
            <div className="skyla-manual-panel__actions">
              <button
                className="skyla-manual-panel__btn skyla-manual-panel__btn--submit"
                onClick={onSubmit}
                disabled={!text.trim()}
              >
                解析
              </button>
              <button
                className="skyla-manual-panel__btn skyla-manual-panel__btn--clear"
                onClick={onClear}
              >
                清除
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ReviewCard({ machine, position, workOrder, disk, dbWorkOrder: _dbWorkOrder, onConfirm, onBack }: {
  machine: MachineInfo;
  position: string;
  workOrder: ParsedWorkOrderQr;
  disk: ParsedQbiQr;
  dbWorkOrder: TuttiWorkOrder | null;
  onConfirm: () => void;
  onBack: () => void;
}) {
  // Basic frontend check: lotNo === discLotNo
  const lotMatch = workOrder.lotNo === disk.lot.discLotNo;

  return (
    <div className="skyla-review-card">
      <h3 className="skyla-review-card__title">請確認本次掃描資料</h3>

      <div className="skyla-review-card__section">
        <div className="skyla-review-card__section-title">機器</div>
        <div className="skyla-review-card__row">
          <span className="skyla-review-card__label">Machine Name</span>
          <span className="skyla-review-card__value">{machine.machineName || '—'}</span>
        </div>
        <div className="skyla-review-card__row">
          <span className="skyla-review-card__label">Device SN</span>
          <span className="skyla-review-card__value">{machine.deviceSn || '—'}</span>
        </div>
      </div>

      <div className="skyla-review-card__section">
        <div className="skyla-review-card__section-title">Position</div>
        <div className="skyla-review-card__row">
          <span className="skyla-review-card__label">Position</span>
          <span className="skyla-review-card__value">{position}</span>
        </div>
      </div>

      <div className="skyla-review-card__section">
        <div className="skyla-review-card__section-title">工單</div>
        <div className="skyla-review-card__row">
          <span className="skyla-review-card__label">WorkOrder</span>
          <span className="skyla-review-card__value">{workOrder.workOrderNumber}</span>
        </div>
        <div className="skyla-review-card__row">
          <span className="skyla-review-card__label">Lot No</span>
          <span className="skyla-review-card__value">{workOrder.lotNo}</span>
        </div>
        <div className="skyla-review-card__row">
          <span className="skyla-review-card__label">Batch</span>
          <span className="skyla-review-card__value">{workOrder.finishedBatchNo}</span>
        </div>
      </div>

      <div className="skyla-review-card__section">
        <div className="skyla-review-card__section-title">Disk</div>
        <div className="skyla-review-card__row">
          <span className="skyla-review-card__label">Disk Lot No</span>
          <span className="skyla-review-card__value">{disk.lot.discLotNo}</span>
        </div>
        <div className="skyla-review-card__row">
          <span className="skyla-review-card__label">Panel</span>
          <span className="skyla-review-card__value">{disk.panel.panelName}</span>
        </div>
        <div className="skyla-review-card__row">
          <span className="skyla-review-card__label">Production Date</span>
          <span className="skyla-review-card__value">{disk.production.productionDate}</span>
        </div>
        <div className="skyla-review-card__row">
          <span className="skyla-review-card__label">Expiration Date</span>
          <span className="skyla-review-card__value">{disk.production.expirationDate}</span>
        </div>
      </div>

      <div className="skyla-review-card__section">
        <div className="skyla-review-card__section-title">Markers</div>
        {disk.markerWellMap.filter(m => m.used).map((m, i) => (
          <div key={i} className="skyla-review-card__row">
            <span className="skyla-review-card__label">{m.markerName}</span>
            <span className="skyla-review-card__value">Well {String(m.wellNumber).padStart(2, '0')} / {m.speciesName}</span>
          </div>
        ))}
      </div>

      {/* Lot check */}
      <div className={`skyla-review-card__check ${lotMatch ? 'skyla-review-card__check--pass' : 'skyla-review-card__check--fail'}`}>
        {lotMatch
          ? '✅ 初步檢查通過，送出後 backend 會再次驗證 marker 與 bead batch。'
          : '❌ 工單 Lot No 與 Disk Lot No 不一致，禁止送出。'}
      </div>

      <div className="skyla-review-card__actions">
        <button className="skyla-cta-btn skyla-cta-btn--secondary" onClick={onBack}>
          ← 返回
        </button>
        <button
          className={`skyla-cta-btn ${!lotMatch ? 'skyla-cta-btn--disabled' : ''}`}
          onClick={onConfirm}
          disabled={!lotMatch}
        >
          確認送出
          {lotMatch && <span className="skyla-cta-btn__shimmer" />}
        </button>
      </div>
    </div>
  );
}
