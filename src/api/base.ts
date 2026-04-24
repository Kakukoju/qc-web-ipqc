const rawApiBase = import.meta.env.VITE_API_BASE || '/api';

export const API_BASE = rawApiBase.endsWith('/')
  ? rawApiBase.slice(0, -1)
  : rawApiBase;

export function apiUrl(path: string) {
  if (!path.startsWith('/')) return `${API_BASE}/${path}`;
  return `${API_BASE}${path}`;
}
