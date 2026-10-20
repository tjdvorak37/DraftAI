import { supabaseApi } from './supabaseApi.js';

export async function api(path, body) {
  const backend = import.meta.env.VITE_BACKEND || (import.meta.env.PROD ? 'supabase' : 'local');
  if (backend === 'supabase') return supabaseApi(path, body);
  if (backend !== 'local') throw new Error('Unknown backend configuration. Access is locked.');
  const response = await fetch(`/api${path}`, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...(body !== undefined ? { method: 'POST', body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) { if (response.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('studio:unauthorized')); const error = new Error(data.error || 'Request failed.'); Object.assign(error, data); throw error; }
  return data;
}