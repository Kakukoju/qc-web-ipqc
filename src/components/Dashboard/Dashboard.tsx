import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Package, ClipboardCheck, FlaskConical,
  AlertTriangle, CheckCircle, Zap,
  ArrowRight, TrendingUp, Loader2, RotateCcw
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ReferenceLine
} from 'recharts';
import KpiCard from './KpiCard';
import { useFetch } from '../../api/useFetch';
import {
  fetchBeadStats, fetchKpi, fetchTrend, fetchAnomalies, fetchYears,
  type BeadStat, type KpiData, type TrendRow,
} from '../../api/drbeads';
import { lookupSpec } from '../../api/spec';
import type { SpecRow } from '../../api/spec';

interface DashboardProps { onNavigate: (view: string) => void; onYearChange?: (year: string) => void }

const currentYear = new Date().getFullYear().toString();
const LEVEL_COLORS: Record<string, string> = { l1: '#4DA3FF', l2: '#34D399', n1: '#F97316', n3: '#C084FC' };
const LEVELS = ['l1', 'l2', 'n1', 'n3'] as const;

function parseCvLimit(s: string | null): number | null {
  if (!s) return null;
  const m = s.match(/(\d+(?:\.\d+)?)\s*%/);
  return m ? parseFloat(m[1]) : null;
}
function parseBiasLimit(s: string | null): number | null {
  if (!s) return null;
  const m = s.match(/(\d+(?:\.\d+)?)\s*%/);
  return m ? parseFloat(m[1]) : null;
}

/** Parse "0.033-0.055" → { min: 0.033, max: 0.055 } */
function parseOdRange(s: string | null): { min: number; max: number } | null {
  if (!s) return null;
  const m = s.match(/(\d+\.\d+)\s*[-~]\s*(\d+\.\d+)/);
  return m ? { min: parseFloat(m[1]), max: parseFloat(m[2]) } : null;
}

interface OdRanges { l1: { min: number; max: number } | null; l2: { min: number; max: number } | null }

// ── Hidden lots persistence ──────────────────────────────────────────────
function storageKey(year: string, marker: string) { return `trend.hidden.${year}.${marker}`; }

function loadHidden(year: string, marker: string): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey(year, marker));
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
}
function saveHidden(year: string, marker: string, set: Set<string>) {
  try {
    if (set.size === 0) localStorage.removeItem(storageKey(year, marker));
    else localStorage.setItem(storageKey(year, marker), JSON.stringify([...set]));
  } catch {}
}

// ── Tooltip ──────────────────────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#1A2438] border border-[#2A3754] rounded-lg p-3 text-xs">
      <p className="text-[#93A4C3] mb-1">Lot {label}</p>
      {payload.filter((p: any) => p.value != null).map((p: any, i: number) => (
        <p key={i} style={{ color: p.color }}>{p.name}: {p.value}</p>
      ))}
    </div>
  );
};

function activeLevels(data: TrendRow[], prefix: string): string[] {
  return LEVELS.filter(lv => data.some(r => (r as any)[`${prefix}_${lv}`] != null));
}

// ── Alert dot (with double-click to hide) ────────────────────────────────
function AlertDot({ cx, cy, payload, dataKey, limit, odRanges, onDblClick }: any) {
  if (cx == null || cy == null) return null;
  const val = payload?.[dataKey];
  if (val == null) return null;
  const absVal = Math.abs(val);
  let exceed = limit != null && absVal > limit;
  // OD Mean range check
  if (!exceed && odRanges) {
    const lv = dataKey?.split('_').pop();
    const range = odRanges[lv];
    if (range && (val < range.min || val > range.max)) exceed = true;
  }
  const color = LEVEL_COLORS[dataKey?.split('_').pop()] || '#93A4C3';
  const lot = payload?.lot;
  const handleDblClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (lot && onDblClick) onDblClick(lot);
  };
  return (
    <g onDoubleClick={handleDblClick} style={{ cursor: 'pointer' }}>
      <circle cx={cx} cy={cy} r={10} fill="transparent" />
      {exceed ? (
        <>
          <circle cx={cx} cy={cy} r={6} fill="none" stroke="#FF5C73" strokeWidth={2} />
          <circle cx={cx} cy={cy} r={2.5} fill="#FF5C73" />
          <text x={cx - 14} y={cy - 8} fill="#FF5C73" fontSize={10} fontWeight="bold">⚠</text>
        </>
      ) : (
        <circle cx={cx} cy={cy} r={3} fill={color} />
      )}
    </g>
  );
}

// ── TrendChart ───────────────────────────────────────────────────────────
interface ChartProps {
  title: string;
  data: TrendRow[];
  prefix: string;
  unit?: string;
  limit?: number | null;
  limitLabel?: string;
  odRanges?: OdRanges;
  onDblClickLot: (lot: string) => void;
}

/** Clamp extreme outliers so Y-axis stays readable; returns { data, yDomain } */
function useClampedChart(data: TrendRow[], prefix: string, levels: string[], limit: number | null | undefined, odRanges?: OdRanges) {
  // Visible ceiling = spec limit × 2 (enough room to show exceed dots clearly)
  let ceil = limit != null ? limit * 2 : null;
  if (!ceil && odRanges) {
    const maxOd = Math.max(odRanges.l1?.max ?? 0, odRanges.l2?.max ?? 0);
    if (maxOd > 0) ceil = maxOd * 2;
  }
  if (!ceil) return { data, yDomain: ['auto', 'auto'] as [string, string] };
  const floor = -ceil;
  let needsClamp = false;
  for (const r of data) {
    for (const lv of levels) {
      const v = (r as any)[`${prefix}_${lv}`];
      if (v != null && (v > ceil || v < floor)) { needsClamp = true; break; }
    }
    if (needsClamp) break;
  }
  if (!needsClamp) return { data, yDomain: ['auto', 'auto'] as [string, string] };
  // Clamp to 80% of ceiling so dots sit below the top edge (⚠ icon has room)
  const clampVal = ceil * 0.8;
  const clampFloor = -clampVal;
  const clamped = data.map(r => {
    const row = { ...r } as any;
    for (const lv of levels) {
      const k = `${prefix}_${lv}`;
      if (row[k] != null) row[k] = Math.max(clampFloor, Math.min(clampVal, row[k]));
    }
    return row as TrendRow;
  });
  // Set Y domain with padding above clamp so ⚠ icon is fully visible
  return { data: clamped, yDomain: ['auto', ceil] as [string, number] };
}

function TrendChart({ title, data, prefix, unit = '', limit, limitLabel, odRanges, onDblClickLot }: ChartProps) {
  const levels = activeLevels(data, prefix);
  if (!levels.length) return null;
  const { data: chartData, yDomain } = useClampedChart(data, prefix, levels, limit, odRanges);
  return (
    <div className="mt-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-medium text-[#EAF2FF]">{title}</span>
        {limit != null && <span className="text-[10px] text-[#FF5C73]">Spec: {limitLabel || `<${limit}${unit}`}</span>}
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={chartData} margin={{ top: 18, right: 5, bottom: 0, left: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2A3754" />
          <XAxis dataKey="lot" tick={{ fill: '#93A4C3', fontSize: 9 }} angle={-30} textAnchor="end" height={45} />
          <YAxis tick={{ fill: '#93A4C3', fontSize: 10 }} unit={unit} domain={yDomain as any} />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontSize: 10, color: '#93A4C3' }} />
          {limit != null && <ReferenceLine y={limit} stroke="#FF5C73" strokeDasharray="6 3" />}
          {odRanges?.l1 && <ReferenceLine y={odRanges.l1.min} stroke="#FF5C73" strokeDasharray="4 4" strokeOpacity={0.5} />}
          {odRanges?.l1 && <ReferenceLine y={odRanges.l1.max} stroke="#FF5C73" strokeDasharray="4 4" strokeOpacity={0.5} />}
          {odRanges?.l2 && <ReferenceLine y={odRanges.l2.min} stroke="#FF5C73" strokeDasharray="4 4" strokeOpacity={0.3} />}
          {odRanges?.l2 && <ReferenceLine y={odRanges.l2.max} stroke="#FF5C73" strokeDasharray="4 4" strokeOpacity={0.3} />}
          {levels.map(lv => (
            <Line
              key={lv}
              type="monotone"
              dataKey={`${prefix}_${lv}`}
              name={lv.toUpperCase()}
              stroke={LEVEL_COLORS[lv]}
              strokeWidth={1.5}
              dot={<AlertDot limit={limit} odRanges={odRanges} onDblClick={onDblClickLot} />}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Dashboard ────────────────────────────────────────────────────────────
export default function Dashboard({ onNavigate, onYearChange }: DashboardProps) {
  const [year, setYear] = useState(currentYear);
  const [trendMarker, setTrendMarker] = useState('tCREA');
  const trendRef = useRef<HTMLDivElement>(null);
  const [cvLimit, setCvLimit] = useState<number | null>(null);
  const [biasLimit, setBiasLimit] = useState<number | null>(null);
  const [odRanges, setOdRanges] = useState<OdRanges>({ l1: null, l2: null });
  const [hiddenLots, setHiddenLots] = useState<Set<string>>(new Set());

  const handleYearChange = useCallback((y: string) => { setYear(y); onYearChange?.(y); }, [onYearChange]);

  // Load hidden lots when marker/year changes
  useEffect(() => {
    setHiddenLots(loadHidden(year, trendMarker));
  }, [year, trendMarker]);

  const toggleHideLot = useCallback((lot: string) => {
    setHiddenLots(prev => {
      const next = new Set(prev);
      if (next.has(lot)) next.delete(lot); else next.add(lot);
      saveHidden(year, trendMarker, next);
      return next;
    });
  }, [year, trendMarker]);

  const resetHidden = useCallback(() => {
    setHiddenLots(new Set());
    saveHidden(year, trendMarker, new Set());
  }, [year, trendMarker]);

  const { data: years } = useFetch<string[]>(() => fetchYears(), []);
  const { data: kpi, loading: kpiLoading } = useFetch<KpiData>(() => fetchKpi(year), [year]);
  const { data: beadStats } = useFetch<BeadStat[]>(() => fetchBeadStats(year), [year]);
  const { data: trend } = useFetch<TrendRow[]>(() => fetchTrend(trendMarker, 999, year), [trendMarker, year]);
  const { data: anomalies } = useFetch(() => fetchAnomalies(year), [year]);

  const kpiData = kpi || { total_batches: 0, total_records: 0, passed: 0, ng: 0, markers: 0 };
  const rawTrendData = trend || [];
  const recentAnomalies = anomalies || [];

  // Filter out hidden lots
  const trendData = useMemo(
    () => hiddenLots.size === 0 ? rawTrendData : rawTrendData.filter(r => !hiddenLots.has(r.lot)),
    [rawTrendData, hiddenLots]
  );

  useEffect(() => {
    setCvLimit(null); setBiasLimit(null); setOdRanges({ l1: null, l2: null });
    lookupSpec(trendMarker).then(res => {
      const spec: SpecRow | null = (/^Q/i.test(trendMarker) ? res.qbi : res.p01) || res.p01 || res.qbi || null;
      if (spec) {
        setCvLimit(parseCvLimit(spec.single_cv));
        setBiasLimit(parseBiasLimit(spec.merge_bias));
        setOdRanges({ l1: parseOdRange(spec.spec_l1_od), l2: parseOdRange(spec.spec_l2_od) });
      }
    }).catch(() => {});
  }, [trendMarker]);

  const handleCardClick = useCallback((beadName: string) => {
    setTrendMarker(beadName);
    trendRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  if (kpiLoading) {
    return (
      <div className="flex items-center justify-center h-full gap-2 text-[#93A4C3]">
        <Loader2 size={20} className="animate-spin" /> 載入中...
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full styled-scroll">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#EAF2FF]">Dashboard · {year}-Beads IPQC 總覽</h1>
          <p className="text-sm text-[#93A4C3] mt-0.5">{new Date().toISOString().slice(0, 10)} · 今日生產狀況</p>
        </div>
        <select
          value={year}
          onChange={e => handleYearChange(e.target.value)}
          className="bg-[#0B1220] border border-[#2A3754] rounded-lg px-3 py-1.5 text-sm text-[#4DA3FF] font-bold focus:outline-none focus:border-[#4DA3FF] cursor-pointer"
        >
          {(years || [currentYear]).map(y => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-6 gap-4">
        <KpiCard label="Markers" value={kpiData.markers} icon={<Package size={16} />} delay={0} />
        <KpiCard label="總批次" value={kpiData.total_batches} icon={<ClipboardCheck size={16} />} delay={1} />
        <KpiCard label="總紀錄" value={kpiData.total_records} icon={<FlaskConical size={16} />} delay={2} />
        <KpiCard label="NG 筆數" value={kpiData.ng} icon={<AlertTriangle size={16} />} variant="danger" delay={3} />
        <KpiCard label="PASS" value={kpiData.passed} icon={<CheckCircle size={16} />} variant="success" delay={4} />
        <KpiCard label="異常追蹤" value={(recentAnomalies as any[]).length} icon={<Zap size={16} />} variant={(recentAnomalies as any[]).length > 0 ? 'danger' : undefined} delay={5} />
      </div>

      <div>
        <h2 className="text-sm font-medium text-[#93A4C3] mb-3">Beads 檢驗總覽</h2>
        <div className="grid grid-cols-4 gap-3 sm:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10">
          {(beadStats || []).map((s, i) => (
            <motion.div key={s.bead_name}
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 + i * 0.03 }}
              whileHover={{ y: -3, transition: { duration: 0.15 } }}
              onClick={() => handleCardClick(s.bead_name)}
              onDoubleClick={() => onNavigate('qc')}
              className={`bg-[#121A2B] border rounded-xl p-3 cursor-pointer transition-colors ${trendMarker === s.bead_name ? 'border-[#4DA3FF] bg-[#4DA3FF]/10' : 'border-[#2A3754] hover:border-[#4DA3FF]/50'}`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-[#4DA3FF]">{s.bead_name}</span>
                <ArrowRight size={10} className="text-[#93A4C3]" />
              </div>
              <p className="text-xs text-[#EAF2FF]">{s.sheets} 批</p>
              <div className="flex flex-wrap gap-x-1.5 text-[9px] mt-0.5">
                {s.failed > 0 && <span className="text-[#FF5C73]">NG {s.failed}</span>}
                {s.hold > 0 && <span className="text-[#FFB84D]">Hold {s.hold}</span>}
                {s.pending_insp > 0 && <span className="text-[#A78BFA]">待檢 {s.pending_insp}</span>}
                {s.failed === 0 && s.hold === 0 && s.pending_insp === 0 && <span className="text-[#00D4AA]">OK</span>}
              </div>
              <p className="text-[9px] text-[#3A5070] mt-0.5">{s.last_insp_date?.slice(0, 10) ?? '—'}</p>
            </motion.div>
          ))}
        </div>
      </div>

      <div ref={trendRef}>
        <div className="bg-[#121A2B] border border-[#2A3754] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp size={16} className="text-[#4DA3FF]" />
            <span className="text-sm font-medium text-[#EAF2FF]">批次趨勢</span>
            <span className="text-xs text-[#4DA3FF] bg-[#4DA3FF]/10 px-2 py-0.5 rounded-full">{trendMarker}</span>
            <span className="text-[10px] text-[#93A4C3]">
              {trendData.length}/{rawTrendData.length} 批
              {hiddenLots.size > 0 && ` (隱藏 ${hiddenLots.size})`}
            </span>
            {hiddenLots.size > 0 && (
              <button
                onClick={resetHidden}
                className="flex items-center gap-1 text-[10px] text-[#FFB84D] hover:text-[#FBBF24] transition-colors ml-auto"
              >
                <RotateCcw size={11} /> 顯示全部
              </button>
            )}
          </div>
          <p className="text-[9px] text-[#556A88] mb-1">雙擊圖表上的點可隱藏該批次</p>
          <TrendChart title="OD Mean" data={trendData} prefix="od" odRanges={odRanges} onDblClickLot={toggleHideLot} />
          <TrendChart title="OD CV %" data={trendData} prefix="cv" unit="%" limit={cvLimit} limitLabel={cvLimit != null ? `CV < ${cvLimit}%` : undefined} onDblClickLot={toggleHideLot} />
          <TrendChart title="Conc CV %" data={trendData} prefix="ccv" unit="%" limit={cvLimit} limitLabel={cvLimit != null ? `CV < ${cvLimit}%` : undefined} onDblClickLot={toggleHideLot} />
          <TrendChart title="Bias %" data={trendData} prefix="bias" unit="%" limit={biasLimit} limitLabel={biasLimit != null ? `Bias < ±${biasLimit}%` : undefined} onDblClickLot={toggleHideLot} />
        </div>
      </div>
    </div>
  );
}
