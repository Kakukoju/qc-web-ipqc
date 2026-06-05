import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, CloudDownload, Database, FileSpreadsheet, RefreshCw, Server, X } from 'lucide-react';
import {
  fetchImportStatus,
  fetchHeaders,
  fetchPanelNames,
  queryAssayProcess,
  fetchSkylaiDevices,
  type ImportStatus,
  type Logic,
  type PanelNameOption,
  type QueryCondition,
  type QueryResponse,
  type SkylaiDeviceFetchResult,
} from './api';
import QueryPanel from './components/QueryPanel';
import ResultTable from './components/ResultTable';
import ControlSheet from './components/ControlSheet';

const defaultQueryState = {
  logic: 'AND' as Logic,
  conditions: [
    { header: '', value: '' },
    { header: '', value: '' },
    { header: '', value: '' },
  ],
  limit: 500,
  offset: 0,
};

const qcTabs = [
  { id: 'biochemistry', label: '生化盤', status: 'ready' },
  { id: 'turbidimetry', label: '比濁盤', status: 'building' },
  { id: 'elisa', label: 'ELISA盤', status: 'building' },
  { id: 'coagulation', label: '凝血盤', status: 'building' },
  { id: 'screening', label: '篩機測試', status: 'building' },
  { id: 'validation', label: '驗證實驗', status: 'building' },
] as const;

export default function App() {
  const [activeTab, setActiveTab] = useState<(typeof qcTabs)[number]['id']>('biochemistry');
  const [showUploadMemo, setShowUploadMemo] = useState(
    () => localStorage.getItem('tutti-assayprocess-upload-memo-dismissed') !== 'true',
  );
  const [headers, setHeaders] = useState<string[]>([]);
  const [panelNames, setPanelNames] = useState<PanelNameOption[]>([]);
  const [logic, setLogic] = useState<Logic>(defaultQueryState.logic);
  const [conditions, setConditions] = useState<QueryCondition[]>(defaultQueryState.conditions);
  const [result, setResult] = useState<QueryResponse | null>(null);
  const [importStatus, setImportStatus] = useState<ImportStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const [showControlSheet, setShowControlSheet] = useState(false);
  const [controlParams, setControlParams] = useState({ panelName: '', analyzeDate: '', fwVersion: '' });
  const [skylaiLoading, setSkylaiLoading] = useState(false);
  const [skylaiResult, setSkylaiResult] = useState<SkylaiDeviceFetchResult | null>(null);

  const loadHeaders = useCallback(async () => {
    try {
      const [loadedHeaders, loadedPanelNames] = await Promise.all([fetchHeaders(), fetchPanelNames()]);
      setHeaders(loadedHeaders);
      setPanelNames(loadedPanelNames);
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '欄位載入失敗');
    }
  }, []);

  const runQuery = useCallback(async () => {
    setLoading(true);
    try {
      const data = await queryAssayProcess({
        logic,
        conditions,
        limit: defaultQueryState.limit,
        offset: defaultQueryState.offset,
      });
      setResult(data);
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '查詢失敗');
    } finally {
      setLoading(false);
    }
  }, [conditions, logic]);

  const loadImportStatus = useCallback(async () => {
    try {
      setImportStatus(await fetchImportStatus());
    } catch {
      setImportStatus(null);
    }
  }, []);

  useEffect(() => {
    loadHeaders();
    loadImportStatus();
  }, [loadHeaders, loadImportStatus]);

  useEffect(() => {
    runQuery();
  }, []);

  const handleConditionChange = (index: number, condition: QueryCondition) => {
    setConditions((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? condition : item)),
    );
  };

  const handleClear = async () => {
    setLogic(defaultQueryState.logic);
    setConditions(defaultQueryState.conditions.map((condition) => ({ ...condition })));
    setLoading(true);
    try {
      const data = await queryAssayProcess({
        logic: defaultQueryState.logic,
        conditions: defaultQueryState.conditions,
        limit: defaultQueryState.limit,
        offset: defaultQueryState.offset,
      });
      setResult(data);
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '查詢失敗');
    } finally {
      setLoading(false);
    }
  };

  const dismissUploadMemo = () => {
    localStorage.setItem('tutti-assayprocess-upload-memo-dismissed', 'true');
    setShowUploadMemo(false);
  };

  const openControlSheet = () => {
    // Validate: condition 1 must be panel_name with value, condition 2 must be analyze_date with value
    const c1 = conditions[0];
    const c2 = conditions[1];
    const hasPanelName = c1?.header === 'panel_name' && c1?.value?.trim();
    const hasAnalyzeDate = c2?.header === 'analyze_date' && c2?.value?.trim();

    if (!hasPanelName || !hasAnalyzeDate) {
      setMessage('請設定查詢項目 1 = panel_name 且查詢項目 2 = analyze_date 才能開啟 Control Sheet');
      return;
    }

    // Extract EN name from "EN||CN" format
    const panelName = c1.value.trim().split('||')[0];
    let analyzeDate = c2.value.trim().replace(/\//g, '-');
    let fwVersion = '';
    // Optional: check condition 3 for F.W.
    const c3 = conditions[2];
    if (c3?.header === 'F.W.' && c3?.value?.trim()) fwVersion = c3.value.trim();

    setControlParams({ panelName, analyzeDate, fwVersion });
    setShowControlSheet(true);
  };

  const canOpenControlSheet = () => {
    const c1 = conditions[0];
    const c2 = conditions[1];
    return c1?.header === 'panel_name' && !!c1?.value?.trim()
      && c2?.header === 'analyze_date' && !!c2?.value?.trim();
  };

  if (showControlSheet) {
    return (
      <ControlSheet
        panelName={controlParams.panelName}
        analyzeDate={controlParams.analyzeDate}
        fwVersion={controlParams.fwVersion || undefined}
        onBack={() => setShowControlSheet(false)}
      />
    );
  }

  const columns = result?.columns.length ? result.columns : headers;
  const activeTabMeta = qcTabs.find((tab) => tab.id === activeTab) || qcTabs[0];
  const isBiochemistry = activeTab === 'biochemistry';

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="title-group">
          <a className="back-link" href="/qc-web/">
            <ArrowLeft size={16} />
            返回 qc-web
          </a>
          <div>
            <p className="eyebrow">Tutti QC</p>
            <h1>Tutti QC AssayProcess 查詢系統</h1>
          </div>
        </div>
        <div className="header-actions">
          <div className="backend-pill" title="FastAPI backend: 127.0.0.1:8200">
            <Server size={15} />
            Backend OK
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={async () => {
              setSkylaiLoading(true);
              setSkylaiResult(null);
              try {
                const res = await fetchSkylaiDevices({ days_back: 7 });
                setSkylaiResult(res);
                if (res.ok) runQuery();
              } catch (e) {
                setSkylaiResult({ ok: false, error: e instanceof Error ? e.message : 'Unknown error' });
              } finally {
                setSkylaiLoading(false);
              }
            }}
            disabled={skylaiLoading}
            title="從 SkylaiCloud 拉取 4 台機器資料"
            style={{ background: '#1a237e', border: '1px solid #3f51b5', borderRadius: 8, padding: '4px 10px', color: '#90caf9', cursor: skylaiLoading ? 'wait' : 'pointer' }}
          >
            <CloudDownload size={17} className={skylaiLoading ? 'animate-spin' : ''} />
          </button>
          <button className="icon-button" type="button" onClick={loadHeaders} title="重新載入欄位">
            <RefreshCw size={17} />
          </button>
        </div>
      </header>

      <div className="status-line">
        <Database size={16} />
        <span>
          {isBiochemistry
            ? headers.length
              ? `生化盤 QC 結果 · 已載入 ${headers.length} 個欄位`
              : '生化盤 QC 結果 · 尚未匯入 AssayProcess CSV'
            : `${activeTabMeta.label} · 建置中`}
        </span>
      </div>

      {message && <div className="message">{message}</div>}

      {skylaiResult && (
        <div style={{
          margin: '0 0 12px',
          padding: '10px 16px',
          borderRadius: 8,
          background: skylaiResult.ok ? '#1b5e20' : '#b71c1c',
          color: '#fff',
          fontSize: 13,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          justifyContent: 'space-between',
        }}>
          <div>
            {skylaiResult.ok ? (
              <>
                <strong>✅ SkylaiCloud 資料已匯入 RDS</strong>
                <span style={{ marginLeft: 12 }}>
                  共 {skylaiResult.total_inserted} 筆 ({skylaiResult.date_range?.start} ~ {skylaiResult.date_range?.end})
                </span>
                <span style={{ marginLeft: 12, opacity: 0.8 }}>
                  {skylaiResult.device_results?.map(d => `${d.device_sn}: ${d.inserted}`).join(' · ')}
                </span>
              </>
            ) : (
              <><strong>❌ 匯入失敗</strong> {skylaiResult.error}</>
            )}
          </div>
          <button onClick={() => setSkylaiResult(null)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}>
            <X size={16} />
          </button>
        </div>
      )}

      {showUploadMemo && (
        <section className="upload-memo" aria-label="PowerShell 上傳說明">
          <div>
            <p className="upload-memo-title">PowerShell 全量上傳提醒</p>
            {importStatus && (
              <div className="upload-memo-stats">
                <span>檔案 {importStatus.manifest_total_files}</span>
                <span>成功 {importStatus.success_files}</span>
                <span>Backend error {importStatus.error_files}</span>
                <span>DB records {importStatus.records_total}</span>
                <span>重複 key {importStatus.duplicate_natural_key_groups}</span>
              </div>
            )}
            <ul>
              <li>PowerShell 顯示的數字是檔案數；UI total 是已寫入資料庫且去重後的 assay record 數。</li>
              <li>若 HTTP/網路失敗，PowerShell 會顯示上傳失敗，該檔案不會更新本機 manifest。</li>
              <li>若 backend 回傳 ok=false，代表檔案有到 EC2 但檢查失敗，會記錄原因且不寫入資料庫。</li>
              <li>若資料 natural key 重複，backend 會略過重複列，不會重複寫入。</li>
            </ul>
            {importStatus?.error_reasons.length ? (
              <div className="upload-memo-errors">
                <strong>Backend error reason</strong>
                {importStatus.error_reasons.slice(0, 3).map((item) => (
                  <span key={item.error || 'empty'}>
                    {item.count} · {item.error || '未提供錯誤訊息'}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <button type="button" onClick={dismissUploadMemo} aria-label="關閉上傳提醒">
            <X size={16} />
            取消
          </button>
        </section>
      )}

      <nav className="qc-tabs" aria-label="QC 盤別">
        {qcTabs.map((tab) => (
          <button
            className={tab.id === activeTab ? 'active' : ''}
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
          >
            <span>{tab.label}</span>
            {tab.status === 'building' && <small>建置中</small>}
          </button>
        ))}
      </nav>

      {isBiochemistry ? (
        <>
          <QueryPanel
            headers={headers}
            panelNames={panelNames}
            conditions={conditions}
            logic={logic}
            loading={loading}
            onConditionChange={handleConditionChange}
            onLogicChange={setLogic}
            onSearch={runQuery}
            onClear={handleClear}
          />

          <ResultTable
            columns={columns}
            rows={result?.rows || []}
            total={result?.total || 0}
            onOpenControlSheet={openControlSheet}
            controlSheetDisabled={!canOpenControlSheet()}
          />
        </>
      ) : (
        <section className="building-panel">
          <p className="building-kicker">{activeTabMeta.label}</p>
          <h2>建置中</h2>
        </section>
      )}
    </main>
  );
}
