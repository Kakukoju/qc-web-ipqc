import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { TouchEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  fetchRdTasks, fetchRdTaskDetail, verifyRdEmpNo, directWrite, startAdjust, saveAdjustedFit, deleteRdTask, rdTaskEventsUrl,
  type RdTask, type RdTaskDetail, type RdPerson, type FitPoint,
} from '../../api/rdBuildLine';
import CurveFitAdjust from './CurveFitAdjust';
import './rd-mobile.css';

type View = 'list' | 'panel' | 'detail' | 'adjust';
type Filter = 'pending' | 'completed' | 'all';
type LiveStatus = 'connecting' | 'connected' | 'polling';

interface PanelTaskGroup {
  groupKey: string;
  panelName: string;
  lotNo: string;
  workOrder: string;
  markers: RdTask[];
  pendingCount: number;
  completedCount: number;
  totalCount: number;
}

function isCompletedStatus(status: string) {
  return status === 'completed';
}

function getPanelInitials(panelName: string) {
  const words = panelName
    .replace(/[_-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const letters = words.slice(0, 2).map(word => word[0]?.toUpperCase()).join('');
  const number = panelName.match(/\d+/)?.[0] ?? '';
  return `${letters || 'P'}${number}`.slice(0, 4);
}

function groupTasksByPanel(tasks: RdTask[]): PanelTaskGroup[] {
  const map = new Map<string, PanelTaskGroup>();

  tasks.forEach(task => {
    const groupKey = [
      task.panel_name || '-',
      task.lot_no || '-',
      task.work_order || '-',
    ].join('__');

    if (!map.has(groupKey)) {
      map.set(groupKey, {
        groupKey,
        panelName: task.panel_name || '-',
        lotNo: task.lot_no || '-',
        workOrder: task.work_order || '-',
        markers: [],
        pendingCount: 0,
        completedCount: 0,
        totalCount: 0,
      });
    }

    const group = map.get(groupKey)!;
    group.markers.push(task);
    group.totalCount += 1;
    if (isCompletedStatus(task.status)) group.completedCount += 1;
    else group.pendingCount += 1;
  });

  return Array.from(map.values()).sort((a, b) => {
    if (b.pendingCount !== a.pendingCount) return b.pendingCount - a.pendingCount;
    return a.panelName.localeCompare(b.panelName, 'zh-Hant');
  });
}

function PanelTaskGrid({
  groups,
  filter,
  onOpen,
}: {
  groups: PanelTaskGroup[];
  filter: Filter;
  onOpen: (groupKey: string) => void;
}) {
  return (
    <div className="rd-panel-grid">
      {groups.map((group, index) => (
        <PanelTaskIcon
          key={group.groupKey}
          group={group}
          filter={filter}
          index={index}
          onOpen={() => onOpen(group.groupKey)}
        />
      ))}
    </div>
  );
}

function PanelTaskIcon({
  group,
  filter,
  index,
  onOpen,
}: {
  group: PanelTaskGroup;
  filter: Filter;
  index: number;
  onOpen: () => void;
}) {
  const statusText = filter === 'completed'
    ? `已完成 ${group.completedCount}`
    : filter === 'all'
      ? `待建線 ${group.pendingCount} / ${group.totalCount}`
      : `待建線 ${group.pendingCount}`;

  return (
    <button
      className="rd-panel-icon"
      type="button"
      onClick={onOpen}
      style={{ animationDelay: `${Math.min(index * 42, 360)}ms` }}
    >
      <span className="rd-panel-icon-symbol">{getPanelInitials(group.panelName)}</span>
      <span className="rd-panel-icon-title">{group.panelName}</span>
      <span className="rd-panel-icon-status">{statusText}</span>
    </button>
  );
}

function PanelTaskDetail({
  group,
  statusLabel,
  statusColor,
  onBack,
  onOpenMarker,
  onDeleteMarker,
}: {
  group: PanelTaskGroup;
  statusLabel: (status: string) => string;
  statusColor: (status: string) => string;
  onBack: () => void;
  onOpenMarker: (taskId: number) => void;
  onDeleteMarker: (taskId: number) => void;
}) {
  return (
    <div className="rd-panel-detail">
      <div className="rd-panel-detail-header">
        <button className="rd-panel-back" type="button" onClick={onBack}>←</button>
        <div className="rd-panel-detail-title-block">
          <h2>{group.panelName}</h2>
          <p>Lot Code: {group.lotNo}</p>
          <p>Work Order: {group.workOrder}</p>
          <span>{group.totalCount} markers</span>
        </div>
      </div>

      <div className="rd-marker-list">
        {group.markers.map(task => (
          <MarkerTaskRow
            key={task.id}
            task={task}
            statusLabel={statusLabel}
            statusColor={statusColor}
            onClick={() => onOpenMarker(task.id)}
            onDelete={() => onDeleteMarker(task.id)}
          />
        ))}
      </div>
    </div>
  );
}

function MarkerTaskRow({
  task,
  statusLabel,
  statusColor,
  onClick,
  onDelete,
}: {
  task: RdTask;
  statusLabel: (status: string) => string;
  statusColor: (status: string) => string;
  onClick: () => void;
  onDelete: () => void;
}) {
  const [offsetX, setOffsetX] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const startX = useRef(0);
  const threshold = -76;
  const meta = [
    task.created_at?.slice(0, 16),
    task.created_by ? `by ${task.created_by}` : null,
  ].filter(Boolean).join(' · ');

  const handleTouchStart = (event: TouchEvent) => {
    startX.current = event.touches[0].clientX;
    setSwiping(false);
  };

  const handleTouchMove = (event: TouchEvent) => {
    const dx = event.touches[0].clientX - startX.current;
    if (dx < -8) setSwiping(true);
    if (dx < 0) setOffsetX(Math.max(dx, -104));
  };

  const handleTouchEnd = () => {
    setOffsetX(offsetX < threshold ? -104 : 0);
  };

  const handleClick = () => {
    if (swiping || offsetX < -12) {
      setOffsetX(0);
      return;
    }
    onClick();
  };

  return (
    <div className="rd-marker-swipe">
      <button className="rd-marker-delete" type="button" onClick={onDelete}>刪除</button>
      <button
        className="rd-marker-row"
        type="button"
        onClick={handleClick}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{ transform: `translateX(${offsetX}px)`, transition: offsetX === 0 || offsetX === -104 ? 'transform 0.18s ease' : 'none' }}
      >
        <span className="rd-marker-main">
          <span className="rd-marker-name">{task.marker || '未命名 Marker'}</span>
          <span className="rd-marker-meta">{meta || 'PC Build-Lines'}</span>
        </span>
        <span className={`rd-marker-status ${statusColor(task.status)}`}>{statusLabel(task.status)}</span>
        <span className="rd-marker-arrow">›</span>
      </button>
    </div>
  );
}

function getFilterLabel(filter: Filter) {
  switch (filter) {
    case 'pending': return '待建線';
    case 'completed': return '已完成';
    case 'all': return '全部';
    default: return '';
  }
}

function getNotificationSwitchLabel(permission: NotificationPermission) {
  if (permission === 'granted') return '通知已開';
  if (permission === 'denied') return '通知封鎖';
  return '通知';
}

interface RdTaskEvent {
  event: 'created' | 'existing';
  task_id: number;
  status: string;
  panel_name: string;
  lot_no: string;
  marker: string | null;
  work_order: string | null;
}

export default function RdMobilePage() {
  const [view, setView] = useState<View>('list');
  const [filter, setFilter] = useState<Filter>('pending');
  const [tasks, setTasks] = useState<RdTask[]>([]);
  const [selectedPanelKey, setSelectedPanelKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedTask, setSelectedTask] = useState<RdTaskDetail | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authAction, setAuthAction] = useState<'direct_write' | 'adjust'>('direct_write');
  const [empNoInput, setEmpNoInput] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [rdPerson, setRdPerson] = useState<RdPerson | null>(null);
  const [writeLoading, setWriteLoading] = useState(false);
  const [writeResult, setWriteResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(
    () => ('Notification' in window ? Notification.permission : 'denied'),
  );
  const [liveStatus, setLiveStatus] = useState<LiveStatus>('connecting');
  const [liveToast, setLiveToast] = useState<RdTaskEvent | null>(null);
  const [, setAdjustMode] = useState(false);
  const knownTaskIdsRef = useRef<Set<number>>(new Set());
  const hasLoadedTasksRef = useRef(false);
  const notifiedTaskIdsRef = useRef<Set<number>>(new Set());
  const audioContextRef = useRef<AudioContext | null>(null);
  const lastFeedbackAtRef = useRef(0);

  const panelGroups = useMemo(() => groupTasksByPanel(tasks), [tasks]);
  const selectedPanelGroup = useMemo(
    () => panelGroups.find(group => group.groupKey === selectedPanelKey) || null,
    [panelGroups, selectedPanelKey],
  );
  const taskSummary = useMemo(() => {
    const pendingCount = tasks.filter(task => !isCompletedStatus(task.status)).length;
    const completedCount = tasks.filter(task => isCompletedStatus(task.status)).length;
    return {
      panelCount: panelGroups.length,
      markerCount: tasks.length,
      pendingCount,
      completedCount,
    };
  }, [panelGroups.length, tasks]);

  const openRdMobileWeb = useCallback(() => {
    const path = window.location.pathname.includes('/qc-web/pre-assignment/rd-mobile')
      ? '/qc-web/pre-assignment/rd-mobile'
      : window.location.pathname;
    const url = `${window.location.origin}${path}`;
    window.focus();
    if (document.visibilityState !== 'visible') window.open(url, '_blank');
  }, []);

  const showTaskNotification = useCallback((task: Pick<RdTaskEvent, 'task_id' | 'panel_name' | 'marker' | 'lot_no'>) => {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    if (notifiedTaskIdsRef.current.has(task.task_id)) return;

    notifiedTaskIdsRef.current.add(task.task_id);
    const notification = new Notification('RD 建線任務', {
      body: `${task.panel_name || 'Panel'} / ${task.marker || 'Marker'} 已送到 RD mobile`,
      tag: `rd-build-line-${task.task_id}`,
      data: { taskId: task.task_id, lotNo: task.lot_no },
      requireInteraction: true,
    });
    notification.onclick = () => {
      notification.close();
      setFilter('pending');
      openRdMobileWeb();
    };
  }, [openRdMobileWeb]);

  const playNoticeSound = useCallback(async (quiet = false) => {
    const AudioContextCtor = window.AudioContext
      || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;

    try {
      const context = audioContextRef.current || new AudioContextCtor();
      audioContextRef.current = context;
      if (context.state === 'suspended') await context.resume();

      const now = context.currentTime;
      const gain = context.createGain();
      gain.gain.setValueAtTime(quiet ? 0.0001 : 0.0001, now);
      gain.gain.exponentialRampToValueAtTime(quiet ? 0.0001 : 0.11, now + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
      gain.connect(context.destination);

      const firstTone = context.createOscillator();
      firstTone.type = 'sine';
      firstTone.frequency.setValueAtTime(880, now);
      firstTone.connect(gain);
      firstTone.start(now);
      firstTone.stop(now + 0.13);

      if (!quiet) {
        const secondTone = context.createOscillator();
        secondTone.type = 'sine';
        secondTone.frequency.setValueAtTime(1174, now + 0.11);
        secondTone.connect(gain);
        secondTone.start(now + 0.11);
        secondTone.stop(now + 0.28);
      }
    } catch {
      // Some mobile browsers only allow audio after user activation.
    }
  }, []);

  const triggerNoticeFeedback = useCallback(() => {
    const now = Date.now();
    if (now - lastFeedbackAtRef.current < 1200) return;
    lastFeedbackAtRef.current = now;

    if ('vibrate' in navigator) navigator.vibrate([180, 70, 180]);
    void playNoticeSound();
  }, [playNoticeSound]);

  const showInAppTaskNotice = useCallback((task: RdTaskEvent) => {
    setLiveToast(task);
    triggerNoticeFeedback();
  }, [triggerNoticeFeedback]);

  const requestNotifications = async () => {
    if (!('Notification' in window)) {
      setError('此瀏覽器不支援通知');
      return;
    }
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    void playNoticeSound(true);
    if (permission === 'granted') {
      new Notification('RD mobile 通知已啟用', {
        body: 'PC 送 RD 建線任務時，這支手機會收到通知。',
        tag: 'rd-mobile-notification-enabled',
        requireInteraction: true,
      });
    }
  };

  // ── Load tasks ──────────────────────────────────────────────────────────
  const loadTasks = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    if (!silent) {
      setLoading(true);
      setError('');
    }
    try {
      const statusParam = filter === 'pending' ? 'pending_rd,in_progress'
        : filter === 'completed' ? 'completed,failed'
        : 'pending_rd,in_progress,completed,failed';
      const resp = await fetchRdTasks(statusParam);
      if (resp.ok && resp.data) {
        const loadedTasks = resp.data;
        if (hasLoadedTasksRef.current) {
          loadedTasks
            .filter(task => !knownTaskIdsRef.current.has(task.id) && (task.status === 'pending_rd' || task.status === 'in_progress'))
            .forEach(task => {
              const taskEvent: RdTaskEvent = {
                event: 'created',
                task_id: task.id,
                status: task.status,
                panel_name: task.panel_name,
                marker: task.marker,
                lot_no: task.lot_no,
                work_order: task.work_order,
              };
              showInAppTaskNotice(taskEvent);
              showTaskNotification(taskEvent);
            });
        }
        knownTaskIdsRef.current = new Set(loadedTasks.map(task => task.id));
        hasLoadedTasksRef.current = true;
        setTasks(loadedTasks);
      } else if (!silent) setError(resp.error?.message || '載入失敗');
    } catch (e) {
      if (!silent) setError('網路錯誤，請重試');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [filter, showInAppTaskNotice, showTaskNotification]);

  const openLiveToastTask = useCallback(() => {
    setFilter('pending');
    setLiveToast(null);
    loadTasks({ silent: true });
    openRdMobileWeb();
  }, [loadTasks, openRdMobileWeb]);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      loadTasks({ silent: true });
    }, 30000);
    return () => window.clearInterval(timer);
  }, [loadTasks]);

  useEffect(() => {
    if (!('EventSource' in window)) return undefined;
    const source = new EventSource(rdTaskEventsUrl());

    const handleConnected = () => {
      setLiveStatus('connected');
    };

    const handleTaskEvent = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as RdTaskEvent;
        setLiveStatus('connected');
        if (payload.status === 'pending_rd' || payload.status === 'in_progress') {
          setFilter('pending');
          showInAppTaskNotice(payload);
          showTaskNotification(payload);
        }
      } catch {
        // Ignore malformed event payloads; polling remains as fallback.
      }
      loadTasks({ silent: true });
    };

    source.addEventListener('connected', handleConnected);
    source.addEventListener('rd-build-line-task', handleTaskEvent);
    source.onerror = () => {
      // EventSource auto-reconnects; task polling remains as fallback.
      setLiveStatus('polling');
    };

    return () => {
      source.removeEventListener('connected', handleConnected);
      source.removeEventListener('rd-build-line-task', handleTaskEvent);
      source.close();
    };
  }, [loadTasks, showInAppTaskNotice, showTaskNotification]);

  useEffect(() => {
    const syncNotificationPermission = () => {
      if ('Notification' in window) setNotificationPermission(Notification.permission);
    };

    window.addEventListener('focus', syncNotificationPermission);
    document.addEventListener('visibilitychange', syncNotificationPermission);
    return () => {
      window.removeEventListener('focus', syncNotificationPermission);
      document.removeEventListener('visibilitychange', syncNotificationPermission);
    };
  }, []);

  useEffect(() => {
    if (view === 'panel' && selectedPanelKey && !selectedPanelGroup) {
      setSelectedPanelKey('');
      setView('list');
    }
  }, [selectedPanelGroup, selectedPanelKey, view]);

  // ── Open task detail ────────────────────────────────────────────────────
  const openDetail = async (taskId: number) => {
    setLoading(true);
    try {
      const resp = await fetchRdTaskDetail(taskId);
      if (resp.ok && resp.data) {
        setSelectedTask(resp.data);
        setView('detail');
        setWriteResult(null);
      } else {
        setError(resp.error?.message || '載入任務詳情失敗');
      }
    } catch {
      setError('網路錯誤');
    } finally {
      setLoading(false);
    }
  };

  const openPanel = (groupKey: string) => {
    setSelectedPanelKey(groupKey);
    setView('panel');
  };

  // ── Auth modal handlers ─────────────────────────────────────────────────
  const openAuth = (action: 'direct_write' | 'adjust') => {
    setAuthAction(action);
    setShowAuthModal(true);
    setEmpNoInput('');
    setAuthError('');
  };

  const handleVerify = async () => {
    if (!empNoInput.trim()) { setAuthError('請輸入工號'); return; }
    setAuthLoading(true);
    setAuthError('');
    try {
      const resp = await verifyRdEmpNo(empNoInput.trim());
      if (resp.ok && resp.data) {
        setRdPerson(resp.data);
        setShowAuthModal(false);
        if (authAction === 'direct_write') {
          await handleDirectWrite(empNoInput.trim());
        } else {
          await handleStartAdjust(empNoInput.trim());
        }
      } else {
        setAuthError(resp.error?.message || '驗證失敗');
      }
    } catch {
      setAuthError('網路錯誤');
    } finally {
      setAuthLoading(false);
    }
  };

  // ── Direct write ────────────────────────────────────────────────────────
  const handleDirectWrite = async (empNo: string) => {
    if (!selectedTask) return;
    setWriteLoading(true);
    try {
      const resp = await directWrite(selectedTask.id, empNo);
      if (resp.ok && resp.data) {
        setWriteResult({ ok: true, message: `已完成建線 · ${resp.data.confirmed_by}` });
        // Refresh task
        const updated = await fetchRdTaskDetail(selectedTask.id);
        if (updated.ok && updated.data) setSelectedTask(updated.data);
      } else {
        setWriteResult({ ok: false, message: resp.error?.message || '寫入失敗' });
      }
    } catch (e) {
      setWriteResult({ ok: false, message: '網路錯誤，寫入失敗' });
    } finally {
      setWriteLoading(false);
    }
  };

  // ── Start adjust ───────────────────────────────────────────────────────
  const handleStartAdjust = async (empNo: string) => {
    if (!selectedTask) return;
    setWriteLoading(true);
    try {
      const resp = await startAdjust(selectedTask.id, empNo);
      if (resp.ok && resp.data) {
        setAdjustMode(true);
        // Refresh task detail
        const updated = await fetchRdTaskDetail(selectedTask.id);
        if (updated.ok && updated.data) {
          let taskData = updated.data;
          // If fit_data has no points, try to fetch from RDS via baseline-points API
          if (taskData.fit_data && (!taskData.fit_data.points || taskData.fit_data.points.length === 0)) {
            try {
              const fd = taskData.fit_data;
              const bgResp = await fetch(`/qc-web-api/api/v1/pre-assignment/baseline-points`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  lot_no: fd.mfg_lot_no || taskData.lot_no,
                  panel_name: fd.panel_name || taskData.panel_name,
                  analyze_item: fd.analyze_item || taskData.marker,
                  analyze_date: fd.analyze_date || '',
                }),
              });
              if (bgResp.ok) {
                const bgData = await bgResp.json();
                if (bgData.ok && bgData.data?.points?.length > 0) {
                  taskData = { ...taskData, fit_data: { ...taskData.fit_data!, points: bgData.data.points } };
                }
              }
            } catch { /* non-blocking */ }
          }
          setSelectedTask(taskData);
        }
        setView('adjust');
      } else {
        setWriteResult({ ok: false, message: resp.error?.message || '開啟調整失敗' });
      }
    } catch {
      setWriteResult({ ok: false, message: '網路錯誤' });
    } finally {
      setWriteLoading(false);
    }
  };

  // ── Save adjusted fit ──────────────────────────────────────────────────
  const handleSaveAdjusted = async (params?: { slope: number; intercept: number; r2: number; equation: string; points: FitPoint[] }) => {
    if (!selectedTask || !rdPerson) return;
    setWriteLoading(true);
    try {
      const fitParams = params || {
        slope: selectedTask.fit_data?.fit?.slope ?? selectedTask.fit_data?.slope,
        intercept: selectedTask.fit_data?.fit?.intercept ?? selectedTask.fit_data?.intercept,
        r2: selectedTask.fit_data?.fit?.r2 ?? selectedTask.fit_data?.r2,
        equation: selectedTask.fit_data?.fit?.equation ?? selectedTask.fit_data?.equation ?? selectedTask.fit_data?.baseline_equation,
        points: selectedTask.fit_data?.points,
      };
      const resp = await saveAdjustedFit(selectedTask.id, rdPerson.emp_no, fitParams);
      if (resp.ok && resp.data) {
        setWriteResult({ ok: true, message: `曲線調整完成 · ${resp.data.confirmed_by}` });
        setAdjustMode(false);
        setView('detail');
        const updated = await fetchRdTaskDetail(selectedTask.id);
        if (updated.ok && updated.data) setSelectedTask(updated.data);
      } else {
        setWriteResult({ ok: false, message: resp.error?.message || '寫入失敗' });
      }
    } catch {
      setWriteResult({ ok: false, message: '網路錯誤' });
    } finally {
      setWriteLoading(false);
    }
  };

  // ── Status helpers ─────────────────────────────────────────────────────
  const statusLabel = (s: string) => {
    switch (s) {
      case 'pending_rd': return '待建線';
      case 'in_progress': return '建線中';
      case 'completed': return '已完成';
      case 'failed': return '寫入失敗';
      default: return s;
    }
  };
  const statusColor = (s: string) => {
    switch (s) {
      case 'pending_rd': return 'status-pending';
      case 'in_progress': return 'status-progress';
      case 'completed': return 'status-done';
      case 'failed': return 'status-error';
      default: return '';
    }
  };

  // ── Back to list ───────────────────────────────────────────────────────
  const backToList = () => {
    setView('list');
    setSelectedTask(null);
    setSelectedPanelKey('');
    setWriteResult(null);
    setAdjustMode(false);
    loadTasks();
  };

  const backToPanel = () => {
    setView(selectedPanelGroup ? 'panel' : 'list');
    setSelectedTask(null);
    setWriteResult(null);
    setAdjustMode(false);
  };

  const handleDeleteTask = async (taskId: number) => {
    setError('');
    try {
      const resp = await deleteRdTask(taskId);
      if (!resp.ok) {
        setError(resp.error?.message || '刪除任務失敗');
        return;
      }
      setTasks(prev => prev.filter(task => task.id !== taskId));
    } catch {
      setError('刪除任務失敗');
    }
  };

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div className="rd-app-shell">
      {/* Header */}
      <header className="rd-header">
        <div className="rd-header-inner">
          <div className="rd-header-main">
            {view !== 'list' && (
              <button className="rd-back-btn" onClick={view === 'detail' && selectedPanelGroup ? backToPanel : backToList}>←</button>
            )}
            <img src={`${import.meta.env.BASE_URL}skylaflower.png`} alt="Skyla" className="rd-header-logo" />
            <div className="rd-title-block">
              <span className="rd-header-kicker">Skyla QC Workflow</span>
              <h1 className="rd-title">
                {view === 'list' ? 'RD 建線任務' : view === 'panel' ? 'Panel Markers' : view === 'adjust' ? '曲線調整' : '任務詳情'}
              </h1>
              <p>{view === 'list' ? `Panel 任務總覽 · ${getFilterLabel(filter)}` : '建線任務流程'}</p>
            </div>
          </div>
          <div className="rd-header-meta">
            <span>{taskSummary.panelCount} panels</span>
            <span>{filter === 'completed' ? `已完成 ${taskSummary.completedCount}` : `待建線 ${taskSummary.pendingCount}`}</span>
            <span>{liveStatus === 'connected' ? 'Live 已連線' : liveStatus === 'polling' ? 'Live 輪詢中' : 'Live 連線中'}</span>
          </div>
          {view === 'list' && (
            <div className="rd-header-actions">
              <button
                className={`rd-notify-switch ${notificationPermission === 'granted' ? 'is-on' : ''} ${notificationPermission === 'denied' ? 'is-blocked' : ''}`}
                type="button"
                role="switch"
                aria-checked={notificationPermission === 'granted'}
                aria-label={getNotificationSwitchLabel(notificationPermission)}
                onClick={notificationPermission === 'granted' ? undefined : requestNotifications}
                title={notificationPermission === 'denied' ? '瀏覽器已封鎖通知，請到網站設定允許通知' : undefined}
              >
                <span className="rd-notify-switch-track">
                  <span className="rd-notify-switch-thumb" />
                </span>
                <span className="rd-notify-switch-text">{getNotificationSwitchLabel(notificationPermission)}</span>
              </button>
              <button className="rd-refresh-btn" onClick={() => loadTasks()} disabled={loading}>⟳</button>
            </div>
          )}
        </div>
      </header>

      <main className="rd-main">
        <AnimatePresence mode="wait">
          {view === 'list' && (
            <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {renderList()}
            </motion.div>
          )}
          {view === 'panel' && selectedPanelGroup && (
            <motion.div key="panel" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <PanelTaskDetail
                group={selectedPanelGroup}
                statusLabel={statusLabel}
                statusColor={statusColor}
                onBack={backToList}
                onOpenMarker={openDetail}
                onDeleteMarker={handleDeleteTask}
              />
            </motion.div>
          )}
          {view === 'detail' && selectedTask && (
            <motion.div key="detail" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              {renderDetail()}
            </motion.div>
          )}
          {view === 'adjust' && selectedTask && (
            <motion.div key="adjust" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              {renderAdjust()}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {liveToast && (
          <motion.button
            key={`live-toast-${liveToast.task_id}`}
            className="rd-live-toast"
            type="button"
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            onClick={openLiveToastTask}
          >
            <span className="rd-live-toast-dot" />
            <span className="rd-live-toast-main">
              <span className="rd-live-toast-title">收到 RD 建線任務</span>
              <strong>{liveToast.panel_name || 'Panel'} / {liveToast.marker || 'Marker'}</strong>
              <small>不會自動消失，點擊可更新列表</small>
            </span>
            <span
              className="rd-live-toast-close"
              role="button"
              tabIndex={0}
              aria-label="關閉通知"
              onClick={(event) => {
                event.stopPropagation();
                setLiveToast(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  event.stopPropagation();
                  setLiveToast(null);
                }
              }}
            >
              ×
            </span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Auth Modal */}
      {showAuthModal && renderAuthModal()}
    </div>
  );

  // ── List View ──────────────────────────────────────────────────────────
  function renderList() {
    return (
      <div className="rd-list-container">
        {/* Filter tabs */}
        <div className="rd-filter-tabs">
          <button className={filter === 'pending' ? 'active' : ''} onClick={() => setFilter('pending')}>
            待建線
          </button>
          <button className={filter === 'completed' ? 'active' : ''} onClick={() => setFilter('completed')}>
            已完成
          </button>
          <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
            全部
          </button>
        </div>

        {/* Loading */}
        {loading && <div className="rd-loading">載入中...</div>}

        {/* Error */}
        {error && <div className="rd-error-msg">{error}</div>}

        {/* Empty */}
        {!loading && !error && panelGroups.length === 0 && (
          <div className="rd-empty">
            <div className="rd-empty-icon">📋</div>
            <p>目前沒有{filter === 'pending' ? '待建線' : filter === 'completed' ? '已完成' : ''}任務</p>
          </div>
        )}

        {!loading && !error && (
          <PanelTaskGrid groups={panelGroups} filter={filter} onOpen={openPanel} />
        )}
      </div>
    );
  }

  // ── Detail View ────────────────────────────────────────────────────────
  function renderDetail() {
    if (!selectedTask) return null;
    const t = selectedTask;
    const fitData = t.fit_data;
    const curve = t.curve_record;
    const isCompleted = t.status === 'completed';
    const isFailed = t.status === 'failed';

    return (
      <div className="rd-detail-container">
        {/* Task info card */}
        <div className="rd-info-card">
          <h3>任務資訊</h3>
          <div className="rd-info-grid">
            <div className="rd-info-item">
              <span className="rd-info-label">Panel Name</span>
              <span className="rd-info-value">{t.panel_name}</span>
            </div>
            <div className="rd-info-item">
              <span className="rd-info-label">Lot Code</span>
              <span className="rd-info-value">{t.lot_no}</span>
            </div>
            {t.marker && (
              <div className="rd-info-item">
                <span className="rd-info-label">Marker</span>
                <span className="rd-info-value">{t.marker}</span>
              </div>
            )}
            {t.work_order && (
              <div className="rd-info-item">
                <span className="rd-info-label">Work Order</span>
                <span className="rd-info-value">{t.work_order}</span>
              </div>
            )}
            <div className="rd-info-item">
              <span className="rd-info-label">建立時間</span>
              <span className="rd-info-value">{t.created_at?.slice(0, 16)}</span>
            </div>
            <div className="rd-info-item">
              <span className="rd-info-label">狀態</span>
              <span className={`rd-info-status ${statusColor(t.status)}`}>{statusLabel(t.status)}</span>
            </div>
          </div>
        </div>

        {/* Curve fitting section */}
        <div className="rd-info-card">
          <h3>曲線擬合資料</h3>
          {fitData ? (
            <div className="rd-fit-section">
              {fitData.equation || fitData.baseline_equation ? (
                <div className="rd-equation-box">
                  <span className="rd-eq-label">Equation</span>
                  <code>{fitData.equation || fitData.baseline_equation}</code>
                </div>
              ) : null}
              {(fitData.fit?.slope != null || fitData.slope != null) && (
                <div className="rd-fit-params">
                  <div><span>Slope:</span> {fitData.fit?.slope ?? fitData.slope ?? 'N/A'}</div>
                  <div><span>Intercept:</span> {fitData.fit?.intercept ?? fitData.intercept ?? 'N/A'}</div>
                  <div><span>R²:</span> {fitData.fit?.r2 ?? fitData.r2 ?? 'N/A'}</div>
                </div>
              )}
              {fitData.points && fitData.points.length > 0 && (
                <div className="rd-points-table">
                  <table>
                    <thead>
                      <tr><th>Control</th><th>Conc</th><th>OD</th></tr>
                    </thead>
                    <tbody>
                      {fitData.points.slice(0, 8).map((p, i) => (
                        <tr key={i}>
                          <td>{p.patient_id || `Point ${i + 1}`}</td>
                          <td>{p.conc != null ? Number(p.conc).toFixed(2) : '-'}</td>
                          <td>{((p as Record<string,unknown>).final_delta_od ?? (p as Record<string,unknown>)['Final Delta OD'] ?? p.od) != null ? Number((p as Record<string,unknown>).final_delta_od ?? (p as Record<string,unknown>)['Final Delta OD'] ?? p.od).toFixed(6) : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : curve ? (
            <div className="rd-fit-section">
              <div className="rd-fit-params">
                <div><span>Slope:</span> {curve.od_slope ?? 'N/A'}</div>
                <div><span>Intercept:</span> {curve.od_intercept ?? 'N/A'}</div>
                <div><span>R²:</span> {curve.od_r2 ?? 'N/A'}</div>
              </div>
              {curve.confirmed_by && (
                <div className="rd-confirmed-info">
                  <span>操作紀錄:</span> {curve.confirmed_by}
                </div>
              )}
            </div>
          ) : (
            <p className="rd-no-data">尚無曲線擬合資料</p>
          )}
        </div>

        {/* Result display */}
        {writeResult && (
          <div className={`rd-result-card ${writeResult.ok ? 'success' : 'error'}`}>
            <div className="rd-result-icon">{writeResult.ok ? '✅' : '❌'}</div>
            <p>{writeResult.message}</p>
            {writeResult.ok && t.assigned_rd_name && (
              <p className="rd-result-sub">RD: {t.assigned_rd_name}</p>
            )}
            {writeResult.ok && t.completed_at && (
              <p className="rd-result-sub">完成時間: {t.completed_at}</p>
            )}
          </div>
        )}

        {/* Error display */}
        {isFailed && t.error_message && (
          <div className="rd-result-card error">
            <div className="rd-result-icon">❌</div>
            <p>寫入失敗: {t.error_message}</p>
          </div>
        )}

        {/* Action buttons */}
        {!isCompleted && !isFailed && (
          <div className="rd-action-buttons">
            <button
              className="rd-btn rd-btn-primary"
              onClick={() => openAuth('direct_write')}
              disabled={writeLoading}
            >
              {writeLoading ? '處理中...' : '直接寫入'}
            </button>
            <button
              className="rd-btn rd-btn-secondary"
              onClick={() => openAuth('adjust')}
              disabled={writeLoading}
            >
              {writeLoading ? '處理中...' : '開啟曲線調整'}
            </button>
          </div>
        )}

        {/* Completed info */}
        {isCompleted && (
          <div className="rd-completed-info">
            <p>✅ 已完成建線</p>
            {t.assigned_rd_name && <p>RD: {t.assigned_rd_name}</p>}
            {t.completed_at && <p>完成時間: {t.completed_at}</p>}
            {t.action_type && <p>操作類型: {t.action_type === 'direct_write' ? '直接寫入' : '曲線調整'}</p>}
          </div>
        )}
      </div>
    );
  }

  // ── Adjust View ────────────────────────────────────────────────────────
  function renderAdjust() {
    if (!selectedTask) return null;

    return (
      <div className="rd-detail-container">
        <CurveFitAdjust
          fitData={selectedTask.fit_data}
          onConfirm={(params) => handleSaveAdjusted(params)}
          onCancel={() => { setView('detail'); setAdjustMode(false); }}
          saving={writeLoading}
        />

        {writeResult && (
          <div className={`rd-result-card ${writeResult.ok ? 'success' : 'error'}`}>
            <div className="rd-result-icon">{writeResult.ok ? '✅' : '❌'}</div>
            <p>{writeResult.message}</p>
          </div>
        )}
      </div>
    );
  }

  // ── Auth Modal ─────────────────────────────────────────────────────────
  function renderAuthModal() {
    return (
      <div className="rd-modal-overlay" onClick={() => setShowAuthModal(false)}>
        <motion.div
          className="rd-modal"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          onClick={e => e.stopPropagation()}
        >
          <h3>RD 工號驗證</h3>
          <p className="rd-modal-hint">
            {authAction === 'direct_write' ? '直接寫入前' : '開啟曲線調整前'}，請輸入 RD 工號
          </p>
          <input
            className="rd-modal-input"
            type="text"
            inputMode="numeric"
            placeholder="請輸入 Skyla Emp No"
            value={empNoInput}
            onChange={e => setEmpNoInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleVerify()}
            autoFocus
          />
          {authError && <p className="rd-modal-error">{authError}</p>}
          <div className="rd-modal-actions">
            <button
              className="rd-btn rd-btn-primary"
              onClick={handleVerify}
              disabled={authLoading}
            >
              {authLoading ? '驗證中...' : '確認'}
            </button>
            <button
              className="rd-btn rd-btn-outline"
              onClick={() => setShowAuthModal(false)}
            >
              取消
            </button>
          </div>
        </motion.div>
      </div>
    );
  }
}
