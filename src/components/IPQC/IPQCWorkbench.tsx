import { useState, useCallback, useEffect, useRef } from 'react';
import RawDataView from './RawDataView';
import PendingInspectionTab from './PendingInspectionTab';
import ScheduleImport from './ScheduleImport';

const TABS = [
  { id: 'rawdata',    label: '原始數據' },
  { id: 'inspection', label: '待檢驗' },
  { id: 'schedule',   label: '排產匯入' },
] as const;

type TabId = typeof TABS[number]['id'];

interface LotSelection { marker: string; sheet: string }

export default function IPQCWorkbench({ sharedLot, onLotChange, year }: {
  sharedLot?: LotSelection | null;
  onLotChange?: (lot: LotSelection | null) => void;
  year?: string;
}) {
  const [tab, setTab] = useState<TabId>('rawdata');
  const [rawKey, setRawKey] = useState(0);
  const [navTarget, setNavTarget] = useState<LotSelection | null>(null);

  // Track whether the change came from us to avoid re-triggering
  const selfTriggered = useRef(false);

  // When sharedLot changes externally (from QC page), push to rawdata
  useEffect(() => {
    if (selfTriggered.current) {
      selfTriggered.current = false;
      return;
    }
    if (sharedLot?.marker && sharedLot?.sheet) {
      setNavTarget(sharedLot);
      setRawKey(k => k + 1);
      setTab('rawdata');
    }
  }, [sharedLot]);

  // When an item is activated in 待檢驗
  const handleActivated = useCallback((beadName: string, sheetName: string) => {
    const lot = { marker: beadName, sheet: sheetName };
    setNavTarget(lot);
    setRawKey(k => k + 1);
    setTab('rawdata');
    selfTriggered.current = true;
    onLotChange?.(lot);
  }, [onLotChange]);

  // RawDataView selection changed → sync up to App
  const handleRawSelectionChange = useCallback((marker: string | null, sheet: string | null) => {
    if (marker && sheet) {
      selfTriggered.current = true;
      onLotChange?.({ marker, sheet });
    }
  }, [onLotChange]);

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

      {tab === 'rawdata' && <RawDataView key={rawKey} initMarker={navTarget?.marker} initSheet={navTarget?.sheet} year={year} onSelectionChange={handleRawSelectionChange} />}
      {tab === 'inspection' && <PendingInspectionTab onActivated={handleActivated} />}
      {tab === 'schedule' && <ScheduleImport />}
    </div>
  );
}
