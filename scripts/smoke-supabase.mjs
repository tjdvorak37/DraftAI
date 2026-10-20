import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { defaultBuilding } from '../shared/model.js';

const projectRef = process.argv[process.argv.indexOf('--project-ref') + 1];
if (!/^[a-z]{20}$/.test(projectRef || '') || !process.argv.includes('--allow-temporary-data')) {
  throw new Error('Use --project-ref YOUR_REF --allow-temporary-data. This smoke test creates and removes isolated test accounts and records.');
}
const raw = JSON.parse(execFileSync('npx', ['supabase', 'projects', 'api-keys', '--project-ref', projectRef, '--output', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
const keys = Array.isArray(raw) ? raw : raw.keys || raw.api_keys || [];
const publicKey = keys.find(key => key.type === 'publishable' || key.name === 'anon')?.api_key;
const privateKey = keys.find(key => key.name === 'service_role')?.api_key;
if (!publicKey || !privateKey) throw new Error('CLI project credentials unavailable. No accounts or records created.');
const url = `https://${projectRef}.supabase.co`;
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(url, privateKey, options);
const anonymous = createClient(url, publicKey, options);
const origin = process.env.SMOKE_APP_ORIGIN || `https://${process.env.CODESPACE_NAME}-5173.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`;
const tag = randomBytes(6).toString('hex');
const partId = `SMOKE-${tag}`;
const identities = [];
function check(result) { if (result.error) throw new Error(result.error.message); return result.data; }
async function temporaryUser(role) {
  const email = `draftai-smoke-${role}-${tag}@example.test`;
  const password = randomBytes(24).toString('base64url');
  const { user } = check(await service.auth.admin.createUser({ email, password, email_confirm: true }));
  identities.push(user.id);
  if (role !== 'outsider') check(await service.from('profiles').insert({ id: user.id, name: `Deployment ${role}`, email, role, address: 'Temporary smoke-test address' }));
  const sdk = createClient(url, publicKey, options);
  const { session } = check(await sdk.auth.signInWithPassword({ email, password }));
  return { id: user.id, sdk, token: session.access_token };
}
async function call(token, path, body) {
  const response = await fetch(`${url}/functions/v1/workspace-api`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: publicKey, ...(token ? { Authorization: `Bearer ${token}` } : {}), Origin: origin }, body: JSON.stringify({ path, method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { body }) }) });
  return { status: response.status, data: await response.json() };
}
async function removeFixtures(ids, partIds) {
  const errors = [];
  for (const [table, column, values] of [['inventory', 'id', partIds], ['tickets', 'reporter', ids], ['projects', 'author', ids], ['audit', 'actor', ids], ['inventory_imports', 'actor', ids], ['profiles', 'id', ids]]) {
    if (!values.length) continue;
    const result = await service.from(table).delete().in(column, values);
    if (result.error) errors.push(`${table}: ${result.error.message}`);
  }
  for (const id of ids) { const result = await service.auth.admin.deleteUser(id); if (result.error) errors.push(`Auth: ${result.error.message}`); }
  if (errors.length) throw new Error(`Fixture cleanup requires attention: ${errors.join('; ')}`);
}

let failed = false;
try {
  const accounts = check(await service.auth.admin.listUsers({ page: 1, perPage: 1000 })).users;
  const fixtures = accounts.filter(account => /^draftai-(?:smoke-(?:admin|viewer|outsider)|blocked)-[a-f0-9]{12}@example\.test$/.test(account.email || ''));
  const fixtureTags = [...new Set(fixtures.map(account => account.email.match(/-([a-f0-9]{12})@/)?.[1]).filter(Boolean))];
  if (fixtures.length) {
    await removeFixtures(fixtures.map(account => account.id), fixtureTags.map(value => `SMOKE-${value}`));
    console.log(`Removed ${fixtures.length} temporary accounts left by an interrupted deployment check.`);
  }
  const unauthenticated = await call(null, '/inventory');
  assert.equal(unauthenticated.status, 401, `Unauthenticated endpoint returned ${unauthenticated.status}: ${JSON.stringify(unauthenticated.data)}`);
  const admin = await temporaryUser('admin');
  const viewer = await temporaryUser('viewer');
  const outsider = await temporaryUser('outsider');
  const authenticated = await call(admin.token, '/auth');
  assert.equal(authenticated.status, 200, JSON.stringify(authenticated.data));
  assert.equal(authenticated.data.user.role, 'admin');
  const item = { id: partId, name: 'Temporary deployment check', category: 'Temporary smoke test', unit: 'ea', stock: 4, price: 12.5, reorder: 1, location: '', supplier: '' };
  const saved = await call(admin.token, '/inventory', item);
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal((await call(viewer.token, '/inventory', item)).status, 403);
  assert.equal((await call(outsider.token, '/inventory')).status, 403);
  const inventory = await call(viewer.token, '/inventory');
  assert.equal(inventory.status, 200, JSON.stringify(inventory.data));
  assert.equal(inventory.data.find(part => part.id === partId).price, null);
  assert.equal(check(await viewer.sdk.from('inventory_costs').select('*')).length, 0);
  assert.equal(check(await viewer.sdk.from('profiles').select('*')).length, 1);
  assert.equal(check(await outsider.sdk.from('inventory').select('*')).length, 0);
  const project = await call(admin.token, '/projects', { building: { ...defaultBuilding, name: `Deployment check ${tag}` } });
  assert.equal(project.status, 200, JSON.stringify(project.data));
  const projectId = project.data.id;
  const updated = await call(admin.token, `/projects/${projectId}/details`, { client: 'Temporary smoke test', location: 'Test site', status: 'Review', owner: admin.id, due_date: '', notes: 'Temporary deployment verification only.', revision: 1 });
  assert.equal(updated.status, 200, JSON.stringify(updated.data));
  const projects = await call(admin.token, '/projects');
  assert.equal(projects.status, 200, JSON.stringify(projects.data));
  assert.equal(projects.data.find(item => item.id === projectId).owner, admin.id);
  assert.equal((await call(viewer.token, '/projects', { building: defaultBuilding })).status, 403);
  const ticket = await call(viewer.token, '/tickets', { title: 'Temporary deployment ticket', description: 'Checking the private support workflow on the deployed function.', category: 'Other', priority: 'Normal', project_id: projectId });
  assert.equal(ticket.status, 201, JSON.stringify(ticket.data));
  const ticketId = ticket.data.id;
  const triage = await call(admin.token, `/tickets/${ticketId}/triage`, { status: 'In progress', priority: 'Normal', assignee: admin.id });
  assert.equal(triage.status, 200, JSON.stringify(triage.data));
  assert.equal((await call(admin.token, `/tickets/${ticketId}/replies`, { body: 'Temporary staff reply.' })).status, 200);
  const conversation = await call(viewer.token, `/tickets/${ticketId}`);
  assert.equal(conversation.status, 200, JSON.stringify(conversation.data));
  assert.equal(conversation.data.messages.length, 1);
  const denied = await anonymous.from('inventory').select('*');
  assert.ok(denied.error || denied.data.length === 0);
  const signup = await anonymous.auth.signUp({ email: `draftai-blocked-${tag}@example.test`, password: randomBytes(24).toString('base64url') });
  if (signup.data?.user) identities.push(signup.data.user.id);
  assert.ok(signup.error, 'Public signup must be disabled.');
  console.log('PASS: hosted Auth, function access, inventory writes, project creation/ownership, private tickets/replies, role restrictions, cost/contact privacy, anonymous/nonstaff denial, and disabled public signup.');
} catch (error) {
  failed = true;
  console.error(`FAIL: ${error.message}`);
} finally {
  try { await removeFixtures(identities, [partId]); console.log('Temporary records/accounts removed. No permanent administrator was created.'); }
  catch (error) { failed = true; console.error(error.message); }
}
if (failed) process.exitCode = 1;