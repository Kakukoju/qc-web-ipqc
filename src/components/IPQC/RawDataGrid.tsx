/**
 * RawDataGrid – Excel-like grid for one table_type (well_od | od_corrected | ind_batch | all_batch).
 *
 * Grid layout:
 *   Row 0-2  : 3 meta header rows (channel type / formula / dilution from rawdata_meta)
 *   Row 3    : column label row  (CS Type | Lot | 機台 | W2 … W19)
 *   Row 4+   : data rows  (level groups, 8 combos each)
 *
 * Columns (21 total):
 *   0 : CS Type  (level label, first row per level only)
 *   1 : Lot      (lot_id)
 *   2 : 機台     (ctrl_lot)
 *   3-20 : W2 … W19
 *
 * Interactions: click-select · shift-click range · Ctrl+C copy TSV · Ctrl+V paste
 *               double-click edit · type-to-edit · Enter/Tab confirm · Esc cancel
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Settings, Upload } from 'lucide-react';
import type { RawDataRow, ColMeta } from '../../api/rawdata';
import { fetchCalRules, fetchCsAssign, fetchP01PN, type CalRule, type CsAssignRow } from '../../api/rawdata';
import WellConfigModal from './WellConfigModal';
import LoadCsvModal from './LoadCsvModal';

// ── Constants ──────────────────────────────────────────────────────────────

const WELL_FIELDS = [
  'w2','w3','w4','w5','w6','w7','w8','w9',
  'w10','w11','w12','w13','w14','w15','w16','w17','w18','w19',
] as const;
const WELL_LABELS = ['W2','W3','W4','W5','W6','W7','W8','W9','W10','W11','W12','W13','W14','W15','W16','W17','W18','W19'];

const N_HDR = 4;     // 3 meta rows + 1 label row = first data row is index 4
const N_COLS = 21;   // 3 fixed + 18 wells

type TableType = 'well_od' | 'od_corrected' | 'ind_batch' | 'all_batch';

interface Pos { r: number; c: number }
interface Sel { r1: number; c1: number; r2: number; c2: number }

function nrm(s: Sel): Sel {
  return { r1: Math.min(s.r1,s.r2), c1: Math.min(s.c1,s.c2), r2: Math.max(s.r1,s.r2), c2: Math.max(s.c1,s.c2) };
}
function inSel(s: Sel | null, r: number, c: number): boolean {
  if (!s) return false;
  const n = nrm(s);
  return r >= n.r1 && r <= n.r2 && c >= n.c1 && c <= n.c2;
}

// ── Lot parsing ────────────────────────────────────────────────────────────


/** Column header and label names for each reagent slot. */
function reagentLabels(n: number): string[] {
  if (n === 1) return ['Lot'];
  if (n === 2) return ['D-Lot', 'U-Lot'];
  if (n === 3) return ['d-Lot', 'D-Lot', 'U-Lot'];
  return Array.from({ length: n }, (_, i) => `R${i + 1}-Lot`);
}

// ── Props ──────────────────────────────────────────────────────────────────

interface Props {
  tableType: TableType;
  rows: RawDataRow[];
  meta: ColMeta[];
  beadName: string;
  nReagents: number;
  onRowChange: (updated: RawDataRow) => void;
  onBatchChange?: (updates: RawDataRow[]) => void;
  onMetaChange?: (newMeta: ColMeta[]) => void;
  onRefresh?: () => void;
  saving: boolean;
  dirtyCount: number;
  onSave: () => void;
}

// ── Grid cell helpers ──────────────────────────────────────────────────────

function getField(col: number): keyof RawDataRow | null {
  if (col === 0) return null;       // level label – non-editable
  if (col === 1) return 'lot_id';   // lot column – special handling for multi-reagent
  if (col === 2) return 'ctrl_lot';
  return WELL_FIELDS[col - 3] as keyof RawDataRow;
}


function fmtCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') {
    // show up to 6 significant digits without trailing zeros
    return parseFloat(v.toPrecision(6)).toString();
  }
  return String(v);
}

// ── Component ──────────────────────────────────────────────────────────────

export default function RawDataGrid({ tableType, rows, meta, beadName, nReagents, onRowChange, onBatchChange, onMetaChange, onRefresh, saving, dirtyCount, onSave }: Props) {
  const [showWellConfig, setShowWellConfig] = useState(false);
  const [showLoadCsv, setShowLoadCsv] = useState(false);
  const [calRules, setCalRules] = useState<CalRule[]>([]);
  const [csData, setCsData] = useState<CsAssignRow[]>([]);
  const [p01pnList, setP01pnList] = useState<string[]>([]);

  useEffect(() => {
    fetchCalRules().then(setCalRules).catch(() => {});
    fetchCsAssign().then(d => { if (Array.isArray(d)) setCsData(d); }).catch(() => {});
    fetchP01PN().then(setP01pnList).catch(() => {});
  }, []);
  // filter rows for this tableType, sorted by level appearance order then combo_idx
  // Only show rows that have actual well data (any well field non-null)
  const typeRows = rows.filter(r => r.table_type === tableType);
  const levelOrder = new Map<string, number>();
  typeRows.forEach(r => { if (!levelOrder.has(r.level)) levelOrder.set(r.level, levelOrder.size); });
  // Determine which combo_idx have data in ANY level of this tableType
  const combosWithData = new Set<number>();
  typeRows.forEach(r => {
    if (WELL_FIELDS.some(f => (r as any)[f] !== null)) combosWithData.add(r.combo_idx);
  });
  const filtered = typeRows
    .filter(r => combosWithData.size === 0 || combosWithData.has(r.combo_idx))
    .sort((a, b) => (levelOrder.get(a.level) ?? 99) - (levelOrder.get(b.level) ?? 99) || a.combo_idx - b.combo_idx);

  // meta: use well_od meta for all 4 tabs (row1~row3 well mapping is the same)
  const tableMeta = meta.filter(m => m.table_type === 'well_od');

  // local editable copy
  const [localRows, setLocalRows] = useState<RawDataRow[]>(filtered);
  useEffect(() => setLocalRows(filtered), [rows, tableType]); // reset on prop change

  // selection / edit state
  const [sel, setSel] = useState<Sel | null>(null);
  const [anchor, setAnchor] = useState<Pos | null>(null);
  const [editing, setEditing] = useState<Pos | null>(null);
  const [editVal, setEditVal] = useState('');
  const dragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Accessors ────────────────────────────────────────────────────────────

  function getMetaVal(col: number, metaRow: 0 | 1 | 2): string {
    if (col < 3) return '';
    const well = WELL_LABELS[col - 3];
    const m = tableMeta.find(x => x.well === well);
    if (!m) return '';
    return [m.row1, m.row2, m.row3][metaRow] ?? '';
  }

  // tASTi has a special well layout: W2, (empty), (empty), W7-W19, W21, W22
  const TASTI_LABELS = ['W2','','','W7','W8','W9','W10','W11','W12','W13','W14','W15','W16','W17','W18','W19','W21','W22'];

  // Lot column header: show reagent labels joined
  const lotColHeader = nReagents > 1
    ? reagentLabels(nReagents).join(' / ')
    : 'Lot';
  const lotColTitle = 'Tab：帶入預設 Lot（從 Well OD 同批號）';

  function getCellValue(gridRow: number, col: number): string {
    if (gridRow < 3) return getMetaVal(col, gridRow as 0|1|2);
    if (gridRow === 3) {
      const hdr = ['CS Type', lotColHeader, '機台', ...(beadName === 'tASTi' ? TASTI_LABELS : WELL_LABELS)];
      return hdr[col] ?? '';
    }

    const dataIdx = gridRow - N_HDR;
    const row = localRows[dataIdx];
    if (!row) return '';

    if (col === 0) {
      if (dataIdx === 0) return row.level;
      return localRows[dataIdx - 1]?.level !== row.level ? row.level : '';
    }
    if (col === 1) {
      // Multi-reagent: show individual d_lot/bigD_lot/u_lot fields
      if (nReagents >= 2) {
        const labels = reagentLabels(nReagents);
        const fields: (keyof RawDataRow)[] = nReagents === 3
          ? ['d_lot', 'bigD_lot', 'u_lot']
          : ['bigD_lot', 'u_lot'];
        return fields.map((f, i) => `${labels[i]}: ${row[f] ?? ''}`).join('\n');
      }
      return row.lot_id ?? '';
    }
    const field = getField(col);
    if (!field) return '';
    return fmtCell(row[field] as string | number | null);
  }

  function getDataRow(dataIdx: number): RawDataRow | undefined {
    return localRows[dataIdx];
  }

  // ── Commit edit ──────────────────────────────────────────────────────────

  const commitEdit = useCallback((useDefaultLot = false, overrideVal?: string) => {
    if (!editing) return;
    const { r, c } = editing;
    const dataIdx = r - N_HDR;
    const row = localRows[dataIdx];
    if (!row) { setEditing(null); return; }
    const field = getField(c);
    if (!field) { setEditing(null); return; }

    let trimmed = (overrideVal !== undefined ? overrideVal : editVal).trim();

    // Tab on empty lot_id → fill from well_od row with same combo_idx
    if (useDefaultLot && field === 'lot_id' && trimmed === '') {
      const src = rows.find(r2 => r2.table_type === 'well_od' && r2.combo_idx === row.combo_idx);
      if (src) {
        if (nReagents >= 2) {
          // Copy individual lot fields
          const updated = { ...row, d_lot: src.d_lot, bigD_lot: src.bigD_lot, u_lot: src.u_lot,
            lot_id: [src.d_lot, src.bigD_lot, src.u_lot].filter(Boolean).join('') || null };
          setLocalRows(prev => prev.map(r2 => r2.id === updated.id ? updated : r2));
          onRowChange(updated);
          setEditing(null);
          return;
        }
        trimmed = src.lot_id?.trim() ?? '';
      }
    }

    // Multi-reagent lot editing: value is "D-lot\nU-lot" or "d-lot\nD-lot\nU-lot"
    if (field === 'lot_id' && nReagents >= 2) {
      const lines = trimmed.split(/[\n,\/]/).map(s => s.replace(/^[^:]*:\s*/, '').trim());
      const fields: (keyof RawDataRow)[] = nReagents === 3
        ? ['d_lot', 'bigD_lot', 'u_lot']
        : ['bigD_lot', 'u_lot'];
      const updated = { ...row };
      fields.forEach((f, i) => { (updated as any)[f] = lines[i] || null; });
      updated.lot_id = fields.map(f => (updated as any)[f]).filter(Boolean).join('') || null;
      setLocalRows(prev => prev.map(r2 => r2.id === updated.id ? updated : r2));
      onRowChange(updated);
      setEditing(null);
      return;
    }

    let newVal: string | number | null;
    if (trimmed === '' || trimmed === '-') {
      newVal = null;
    } else if (c >= 3) {
      const n = parseFloat(trimmed);
      newVal = isNaN(n) ? trimmed : n;
    } else {
      newVal = trimmed;
    }

    // 機台 (ctrl_lot) changed → propagate to all rows with same combo_idx in this sheet
    if (field === 'ctrl_lot' && onBatchChange) {
      const allSheetRows = rows.filter(r2 => r2.combo_idx === row.combo_idx);
      const updates = allSheetRows.map(r2 => ({ ...r2, ctrl_lot: newVal as string | null }));
      const map = new Map(updates.map(u => [u.id, u]));
      setLocalRows(prev => prev.map(r2 => map.get(r2.id) ?? r2));
      onBatchChange(updates);
    } else {
      const updated = { ...row, [field]: newVal };
      setLocalRows(prev => prev.map(r2 => r2.id === updated.id ? updated : r2));
      onRowChange(updated);
    }
    setEditing(null);
  }, [editing, editVal, localRows, rows, onRowChange, onBatchChange]);

  // ── Selection helpers ─────────────────────────────────────────────────────

  function startEdit(r: number, c: number, initVal?: string) {
    if (r < N_HDR) return;  // header rows not editable
    if (c === 0) return;     // level column not editable
    const row = getDataRow(r - N_HDR);
    if (!row) return;
    const val = initVal !== undefined ? initVal : getCellValue(r, c);
    setEditing({ r, c });
    setEditVal(val);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  function handleMouseDown(r: number, c: number, e: React.MouseEvent) {
    if (editing) commitEdit();
    e.preventDefault();
    dragging.current = true;
    const pos: Pos = { r, c };
    if (e.shiftKey && anchor) {
      setSel({ r1: anchor.r, c1: anchor.c, r2: r, c2: c });
    } else {
      setAnchor(pos);
      setSel({ r1: r, c1: c, r2: r, c2: c });
    }
    containerRef.current?.focus();
  }

  function handleMouseEnter(r: number, c: number) {
    if (!dragging.current || !anchor) return;
    setSel({ r1: anchor.r, c1: anchor.c, r2: r, c2: c });
  }

  function handleMouseUp() { dragging.current = false; }

  function handleDoubleClick(r: number, c: number) {
    startEdit(r, c);
  }

  // Dedicated keydown for the edit <input> – handles Enter / Tab / Escape only.
  // Tab with empty lot_id → fill from well_od row of same combo_idx.
  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>) {
    if (e.key === 'Escape') { e.preventDefault(); setEditing(null); return; }
    if (e.key === 'Enter')  { e.preventDefault(); commitEdit(false); moveSel(1, 0);                   return; }
    if (e.key === 'Tab')    { e.preventDefault(); commitEdit(true);  moveSel(0, e.shiftKey ? -1 : 1); return; }
  }

  // ── Keyboard ─────────────────────────────────────────────────────────────

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (editing) return; // Enter/Tab/Escape are handled by handleInputKeyDown on the <input>

    const nRows = N_HDR + localRows.length;

    // Copy
    if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
      e.preventDefault();
      if (!sel) return;
      const s = nrm(sel);
      const lines: string[] = [];
      for (let r = s.r1; r <= s.r2; r++) {
        const cols: string[] = [];
        for (let c = s.c1; c <= s.c2; c++) cols.push(getCellValue(r, c));
        lines.push(cols.join('\t'));
      }
      navigator.clipboard.writeText(lines.join('\n')).catch(() => {});
      return;
    }

    // Paste
    if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
      e.preventDefault();
      navigator.clipboard.readText().then(text => {
        if (!anchor) return;
        const pastedRows = text.replace(/\r/g, '').split('\n').filter(Boolean);
        const updates = new Map<number, Partial<RawDataRow>>();
        pastedRows.forEach((line, ri) => {
          const gr = anchor.r + ri;
          if (gr < N_HDR || gr >= nRows) return;
          line.split('\t').forEach((val, ci) => {
            const gc = anchor.c + ci;
            if (gc >= N_COLS) return;
            const field = getField(gc);
            if (!field) return;
            const dataIdx = gr - N_HDR;
            const row = localRows[dataIdx];
            if (!row) return;
            const trimmed = val.trim();
            const newVal: string | number | null = trimmed === '' ? null
              : gc >= 3 ? (isNaN(parseFloat(trimmed)) ? trimmed : parseFloat(trimmed))
              : trimmed;
            if (!updates.has(row.id)) updates.set(row.id, {});
            updates.get(row.id)![field] = newVal as never;
          });
        });
        updates.forEach((changes, id) => {
          const row = localRows.find(r => r.id === id);
          if (!row) return;
          const updated = { ...row, ...changes };
          setLocalRows(prev => prev.map(r => r.id === id ? updated : r));
          onRowChange(updated);
        });
      }).catch(() => {});
      return;
    }

    // Save
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      onSave();
      return;
    }

    // Delete / Backspace → clear
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!sel) return;
      const s = nrm(sel);
      const updates = new Map<number, Partial<RawDataRow>>();
      for (let r = s.r1; r <= s.r2; r++) {
        if (r < N_HDR) continue;
        const dataIdx = r - N_HDR;
        const row = localRows[dataIdx];
        if (!row) continue;
        for (let c = s.c1; c <= s.c2; c++) {
          const field = getField(c);
          if (!field) continue;
          if (!updates.has(row.id)) updates.set(row.id, {});
          updates.get(row.id)![field] = null as never;
        }
      }
      updates.forEach((changes, id) => {
        const row = localRows.find(r => r.id === id);
        if (!row) return;
        const updated = { ...row, ...changes };
        setLocalRows(prev => prev.map(r => r.id === id ? updated : r));
        onRowChange(updated);
      });
      return;
    }

    // Start editing by typing
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      if (!anchor || anchor.r < N_HDR) return;
      startEdit(anchor.r, anchor.c, e.key);
      return;
    }

    // Arrow navigation
    if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter','Tab'].includes(e.key)) return;
    e.preventDefault();
    if (e.key === 'Enter') { if (anchor) startEdit(anchor.r, anchor.c); return; }
    const dy = e.key === 'ArrowDown' || e.key === 'Enter' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    const dx = e.key === 'ArrowRight' || e.key === 'Tab' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    moveSel(dy, dx, e.shiftKey);
  }, [editing, sel, anchor, localRows, commitEdit, onSave]);  // eslint-disable-line

  function moveSel(dy: number, dx: number, extend = false) {
    const nRows = N_HDR + localRows.length;
    setAnchor(prev => {
      if (!prev && !sel) return prev;
      const base = extend && sel ? { r: nrm(sel).r2, c: nrm(sel).c2 } : (prev || { r: N_HDR, c: 0 });
      const nr = Math.max(0, Math.min(nRows - 1, base.r + dy));
      const nc = Math.max(0, Math.min(N_COLS - 1, base.c + dx));
      const newPos: Pos = { r: nr, c: nc };
      if (extend && sel) {
        setSel({ r1: (anchor || prev)!.r, c1: (anchor || prev)!.c, r2: nr, c2: nc });
        return anchor || prev;
      }
      setSel({ r1: nr, c1: nc, r2: nr, c2: nc });
      return newPos;
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const nRows = N_HDR + localRows.length;

  // Determine which rows are "level start" for styling
  const levelStarts = new Set<number>();
  localRows.forEach((row, i) => {
    if (i === 0 || localRows[i-1].level !== row.level) levelStarts.add(i);
  });

  const lotColWidth = nReagents === 3 ? 210 : nReagents === 2 ? 190 : 160;

  const C = {
    // Cell styles
    base: { fontSize: 11, padding: '2px 4px', whiteSpace: 'nowrap' as const, borderRight: '1px solid #2A3754', borderBottom: '1px solid #2A3754', cursor: 'default', userSelect: 'none' as const, position: 'relative' as const },
    hdr: { background: '#0e2346', color: '#7BA8D4', fontWeight: 600, textAlign: 'center' as const },
    metaHdr: { background: '#091b36', color: '#556A88', textAlign: 'center' as const, fontStyle: 'italic' as const },
    label: { background: '#0d1f3a', color: '#93A4C3', textAlign: 'center' as const },
    data: { background: '#0B1728', color: '#D4E8FF' },
    levelLabel: { background: '#0e2346', color: '#4DA3FF', fontWeight: 600, textAlign: 'center' as const },
    levelBorder: { borderTop: '1px solid #3A5070' },
    sel: { background: 'rgba(77,163,255,0.18)', outline: '1px solid #4DA3FF' },
    anchor: { outline: '2px solid #4DA3FF' },
    editing: { background: '#0A1525', padding: 0 },
  };

  function cellStyle(r: number, c: number): React.CSSProperties {
    const isSelected = inSel(sel, r, c);
    const isAnchor = anchor?.r === r && anchor?.c === c;
    const isEditing = editing?.r === r && editing?.c === c;

    let style: React.CSSProperties = { ...C.base };

    if (r < 3)   style = { ...style, ...C.metaHdr };
    else if (r === 3) style = { ...style, ...C.hdr };
    else {
      const dataIdx = r - N_HDR;
      if (c === 0) style = { ...style, ...C.levelLabel };
      else         style = { ...style, ...C.data };
      if (levelStarts.has(dataIdx) && r > N_HDR) style = { ...style, ...C.levelBorder };
    }

    if (isSelected) style = { ...style, ...C.sel };
    if (isAnchor)   style = { ...style, ...C.anchor };
    if (isEditing)  style = { ...style, ...C.editing };

    return style;
  }

  const colWidths = [
    80,             // CS Type
    lotColWidth,    // lot_id (wider for multi-reagent)
    130,            // ctrl_lot
    ...Array(18).fill(52),  // W2..W19
  ];

  return (
    <div className="flex flex-col h-full gap-2">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-1 shrink-0">
        <div className="text-xs text-[#556A88]">
          {localRows.length} 筆資料 · {localRows.filter((_, i) => levelStarts.has(i)).length} 個 Level
        </div>
        <div className="flex items-center gap-2">
          {dirtyCount > 0 && (
            <span className="text-xs text-[#FFB84D]">{dirtyCount} 筆已修改</span>
          )}
          <button
            onClick={() => setShowWellConfig(true)}
            className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors
              bg-[#4DA3FF]/10 border border-[#4DA3FF]/30 text-[#4DA3FF] hover:bg-[#4DA3FF]/20"
          >
            <Settings size={11} /> 修改 Well 配置
          </button>
          {/* Load CSV: only on well_od for normal markers, only on od_corrected for tCREA */}
          {((beadName === 'tCREA' && tableType === 'od_corrected') ||
            (beadName !== 'tCREA' && tableType === 'well_od')) && (
            <button
              onClick={() => setShowLoadCsv(true)}
              className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors
                bg-[#A78BFA]/10 border border-[#A78BFA]/30 text-[#A78BFA] hover:bg-[#A78BFA]/20"
            >
              <Upload size={11} /> Load CSV
            </button>
          )}
          <button
            onClick={onSave}
            disabled={saving || dirtyCount === 0}
            className="flex items-center gap-1 px-3 py-1 rounded text-xs font-medium transition-colors
              disabled:opacity-40 disabled:cursor-not-allowed
              bg-[#00D4AA]/10 border border-[#00D4AA]/30 text-[#00D4AA] hover:bg-[#00D4AA]/20"
          >
            {saving ? '儲存中…' : '儲存 (Ctrl+S)'}
          </button>
        </div>
      </div>

      {/* Grid */}
      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        className="flex-1 overflow-auto outline-none border border-[#1E3050] rounded"
        style={{ background: '#070F1C' }}
      >
        <table
          style={{
            borderCollapse: 'collapse',
            tableLayout: 'fixed',
            minWidth: colWidths.reduce((a, b) => a + b, 0),
          }}
        >
          <colgroup>
            {colWidths.map((w, i) => <col key={i} style={{ width: w }} />)}
          </colgroup>
          <tbody>
            {Array.from({ length: nRows }, (_, r) => (
              <tr key={r}>
                {Array.from({ length: N_COLS }, (_, c) => {
                  const isEdit = editing?.r === r && editing?.c === c;
                  const val = getCellValue(r, c);
                  // Lot column for multi-reagent: allow line breaks
                  const isMultiLineLot = c === 1 && nReagents > 1 && r >= N_HDR;
                  const tdStyle = isMultiLineLot
                    ? { ...cellStyle(r, c), whiteSpace: 'pre-line' as const, lineHeight: 1.4 }
                    : cellStyle(r, c);
                  return (
                    <td
                      key={c}
                      style={tdStyle}
                      onMouseDown={e => handleMouseDown(r, c, e)}
                      onMouseEnter={() => handleMouseEnter(r, c)}
                      onDoubleClick={() => handleDoubleClick(r, c)}
                    >
                      {isEdit ? (
                        c === 2 && r >= N_HDR && p01pnList.length > 0 ? (
                          <div style={{ position: 'relative' }}>
                            <select
                              value={editVal}
                              onChange={e => {
                                const v = e.target.value;
                                setEditVal(v);
                                commitEdit(false, v);
                              }}
                              onMouseDown={e => e.stopPropagation()}
                              onClick={e => e.stopPropagation()}
                              onKeyDown={e => {
                                e.stopPropagation();
                                if (e.key === 'Escape') { e.preventDefault(); setEditing(null); }
                              }}
                              style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                zIndex: 50,
                                width: 180,
                                background: '#1A3060',
                                color: '#EAF2FF',
                                border: '1px solid #4DA3FF',
                                fontSize: 11,
                                outline: 'none',
                              }}
                              autoFocus
                              size={Math.min(p01pnList.length + 1, 12)}
                            >
                              <option value="">-- 選擇機台 --</option>
                              {p01pnList.map(pn => <option key={pn} value={pn}>{pn}</option>)}
                            </select>
                          </div>
                        ) : (
                        <input
                          ref={inputRef}
                          value={editVal}
                          onChange={e => setEditVal(e.target.value)}
                          onKeyDown={handleInputKeyDown}
                          onBlur={() => commitEdit(false)}
                          style={{
                            width: '100%',
                            background: '#1A3060',
                            color: '#EAF2FF',
                            border: '1px solid #4DA3FF',
                            fontSize: 11,
                            padding: '2px 4px',
                            outline: 'none',
                          }}
                          autoFocus
                        />)
                      ) : r === 3 && c === 1 ? (
                        <span title={lotColTitle} style={{ cursor: 'help', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
                          {val}
                          <span style={{ fontSize: 9, color: '#3A5070', lineHeight: 1 }}>↹</span>
                        </span>
                      ) : (
                        <span>{val}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showWellConfig && (
        <WellConfigModal
          beadName={beadName}
          meta={meta}
          onSaved={newMeta => onMetaChange?.(newMeta)}
          onClose={() => setShowWellConfig(false)}
        />
      )}
      {showLoadCsv && (
        <LoadCsvModal
          levels={[...levelOrder.keys()]}
          meta={meta}
          calRules={calRules}
          csData={csData}
          rows={rows}
          tableType={tableType}
          beadName={beadName}
          onApply={updates => {
            if (onBatchChange) {
              onBatchChange(updates);
            } else {
              for (const u of updates) onRowChange(u);
            }
            const map = new Map(updates.map(u => [u.id, u]));
            setLocalRows(prev => prev.map(r => map.get(r.id) ?? r));
          }}
          onClose={() => setShowLoadCsv(false)}
          onRefresh={onRefresh}
        />
      )}
    </div>
  );
}
