import { apiUrl } from './base';

const BASE = apiUrl('/v1/pre-assignment');
export type ReviewStatus = 'pending_rd'|'rd_reviewing'|'rd_done'|'pass'|'exception'|'reject'|'re_test'|'hold';
export interface ReviewTask {
  id: number; panel_name: string; lot_no: string; mfg_lot_no?: string;
  work_order_no?: string; status: ReviewStatus; exception_reason?: string;
  rd_result?: { result?: string; comment?: string; result_json?: Record<string, unknown> };
  auto_check_result?: {
    pass: boolean; spec_marker?: string; merge_bias_spec?: string; reasons?: string[];
    points?: Array<{ level: string; od: number; expected_concentration: number; calculated_concentration: number; bias: number; limit: number; mode: string; pass: boolean }>;
  };
}
async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${BASE}${path}`, init);
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.error?.message || 'Request failed');
  return payload.data;
}
export const fetchReviewTasks = (status = '') => request(`/review-tasks${status ? `?status=${encodeURIComponent(status)}` : ''}`);
export const fetchReviewTask = (id: number) => request(`/review-tasks/${id}`);
export const submitRdReview = (id: number, body: object) => request(`/review-tasks/${id}/rd-submit`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
export const submitSupervisorDecision = (id: number, body: object) => request(`/review-tasks/${id}/supervisor-decision`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
export async function subscribePush(input: { user_id: string; role: string; device_name: string; platform: string }) {
  const key = await request('/push/vapid-public-key');
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: Uint8Array.from(atob(key.public_key.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)),
  });
  return request('/push/subscribe', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, subscription: subscription.toJSON() }),
  });
}
