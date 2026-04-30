import { useState, useEffect, useRef, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Search } from 'lucide-react';
import Sidebar from './components/Layout/Sidebar';
import Topbar from './components/Layout/Topbar';
import Dashboard from './components/Dashboard/Dashboard';
import IPQCWorkbench from './components/IPQC/IPQCWorkbench';
import DriedBeadsPage from './components/DriedBeads/DriedBeadsPage';
import PostsPage from './components/Posts/PostsPage';
import SettingsPage from './components/Settings/SettingsPage';
import TuttiPage from './components/Tutti/TuttiPage';
import { apiUrl } from './api/base';

const viewTitles: Record<string, string> = {
  dashboard: 'Dashboard',
  qc: 'IPQC 管理 · Dried Beads 半成品檢驗紀錄',
  ipqc: 'IPQC 工作台 · 原始數據',
  production: '生產管理',
  monitor: 'Tutti-Beads 預建線',
  anomaly: '異常管理',
  reports: '報表分析',
  settings: '系統設定',
};

interface LotSelection { marker: string; sheet: string }
interface SearchResult { bead_name: string; sheet_name: string; tab: 'table1' | 'table2'; insp_date: string | null; }

function QCView({ sharedLot, onLotChange, year }: {
  sharedLot: LotSelection | null;
  onLotChange: (lot: LotSelection | null) => void;
  year: string;
}) {
  const [tab, setTab] = useState<'table1' | 'table2'>('table1');
  const [nav, setNav] = useState<LotSelection | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wrapRef = useRef<HTMLDivElement>(null);



  // Track whether the change came from us
  const selfTriggered = useRef(false);

  // When sharedLot changes externally (e.g. from IPQC), push as nav
  useEffect(() => {
    if (selfTriggered.current) {
      selfTriggered.current = false;
      return;
    }
    if (sharedLot?.marker && sharedLot?.sheet) {
      setNav(sharedLot);
    }
  }, [sharedLot]);

  // Debounced search
  useEffect(() => {
    if (query.length < 2) { setResults([]); return; }
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(apiUrl(`/search?q=${encodeURIComponent(query)}`));
        const data: SearchResult[] = await res.json();
        setResults(data);
        setShowResults(true);
      } catch { setResults([]); }
    }, 250);
    return () => clearTimeout(timerRef.current);
  }, [query]);

  // Click outside to close
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setShowResults(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handlePick = useCallback((r: SearchResult) => {
    setTab(r.tab);
    setNav({ marker: r.bead_name, sheet: r.sheet_name });
    setQuery('');
    setShowResults(false);
  }, []);

  const clearNav = useCallback(() => setNav(null), []);

  const handleSelectionChange = useCallback((marker: string | null, sheet: string | null) => {
    if (marker && sheet) {
      selfTriggered.current = true;
      onLotChange({ marker, sheet });
    }
  }, [onLotChange]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-1 px-4 pt-3 pb-0 border-b border-[#2A3754] shrink-0">
        {([
          { id: 'table1', label: '表一 · Dried Beads 檢驗' },
          { id: 'table2', label: '表二 · OD 化學特性分析' },
        ] as const).map(t => (
          <button
            key={t.id}
            onClick={() => {
              if (sharedLot) setNav(sharedLot);
              setTab(t.id);
            }}
            className={`px-4 py-2 text-xs font-medium rounded-t-lg transition-colors border-b-2 -mb-px
              ${tab === t.id
                ? 'text-[#4DA3FF] border-[#4DA3FF] bg-[#1A2438]'
                : 'text-[#93A4C3] border-transparent hover:text-[#EAF2FF]'}`}
          >
            {t.label}
          </button>
        ))}

        <div ref={wrapRef} className="relative ml-auto mb-1">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#93A4C3]" />
          <input
            value={query}
            onChange={e => { setQuery(e.target.value); setShowResults(true); }}
            onFocus={() => results.length > 0 && setShowResults(true)}
            placeholder="搜尋 Lot / 工單 / Marker..."
            className="w-64 bg-[#121A2B] border border-[#2A3754] rounded-lg pl-8 pr-3 py-1.5 text-xs text-[#EAF2FF] placeholder-[#556A88] focus:outline-none focus:border-[#4DA3FF] transition-colors"
          />
          {showResults && results.length > 0 && (
            <div className="absolute right-0 top-full mt-1 w-80 max-h-72 overflow-y-auto bg-[#121A2B] border border-[#2A3754] rounded-xl shadow-2xl z-50">
              {results.map((r, i) => (
                <button
                  key={`${r.tab}-${r.bead_name}-${r.sheet_name}-${i}`}
                  onClick={() => handlePick(r)}
                  className="w-full text-left px-3 py-2 hover:bg-[#1A2438] transition-colors flex items-center gap-2 border-b border-[#1A2438]/40 last:border-0"
                >
                  <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold shrink-0 ${
                    r.tab === 'table1' ? 'bg-[#4DA3FF]/20 text-[#4DA3FF]' : 'bg-[#A78BFA]/20 text-[#A78BFA]'
                  }`}>
                    {r.tab === 'table1' ? '表一' : '表二'}
                  </span>
                  <span className="text-xs font-bold text-[#4DA3FF]">{r.bead_name}</span>
                  <span className="text-xs font-mono text-[#EAF2FF] truncate">{r.sheet_name}</span>
                  <span className="text-[10px] text-[#556A88] ml-auto shrink-0">{r.insp_date?.slice(0, 10) || ''}</span>
                </button>
              ))}
            </div>
          )}
          {showResults && query.length >= 2 && results.length === 0 && (
            <div className="absolute right-0 top-full mt-1 w-64 bg-[#121A2B] border border-[#2A3754] rounded-xl shadow-2xl z-50 p-3">
              <p className="text-xs text-[#556A88] text-center">找不到結果</p>
            </div>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        {tab === 'table1'
          ? <DriedBeadsPage
              navTarget={nav?.marker && tab === 'table1' ? nav : null}
              onNavConsumed={clearNav}
              onSelectionChange={handleSelectionChange}
              year={year}
            />
          : <PostsPage navTarget={nav?.marker && tab === 'table2' ? nav : null} onNavConsumed={clearNav} />}
      </div>
    </div>
  );
}

function PlaceholderView({ title }: { title: string }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex items-center justify-center h-full"
    >
      <div className="text-center">
        <p className="text-4xl font-bold text-[#2A3754] mb-3">🚧</p>
        <p className="text-[#93A4C3] text-sm">{title}</p>
        <p className="text-[#2A3754] text-xs mt-1">即將推出</p>
      </div>
    </motion.div>
  );
}

export default function App() {
  const [activeView, setActiveView] = useState('dashboard');
  const [sharedLot, setSharedLot] = useState<LotSelection | null>(null);
  const [sharedYear, setSharedYear] = useState(new Date().getFullYear().toString());

  // Expose global nav function for year-filter-patched.js
  useEffect(() => {
    (window as any).__navigateToQcLot = (marker: string, sheet: string) => {
      setSharedLot({ marker, sheet });
      setActiveView('qc');
    };
    return () => { delete (window as any).__navigateToQcLot; };
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#0B1220]">
      <Sidebar activeView={activeView} onNavigate={setActiveView} />

      <div className="flex flex-col flex-1 overflow-hidden">
        <Topbar title={viewTitles[activeView] || 'Automatic Baseline Assignment'} />

        <main className="flex-1 overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeView}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="h-full"
            >
              {activeView === 'dashboard' && <Dashboard onNavigate={setActiveView} onYearChange={setSharedYear} />}
              {activeView === 'qc' && <QCView sharedLot={sharedLot} onLotChange={setSharedLot} year={sharedYear} />}
              {activeView === 'ipqc' && <IPQCWorkbench sharedLot={sharedLot} onLotChange={setSharedLot} year={sharedYear} />}
              {activeView === 'settings' && <SettingsPage />}
              {activeView === 'monitor' && <TuttiPage />}
              {!['dashboard', 'qc', 'ipqc', 'settings', 'monitor'].includes(activeView) && (
                <PlaceholderView title={viewTitles[activeView] || activeView} />
              )}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
