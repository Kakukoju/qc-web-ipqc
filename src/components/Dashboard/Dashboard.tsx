import { motion } from 'framer-motion';
import {
  Package, ClipboardCheck, FlaskConical,
  AlertTriangle, CheckCircle, Zap,
  ArrowRight, Clock, TrendingUp, Loader2
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, BarChart, Bar, Legend
} from 'recharts';
import KpiCard from './KpiCard';
import { useFetch } from '../../api/useFetch';
import {
  fetchBeadStats, fetchKpi, fetchTrend, fetchAnomalies,
  type BeadStat, type KpiData, type TrendRow, type AnomalyRow,
} from '../../api/drbeads';

interface DashboardProps { onNavigate: (view: string) => void }




const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#1A2438] border border-[#2A3754] rounded-lg p-3 text-xs">
      <p className="text-[#93A4C3] mb-1">Lot {label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color }}>{p.name}: {p.value}</p>
      ))}
    </div>
  );
};

export default function Dashboard({ onNavigate }: DashboardProps) {
  const { data: kpi, loading: kpiLoading } = useFetch<KpiData>(() => fetchKpi(), []);
  const { data: beadStats } = useFetch<BeadStat[]>(() => fetchBeadStats(), []);
  const { data: trend } = useFetch<TrendRow[]>(() => fetchTrend('tCREA'), []);
  const { data: anomalies } = useFetch<AnomalyRow[]>(() => fetchAnomalies(), []);

  const kpiData = kpi || { total_batches: 0, total_records: 0, passed: 0, ng: 0, markers: 0 };
  const trendData = trend || [];
  const recentAnomalies = anomalies || [];

  if (kpiLoading) {
    return (
      <div className="flex items-center justify-center h-full gap-2 text-[#93A4C3]">
        <Loader2 size={20} className="animate-spin" /> 載入中...
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div>
        <h1 className="text-xl font-semibold text-[#EAF2FF]">生產 QC 總覽</h1>
        <p className="text-sm text-[#93A4C3] mt-0.5">{new Date().toISOString().slice(0, 10)} · 今日生產狀況</p>
      </div>

      <div className="grid grid-cols-6 gap-4">
        <KpiCard label="Markers" value={kpiData.markers} icon={<Package size={16} />} delay={0} />
        <KpiCard label="總批次" value={kpiData.total_batches} icon={<ClipboardCheck size={16} />} delay={1} />
        <KpiCard label="總紀錄" value={kpiData.total_records} icon={<FlaskConical size={16} />} delay={2} />
        <KpiCard label="NG 筆數" value={kpiData.ng} icon={<AlertTriangle size={16} />} variant="danger" delay={3} />
        <KpiCard label="PASS" value={kpiData.passed} icon={<CheckCircle size={16} />} variant="success" delay={4} />
        <KpiCard label="異常追蹤" value={recentAnomalies.length} icon={<Zap size={16} />} variant={recentAnomalies.length > 0 ? 'danger' : undefined} delay={5} />
      </div>

      <div>
        <h2 className="text-sm font-medium text-[#93A4C3] mb-3">Beads 檢驗總覽</h2>
        <div className="grid grid-cols-4 gap-3 sm:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10">
          {(beadStats || []).map((s, i) => (
            <motion.div key={s.bead_name}
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 + i * 0.03 }}
              whileHover={{ y: -3, transition: { duration: 0.15 } }}
              onClick={() => onNavigate('qc')}
              className="bg-[#121A2B] border border-[#2A3754] rounded-xl p-3 cursor-pointer hover:border-[#4DA3FF]/50 transition-colors"
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

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 bg-[#121A2B] border border-[#2A3754] rounded-xl p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <TrendingUp size={16} className="text-[#4DA3FF]" />
              <span className="text-sm font-medium text-[#EAF2FF]">批次趨勢</span>
            </div>
            <div className="flex gap-2">
              {['OD Mean', 'CV %', 'Bias %'].map((t) => (
                <button key={t} className="text-xs px-2 py-1 rounded-md bg-[#1A2438] text-[#93A4C3] hover:text-[#EAF2FF] transition-colors">{t}</button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2A3754" />
              <XAxis dataKey="lot" tick={{ fill: '#93A4C3', fontSize: 11 }} />
              <YAxis tick={{ fill: '#93A4C3', fontSize: 11 }} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11, color: '#93A4C3' }} />
              <Line type="monotone" dataKey="odMean" name="OD Mean" stroke="#4DA3FF" strokeWidth={2} dot={{ fill: '#4DA3FF', r: 3 }} />
              <Line type="monotone" dataKey="cv" name="CV %" stroke="#FFB84D" strokeWidth={2} dot={{ fill: '#FFB84D', r: 3 }} />
              <Line type="monotone" dataKey="bias" name="Bias %" stroke="#00D4AA" strokeWidth={2} dot={{ fill: '#00D4AA', r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-[#121A2B] border border-[#2A3754] rounded-xl p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-[#FF5C73]" />
              <span className="text-sm font-medium text-[#EAF2FF]">最新異常</span>
            </div>
            <button className="text-xs text-[#4DA3FF] hover:underline">查看全部</button>
          </div>
          <div className="space-y-3">
            {recentAnomalies.map((a) => (
              <motion.div key={a.id} whileHover={{ x: 2 }}
                className="flex items-start gap-3 p-2 rounded-lg hover:bg-[#1A2438] cursor-pointer transition-colors">
                <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${a.status === 'OPEN' ? 'bg-[#FF5C73] pulse-ng' : a.status === 'IN_REVIEW' ? 'bg-[#FFB84D]' : 'bg-[#93A4C3]'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-[#EAF2FF] truncate">{a.type}</p>
                  <p className="text-xs text-[#93A4C3]">{a.description}</p>
                </div>
                <div className="text-right shrink-0">
                  <div className="flex items-center gap-1 text-xs text-[#93A4C3]">
                    <Clock size={10} />
                    <span>{a.created_at?.slice(0, 10)}</span>
                  </div>
                  <span className={`text-xs ${a.status === 'OPEN' ? 'text-[#FF5C73]' : a.status === 'IN_REVIEW' ? 'text-[#FFB84D]' : 'text-[#93A4C3]'}`}>
                    {a.status === 'OPEN' ? '待處理' : a.status === 'IN_REVIEW' ? '審查中' : '已關閉'}
                  </span>
                </div>
              </motion.div>
            ))}
            {recentAnomalies.length === 0 && <p className="text-xs text-[#93A4C3] text-center py-4">暫無異常</p>}
          </div>

          <div className="mt-4 pt-4 border-t border-[#2A3754]">
            <p className="text-xs text-[#93A4C3] mb-2">本月 PASS / NG 比例</p>
            <ResponsiveContainer width="100%" height={80}>
              <BarChart data={trendData} barSize={16}>
                <XAxis dataKey="lot" tick={{ fill: '#93A4C3', fontSize: 10 }} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="pass" name="PASS" fill="#00D4AA" radius={[2, 2, 0, 0]} />
                <Bar dataKey="ng" name="NG" fill="#FF5C73" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
