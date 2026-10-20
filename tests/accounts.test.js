import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/index.js';
import { provisionInitialAdmin } from '../server/accounts.js';

test('public registration is closed and management controls private user profiles and access', async () => {
  const { app, db } = createApp({ databasePath: ':memory:' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const profile = { name: 'Staff Engineer', email: 'staff@example.test', address: '123 Test Street', phone: '+1 555 010 0130', department: 'Engineering', jobTitle: 'Design Engineer' };
  const adminInput = { name: 'Management Admin', email: 'admin@example.test', password: 'management-test-password' };
  async function request(path, body, cookie = '') {
    const response = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  try {
    assert.equal((await request('/auth/register', adminInput)).status, 403);
    for (const path of ['/workspace', '/projects', '/inventory', '/admin', '/users', '/tickets']) assert.equal((await request(path)).status, 401);
    await provisionInitialAdmin(db, adminInput);
    await assert.rejects(() => provisionInitialAdmin(db, { ...adminInput, email: 'second@example.test' }), /already has accounts/);
    const admin = (await request('/auth/login', adminInput)).cookie;
    assert.ok(admin);
    assert.equal((await request('/users', { ...profile, role: 'engineer', password: 'staff-test-password' })).status, 401);
    assert.equal((await request('/users', { ...profile, role: 'engineer', password: 'staff-test-password' }, admin)).status, 201);
    const staff = (await request('/auth/login', { email: profile.email, password: 'staff-test-password' })).cookie;
    assert.equal((await request('/users', undefined, staff)).status, 403);
    assert.equal((await request('/users/2/profile', profile, staff)).status, 403);
    const edited = await request('/users/2/profile', { ...profile, address: '456 Updated Street', phone: '+1 555 010 0140' }, admin);
    assert.equal(edited.status, 200);
    assert.equal(edited.data.user.address, '456 Updated Street');
    assert.equal((await request('/auth', undefined, staff)).data.user.phone, '+1 555 010 0140');
    assert.equal((await request('/users/2/profile', { ...profile, email: adminInput.email }, admin)).status, 409);
    assert.equal((await request('/users/2/access', { role: 'engineer', disabled: true }, admin)).status, 200);
    assert.equal((await request('/projects', undefined, staff)).status, 401);
    assert.ok(!JSON.stringify(db.prepare("SELECT detail FROM audit WHERE action='user.profile.update'").all()).includes('456 Updated Street'));
  } finally { await new Promise(resolve => server.close(resolve)); db.close(); }
});