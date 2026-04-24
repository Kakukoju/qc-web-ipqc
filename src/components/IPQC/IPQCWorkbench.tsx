import { useState, useCallback } from 'react';
import RawDataView from './RawDataView';
import PendingInspectionTab from './PendingInspectionTab';
import ScheduleImport from './ScheduleImport';

const TABS = [
  { id: 'rawdata',    label: '原始數據' },
  { id: 'inspection', label: '待檢驗' },
  { id: 'schedule',   label: '排產匯入' },
] as const;

type TabId = typeof TABS[number]['id'];

export default function IPQCWorkbench() {
  const [tab, setTab] = useState<TabId>('rawdata');
  const [rawKey, setRawKey] = useState(0);
  const [navTarget, setNavTarget] = useState<{ marker: string; sheet: string } | null>(null);

  // When an item is activated in 待檢驗, switch to 原始數據 and navigate to that marker/sheet
  const handleActivated = useCallback((beadName: string, sheetName: string) => {
    setNavTarget({ marker: beadName, sheet: sheetName });
    setRawKey(k => k + 1);
    setTab('rawdata');
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-0 px-4 pt-2 pb-0 border-b border-[#2A3754] bg-[#0B1220] shrink-0">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-xs font-medium rounded-t-lg transition-colors border-b-2 -mb-px mr-1
              ${tab === t.id
                ? 'text-[#4DA3FF] border-[#4DA3FF] bg-[#121A2B]'
                : 'text-[#93A4C3] border-transparent hover:text-[#EAF2FF]'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'rawdata' && <RawDataView key={rawKey} initMarker={navTarget?.marker} initSheet={navTarget?.sheet} />}
      {tab === 'inspection' && <PendingInspectionTab onActivated={handleActivated} />}
      {tab === 'schedule' && <ScheduleImport />}
    </div>
  );
}
