import test from 'node:test';
import assert from 'node:assert/strict';
import * as OTPAuth from 'otpauth';
import { createApp } from '../server/index.js';
import { defaultBuilding } from '../shared/model.js';

test('workspace authentication, permissions, persistence, and TOTP work end to end', async () => {
  const { app, db } = createApp({ databasePath: ':memory:' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  async function request(path, body, session = cookie) {
    const response = await fetch(`${base}/api${path}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Cookie: session }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0], data: await response.json() };
  }
  try {
    assert.equal((await request('/inventory')).status, 401);
    assert.equal((await request('/auth')).data.setupRequired, true);
    const register = await request('/auth/register', { name: 'Test Admin', email: 'admin@example.com', password: 'a-long-test-password' });
    assert.equal(register.status, 201);
    cookie = register.cookie;
    assert.equal((await request('/auth/register', { name: 'Another Admin', email: 'other@example.com', password: 'a-long-test-password' })).status, 403);
    assert.equal((await request('/projects', { building: defaultBuilding })).status, 200);
    assert.equal((await request('/projects')).data.length, 1);
    const materials = (await request('/inventory')).data;
    assert.equal((await request('/inventory', { ...materials[0], price: 1350 })).status, 200);
    assert.equal((await request('/inventory')).data[0].price, 1350);
    assert.equal((await request('/users', { name: 'Viewer User', email: 'viewer@example.com', password: 'another-long-password', role: 'viewer' })).status, 201);
    const viewer = await request('/auth/login', { email: 'viewer@example.com', password: 'another-long-password' }, '');
    assert.equal((await request('/projects', { building: defaultBuilding }, viewer.cookie)).status, 403);
    assert.equal((await request('/inventory', materials[0], viewer.cookie)).status, 403);
    assert.equal((await request('/inventory', undefined, viewer.cookie)).data[0].price, null);
    const setup = (await request('/auth/2fa/setup', {})).data;
    assert.ok(setup.qr.startsWith('data:image/png'));
    assert.equal((await request('/auth/2fa/verify', { code: '0000000' })).status, 400);
    const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(setup.secret) });
    const verified = await request('/auth/2fa/verify', { code: totp.generate() });
    assert.equal(verified.status, 200);
    assert.equal(verified.data.user.twoFactor, true);
    cookie = verified.cookie;
    await request('/auth/logout', {});
    const withoutCode = await request('/auth/login', { email: 'admin@example.com', password: 'a-long-test-password' }, '');
    assert.equal(withoutCode.data.requiresTwoFactor, true);
    const replay = await request('/auth/login', { email: 'admin@example.com', password: 'a-long-test-password', code: totp.generate() }, '');
    assert.equal(replay.status, 401);
    assert.ok(db.prepare('SELECT * FROM audit').all().length >= 3);
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
  }
});