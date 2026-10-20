import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/index.js';
import { provisionInitialAdmin } from '../server/accounts.js';
import { defaultBuilding } from '../shared/model.js';

test('admin configuration, management projects, and private staff tickets enforce access', async () => {
  const { app, db } = createApp({ databasePath: ':memory:' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function request(path, body, cookie = '') {
    const response = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  try {
    await provisionInitialAdmin(db, { name: 'Admin User', email: 'admin@test.com', password: 'long-admin-password' });
    const admin = (await request('/auth/login', { email: 'admin@test.com', password: 'long-admin-password' })).cookie;
    for (const role of ['manager', 'technician', 'viewer']) assert.equal((await request('/users', { name: `${role} user`, email: `${role}@test.com`, password: 'long-staff-password', role }, admin)).status, 201);
    const manager = (await request('/auth/login', { email: 'manager@test.com', password: 'long-staff-password' })).cookie;
    const technician = (await request('/auth/login', { email: 'technician@test.com', password: 'long-staff-password' })).cookie;
    const viewer = (await request('/auth/login', { email: 'viewer@test.com', password: 'long-staff-password' })).cookie;
    assert.equal((await request('/admin', undefined, manager)).status, 403);
    const ambiguous = await request('/ai/design', { building: defaultBuilding, prompt: 'Raise the building height 2 ft and move the window 20 feet from the southeast corner' }, manager);
    assert.equal(ambiguous.status, 422);
    assert.equal(ambiguous.data.needsClarification, true);
    assert.equal((await request('/admin/settings', { name: 'Accu-Steel Operations', supportEmail: 'help@test.com' }, admin)).status, 200);
    assert.equal((await request('/workspace', undefined, admin)).data.name, 'Accu-Steel Operations');
    assert.equal((await request('/admin/integrations/openai', { model: 'gpt-4o-mini', enabled: false, apiKey: 'test-only-not-a-provider-key' }, admin)).status, 200);
    const settings = await request('/admin', undefined, admin);
    assert.equal(settings.data.integrations.openai.configured, true);
    assert.ok(!JSON.stringify(settings.data).includes('test-only-not-a-provider-key'));
    assert.ok(!db.prepare("SELECT value FROM settings WHERE id='openai_key'").get().value.includes('test-only'));
    const project = (await request('/projects', { building: defaultBuilding }, manager)).data;
    assert.ok(project.id);
    const metadata = { client: 'Iowa Farm', location: 'Audubon, IA', status: 'Review', owner: 2, due_date: '2026-12-01', notes: 'Confirm site loads.', revision: 1 };
    assert.equal((await request(`/projects/${project.id}/details`, metadata, viewer)).status, 403);
    assert.equal((await request(`/projects/${project.id}/details`, metadata, manager)).status, 200);
    assert.equal((await request(`/projects/${project.id}/details`, metadata, manager)).status, 409);
    assert.equal((await request('/projects', undefined, manager)).data[0].client, 'Iowa Farm');
    const ticket = (await request('/tickets', { title: 'Drawing does not import', description: 'The source file reports no reference geometry.', category: 'Design', priority: 'High', project_id: project.id }, viewer)).data;
    assert.ok(ticket.id);
    assert.equal((await request('/tickets', undefined, manager)).data.length, 0);
    assert.equal((await request(`/tickets/${ticket.id}`, undefined, manager)).status, 404);
    assert.equal((await request(`/tickets/${ticket.id}/replies`, { body: 'Please send the ASCII DXF export.' }, manager)).status, 404);
    assert.equal((await request(`/tickets/${ticket.id}/triage`, { status: 'In progress', priority: 'High', assignee: 3 }, viewer)).status, 403);
    assert.equal((await request(`/tickets/${ticket.id}/triage`, { status: 'In progress', priority: 'High', assignee: 3 }, technician)).status, 200);
    assert.equal((await request(`/tickets/${ticket.id}/replies`, { body: 'Please export as ASCII DXF.' }, technician)).status, 200);
    assert.equal((await request(`/tickets/${ticket.id}/replies`, { body: 'That worked, thank you.' }, viewer)).status, 200);
    assert.equal((await request(`/tickets/${ticket.id}`, undefined, viewer)).data.messages.length, 2);
    assert.equal((await request('/inventory', undefined, technician)).data[0].price, null);
    assert.equal((await request('/users/1/access', { role: 'viewer', disabled: false }, admin)).status, 400);
    assert.equal((await request('/users/3/access', { role: 'technician', disabled: true }, admin)).status, 200);
    assert.equal((await request('/tickets', undefined, technician)).status, 401);
    assert.equal((await request('/auth/login', { email: 'technician@test.com', password: 'long-staff-password' })).status, 401);
  } finally { await new Promise(resolve => server.close(resolve)); db.close(); }
});