import { useEffect, useState } from 'react';
import { fetchReviewTask, fetchReviewTasks, submitRdReview, submitSupervisorDecision, subscribePush, type ReviewTask } from '../../api/reviewTasks';
import './rd-mobile.css';
import './review-mobile.css';

const path = window.location.pathname;
const taskMatch = path.match(/\/(review|exception)\/(\d+)/);
const supervisorMode = path.includes('/qc-mobile/');
const taskId = taskMatch ? Number(taskMatch[2]) : null;

export default function ReviewMobilePage() {
  const [tasks, setTasks] = useState<ReviewTask[]>([]);
  const [selected, setSelected] = useState<ReviewTask | null>(null);
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [comment, setComment] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      if (taskId) setSelected(await fetchReviewTask(taskId));
      else setTasks(await fetchReviewTasks(supervisorMode ? 'exception' : 'pending_rd,rd_reviewing'));
    } catch (error) { setMessage(error instanceof Error ? error.message : '載入失敗'); }
  };
  useEffect(() => { void load(); }, []);

  const enableNotifications = async () => {
    if (!userId) return setMessage('請先輸入工號');
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return setMessage('此瀏覽器不支援 Web Push');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return setMessage('通知權限未允許');
    try {
      await subscribePush({
        user_id: userId,
        role: supervisorMode ? 'QC_SUPERVISOR' : 'RD',
        device_name: navigator.platform || 'mobile',
        platform: /iPhone|iPad/.test(navigator.userAgent) ? 'ios' : /Android/.test(navigator.userAgent) ? 'android' : 'desktop',
      });
      setMessage('背景通知已啟用');
    } catch (error) { setMessage(error instanceof Error ? error.message : '訂閱失敗'); }
  };

  const rdSubmit = async (result: 'approved'|'failed'|'need_adjustment') => {
    if (!selected) return;
    setBusy(true);
    try {
      setSelected(await submitRdReview(selected.id, { rd_user_id: userId, rd_password: password, result, comment }));
      setMessage('覆核已送出');
    } catch (error) { setMessage(error instanceof Error ? error.message : '送出失敗'); }
    finally { setBusy(false); }
  };
  const decide = async (decision: 'pass'|'reject'|'re_test'|'hold') => {
    if (!selected) return;
    setBusy(true);
    try {
      setSelected(await submitSupervisorDecision(selected.id, { supervisor_id: userId, password, decision, comment }));
      setMessage(`主管判定完成：${decision}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : '判定失敗'); }
    finally { setBusy(false); }
  };

  return <div className="rd-app-shell review-app">
    <header className="rd-header"><div className="rd-header-inner"><div className="rd-header-main">
      <img src="/qc-web/skylaflower.png" className="rd-header-logo" />
      <div className="rd-title-block"><span className="rd-header-kicker">Skyla QC Workflow</span>
        <h1>{supervisorMode ? 'QC 主管異常判定' : 'RD 覆核'}</h1>
        <p>{taskId ? `Task #${taskId}` : 'Mobile Review Tasks'}</p></div>
    </div></div></header>
    <main className="rd-main">
      <div className="review-auth-bar">
        <input placeholder="工號" value={userId} onChange={e => setUserId(e.target.value)} />
        <input placeholder="密碼" type="password" value={password} onChange={e => setPassword(e.target.value)} />
        <button onClick={enableNotifications}>啟用通知</button>
      </div>
      {message && <div className="rd-error-msg">{message}</div>}
      {!selected && <div className="review-list">{tasks.map(item =>
        <a key={item.id} className="review-card" href={`${supervisorMode ? '/qc-web/pre-assignment/qc-mobile/exception/' : '/qc-web/pre-assignment/rd-mobile/review/'}${item.id}`}>
          <strong>{item.panel_name}</strong><span>Lot: {item.lot_no}</span><em>{item.status}</em>
        </a>)}</div>}
      {selected && <div className="rd-detail-container">
        <section className="rd-info-card"><h3>任務資訊</h3><div className="rd-info-grid">
          <div className="rd-info-item"><span className="rd-info-label">Panel</span><b>{selected.panel_name}</b></div>
          <div className="rd-info-item"><span className="rd-info-label">Lot</span><b>{selected.lot_no}</b></div>
          <div className="rd-info-item"><span className="rd-info-label">Status</span><b>{selected.status}</b></div>
        </div></section>
        {(selected.exception_reason || selected.auto_check_result) && <section className="rd-info-card review-exception">
          <h3>不合規原因</h3><p>{selected.exception_reason}</p>
          <p>Spec: {selected.auto_check_result?.spec_marker} / {selected.auto_check_result?.merge_bias_spec}</p>
          {selected.auto_check_result?.points?.map((point, index) => <div className={point.pass ? 'bias-pass' : 'bias-fail'} key={index}>
            {point.level}: calculated {point.calculated_concentration?.toFixed(3)}, bias {point.bias?.toFixed(3)}{point.mode === 'percent' ? '%' : ''} / limit {point.limit}
          </div>)}
        </section>}
        <textarea className="review-comment" placeholder="Comment" value={comment} onChange={e => setComment(e.target.value)} />
        {!supervisorMode && ['pending_rd','rd_reviewing'].includes(selected.status) && <div className="rd-action-buttons">
          <button disabled={busy} className="rd-btn rd-btn-primary" onClick={() => rdSubmit('approved')}>Approved</button>
          <button disabled={busy} className="rd-btn rd-btn-secondary" onClick={() => rdSubmit('need_adjustment')}>Need Adjustment</button>
          <button disabled={busy} className="rd-btn rd-btn-outline" onClick={() => rdSubmit('failed')}>Failed</button>
        </div>}
        {supervisorMode && selected.status === 'exception' && <div className="review-decisions">
          <button disabled={busy} onClick={() => decide('pass')}>Pass</button>
          <button disabled={busy} onClick={() => decide('reject')}>Reject</button>
          <button disabled={busy} onClick={() => decide('re_test')}>Re-test</button>
          <button disabled={busy} onClick={() => decide('hold')}>Hold</button>
        </div>}
      </div>}
    </main>
  </div>;
}
