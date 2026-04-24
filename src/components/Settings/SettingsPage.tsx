import { useState, Suspense, lazy } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileSpreadsheet, Grid3x3, Beaker, Cpu,
  Database, Info, ChevronLeft,
} from 'lucide-react';
import SpecManager from './SpecManager';
const CsManager = lazy(() => import('./CsManager'));
const MachineManager = lazy(() => import('./MachineManager'));
const WellManager = lazy(() => import('./WellManager'));

interface CardDef {
  id: string;
  icon: React.ReactNode;
  label: string;
  desc: string;
  ready: boolean;
}

const cards: CardDef[] = [
  {
    id: 'spec',
    icon: <FileSpreadsheet size={28} />,
    label: 'QC 規格管理',
    desc: '上傳 P01 / Qbi QC SPEC Excel，更新 Bead 允收 & 併批標準',
    ready: true,
  },
  {
    id: 'well',
    icon: <Grid3x3 size={28} />,
    label: 'Well 填藥配置',
    desc: '管理各 marker 的 well position 模板與填藥位置設定，用於 OD 濃度計算與列印頁填藥位置',
    ready: true,
  },
  {
    id: 'cs',
    icon: <Beaker size={28} />,
    label: 'CS 濃度設定',
    desc: '管理 CS assign 標準品濃度對照表、批號效期，用於 IPQC 計算與列印',
    ready: true,
  },
  {
    id: 'pn',
    icon: <Cpu size={28} />,
    label: '機台 P/N 管理',
    desc: '管理各機台 (P01 / Tutti) part number 清單，供下拉選單使用',
    ready: true,
  },
  {
    id: 'db',
    icon: <Database size={28} />,
    label: '資料庫管理',
    desc: 'DB 狀態總覽、資料備份與匯出功能',
    ready: false,
  },
  {
    id: 'info',
    icon: <Info size={28} />,
    label: '系統資訊',
    desc: '版本資訊、API 連線狀態、系統健康檢查',
    ready: false,
  },
];

export default function SettingsPage() {
  const [activeCard, setActiveCard] = useState<string | null>(null);
  const [hoveredCard, setHoveredCard] = useState<string | null>(null);

  if (activeCard) {
    return (
      <div className="h-full flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-[#2A3754] shrink-0">
          <button
            onClick={() => setActiveCard(null)}
            className="flex items-center gap-1.5 text-[#93A4C3] hover:text-[#4DA3FF] transition-colors text-sm"
          >
            <ChevronLeft size={16} />
            返回設定
          </button>
          <span className="text-[#EAF2FF] text-sm font-medium">
            {cards.find(c => c.id === activeCard)?.label}
          </span>
        </div>
        <div className="flex-1 overflow-auto">
          {activeCard === 'spec' && <SpecManager />}
          {activeCard === 'cs' && <Suspense fallback={<div className="p-6 text-[#93A4C3] text-sm">載入中…</div>}><CsManager /></Suspense>}
          {activeCard === 'pn' && <Suspense fallback={<div className="p-6 text-[#93A4C3] text-sm">載入中…</div>}><MachineManager /></Suspense>}
          {activeCard === 'well' && <Suspense fallback={<div className="p-6 text-[#93A4C3] text-sm">載入中…</div>}><WellManager /></Suspense>}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-6">
      <div className="max-w-4xl mx-auto">
        <p className="text-[#93A4C3] text-sm mb-6">選擇要管理的項目</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {cards.map((card) => (
            <motion.button
              key={card.id}
              whileHover={{ scale: 1.02, y: -2 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => card.ready && setActiveCard(card.id)}
              onMouseEnter={() => setHoveredCard(card.id)}
              onMouseLeave={() => setHoveredCard(null)}
              disabled={!card.ready}
              className={`relative text-left rounded-xl border p-5 transition-colors
                ${card.ready
                  ? 'border-[#2A3754] bg-[#111B2E] hover:border-[#4DA3FF]/50 hover:bg-[#1A2438] cursor-pointer'
                  : 'border-[#1A2438] bg-[#0D1525] opacity-50 cursor-not-allowed'
                }`}
            >
              <div className={`mb-3 ${card.ready ? 'text-[#4DA3FF]' : 'text-[#2A3754]'}`}>
                {card.icon}
              </div>
              <h3 className="text-[#EAF2FF] text-sm font-medium mb-1">{card.label}</h3>

              {/* Hover tooltip */}
              <AnimatePresence>
                {hoveredCard === card.id && (
                  <motion.p
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.15 }}
                    className="text-[#93A4C3] text-xs leading-relaxed overflow-hidden"
                  >
                    {card.desc}
                  </motion.p>
                )}
              </AnimatePresence>

              {!card.ready && (
                <span className="absolute top-3 right-3 text-[10px] text-[#2A3754] bg-[#1A2438] px-2 py-0.5 rounded-full">
                  即將推出
                </span>
              )}
            </motion.button>
          ))}
        </div>
      </div>
    </div>
  );
}
