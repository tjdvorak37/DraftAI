import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceHandler } from '../supabase/functions/_shared/api.js';

const env = name => ({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'public-test-key', SUPABASE_SERVICE_ROLE_KEY: 'private-test-only', ALLOWED_ORIGINS: 'https://draft.example.test' }[name]);
const token = `header.${btoa(JSON.stringify({ aal: 'aal1' }))}.signature`;
const request = (body, options = {}) => new Request('https://example.supabase.co/functions/v1/workspace-api', { method: 'POST', headers: { Origin: 'https://draft.example.test', 'Content-Type': 'application/json', ...options }, body: JSON.stringify(body) });

test('Supabase function rejects missing sessions, nonstaff accounts, unapproved origins, and insufficient MFA', async () => {
  const noClient = () => { throw new Error('Must not call a provider'); };
  const handler = createWorkspaceHandler({ createClient: noClient, env });
  assert.equal((await handler(request({ path: '/admin' }))).status, 401);
  assert.equal((await handler(request({ path: '/admin' }, { Origin: 'https://untrusted.example.test' }))).status, 403);
  const mock = profile => () => ({ auth: { getUser: async () => ({ data: { user: { id: 'staff-id', factors: profile?.factors || [] } }, error: null }) }, rpc: async () => ({ data: profile?.role || null, error: null }), from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile, error: null }) }) }) }) });
  const nonstaff = createWorkspaceHandler({ createClient: mock(null), env });
  assert.equal((await nonstaff(request({ path: '/inventory' }, { Authorization: `Bearer ${token}` }))).status, 403);
  const disabled = createWorkspaceHandler({ createClient: mock({ id: 'staff-id', role: 'admin', disabled: true }), env });
  assert.equal((await disabled(request({ path: '/inventory' }, { Authorization: `Bearer ${token}` }))).status, 403);
  const mfa = createWorkspaceHandler({ createClient: mock({ id: 'staff-id', role: 'admin', factors: [{ status: 'verified' }] }), env });
  const response = await mfa(request({ path: '/inventory' }, { Authorization: `Bearer ${token}` }));
  assert.equal(response.status, 401);
  assert.equal((await response.json()).requiresTwoFactor, true);
  const viewer = createWorkspaceHandler({ createClient: mock({ id: 'staff-id', role: 'viewer' }), env });
  assert.equal((await viewer(request({ path: '/users', method: 'POST', body: {} }, { Authorization: `Bearer ${token}` }))).status, 403);
});