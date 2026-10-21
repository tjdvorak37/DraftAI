import express from 'express';
import rateLimit from 'express-rate-limit';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import bcrypt from 'bcryptjs';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import { z } from 'zod';
import { buildingSchema, initialInventory } from '../shared/model.js';
import { roles, designRoles, costRoles } from '../shared/access.js';
import { registerWorkspace } from './workspace.js';
import { credentialsSchema, profileSchema } from './accounts.js';
import { inventoryItemSchema } from '../shared/inventory.js';
import { registerInventoryImport } from './inventory.js';
import { registerOperations } from './operations.js';

export function createApp({ databasePath = process.env.DATABASE_PATH || 'data/studio.sqlite', encryptionKey } = {}) {
  if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true });
  const keyPath = `${databasePath}.key`;
  if (!encryptionKey && !process.env.ENCRYPTION_KEY && databasePath !== ':memory:' && !existsSync(keyPath)) writeFileSync(keyPath, randomBytes(32).toString('hex'), { mode: 0o600 });
  const key = Buffer.from(encryptionKey || process.env.ENCRYPTION_KEY || (databasePath === ':memory:' ? randomBytes(32).toString('hex') : readFileSync(keyPath, 'utf8').trim()), 'hex');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must be a 64-character hex key.');
  const seal = value => {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    const content = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([nonce, cipher.getAuthTag(), content]).toString('base64');
  };
  const unseal = value => {
    const buffer = Buffer.from(value, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, buffer.subarray(0, 12));
    decipher.setAuthTag(buffer.subarray(12, 28));
    return Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString('utf8');
  };
  const db = new DatabaseSync(databasePath);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL, totp TEXT, pending_totp TEXT, last_totp INTEGER DEFAULT -1);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL, building TEXT NOT NULL, updated TEXT NOT NULL, author INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS inventory (id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, unit TEXT NOT NULL, stock REAL NOT NULL, price REAL, reorder REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, actor INTEGER, action TEXT NOT NULL, detail TEXT NOT NULL, created TEXT DEFAULT CURRENT_TIMESTAMP);`);
  const insert = db.prepare('INSERT OR IGNORE INTO inventory (id,name,category,unit,stock,price,reorder) VALUES (?,?,?,?,?,?,?)');
  for (const item of initialInventory) insert.run(item.id, item.name, item.category, item.unit, item.stock, item.price, item.reorder);
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10mb' }));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    if (req.path.startsWith('/api')) res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin) {
      try { if (new URL(req.headers.origin).host !== req.headers.host) return res.status(403).json({ error: 'Cross-origin request rejected.' }); }
      catch { return res.status(403).json({ error: 'Invalid request origin.' }); }
    }
    const token = req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith('studio_session='))?.split('=')[1];
    if (token) req.user = db.prepare('SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE token=? AND expires>? AND users.disabled=0').get(createHash('sha256').update(token).digest('hex'), Date.now());
    next();
  });
  const audit = (req, action, detail) => db.prepare('INSERT INTO audit (actor,action,detail) VALUES (?,?,?)').run(req.user?.id || null, action, JSON.stringify(detail));
  const publicUser = user => ({ id: user.id, name: user.name, email: user.email, role: user.role, twoFactor: Boolean(user.totp), disabled: Boolean(user.disabled), address: user.address || '', phone: user.phone || '', department: user.department || '', jobTitle: user.job_title || '',locationId:user.location_id||'MAIN' });
  const allow = (...roles) => (req, res, next) => !req.user ? res.status(401).json({ error: 'Sign in to access your workspace.' }) : roles.length && !roles.includes(req.user.role) ? res.status(403).json({ error: 'Your role does not permit this action.' }) : next();
  const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many attempts. Please try again in 15 minutes.' } });
  const setSession = (res, user) => {
    const token = randomBytes(32).toString('hex');
    db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(createHash('sha256').update(token).digest('hex'), user.id, Date.now() + 8 * 60 * 60 * 1000);
    res.cookie('studio_session', token, { httpOnly: true, sameSite: 'strict', secure: process.env.SESSION_SECURE === 'true', maxAge: 8 * 60 * 60 * 1000, path: '/' });
  };
  const credentials = credentialsSchema;
  const totpFor = (secret, user) => new OTPAuth.TOTP({ issuer: 'Accu-Steel Draft Studio', label: user.email, algorithm: 'SHA1', digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) });
  registerWorkspace({ app, db, allow, audit, publicUser });
  const {inventoryAt,saveItem,activeLocation}=registerOperations({app,db,allow,audit});
  registerInventoryImport({ app, db, allow, audit,inventoryAt,saveItem });
  app.get('/api/auth', (req, res) => res.json({ user: req.user ? publicUser(req.user) : null, setupRequired: !db.prepare('SELECT id FROM users LIMIT 1').get() }));
  app.post('/api/auth/register', authLimit, (req, res) => res.status(403).json({ error: 'Public registration is disabled. Management must provision your account.' }));
  app.post('/api/auth/login', authLimit, async (req, res) => {
    const user = typeof req.body.email === 'string' ? db.prepare('SELECT * FROM users WHERE email=?').get(req.body.email.toLowerCase()) : null;
    const valid = await bcrypt.compare(typeof req.body.password === 'string' ? req.body.password.slice(0, 73) : '', user?.password || '$2b$12$G8pqBhOT.dP1HRK1RdyvjeOTsIKC1Y7RVnQNGL1b9eXRDqjGaR4aG');
    if (!user || !valid || user.disabled) return res.status(401).json({ error: 'Email or password is incorrect.' });
    if (user.totp) {
      if (!req.body.code) return res.status(401).json({ error: 'Enter your authenticator code.', requiresTwoFactor: true });
      const totp = totpFor(unseal(user.totp), user);
      const delta = totp.validate({ token: String(req.body.code), window: 1 });
      const counter = Math.floor(Date.now() / 30000) + (delta ?? 0);
      if (delta === null || counter <= user.last_totp) return res.status(401).json({ error: 'Invalid or already-used authenticator code.' });
      db.prepare('UPDATE users SET last_totp=? WHERE id=?').run(counter, user.id);
    }
    setSession(res, user);
    res.json({ user: publicUser(user) });
  });
  app.post('/api/auth/logout', (req, res) => {
    if (req.user) db.prepare('DELETE FROM sessions WHERE user_id=?').run(req.user.id);
    res.clearCookie('studio_session', { path: '/' });
    res.json({ ok: true });
  });
  app.post('/api/auth/2fa/setup', authLimit, allow(), async (req, res) => {
    if (req.user.totp) return res.status(409).json({ error: 'Two-factor authentication is already enabled.' });
    const secret = new OTPAuth.Secret({ size: 20 }).base32;
    db.prepare('UPDATE users SET pending_totp=? WHERE id=?').run(seal(secret), req.user.id);
    res.json({ secret, qr: await QRCode.toDataURL(totpFor(secret, req.user).toString()) });
  });
  app.post('/api/auth/2fa/verify', authLimit, allow(), (req, res) => {
    if (!req.user.pending_totp) return res.status(400).json({ error: 'Start two-factor setup first.' });
    const delta = totpFor(unseal(req.user.pending_totp), req.user).validate({ token: String(req.body.code), window: 1 });
    if (delta === null) return res.status(400).json({ error: 'That code is not valid. Try the current code in your authenticator.' });
    db.prepare('UPDATE users SET totp=pending_totp,pending_totp=NULL,last_totp=? WHERE id=?').run(Math.floor(Date.now() / 30000) + delta, req.user.id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(req.user.id);
    setSession(res, req.user);
    res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id)) });
  });
  app.get('/api/users', allow('admin'), (req, res) => res.json(db.prepare('SELECT * FROM users ORDER BY id').all().map(publicUser)));
  app.post('/api/users', authLimit, allow('admin'), async (req, res) => {
    const parsed = credentials.extend({ role: z.enum(roles) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Name, email, role, and a 12-72 character password are required.' });
    const data = parsed.data;
    if(!activeLocation(data.locationId))return res.status(400).json({error:'Choose an active work location.'});
    const password = await bcrypt.hash(data.password, 12);
    try {
      if(!activeLocation(data.locationId))return res.status(400).json({error:'Choose an active work location.'});
      const result = db.prepare('INSERT INTO users (name,email,password,role,address,phone,department,job_title,location_id) VALUES (?,?,?,?,?,?,?,?,?)').run(data.name, data.email, password, data.role, data.address, data.phone, data.department, data.jobTitle,data.locationId);
      audit(req, 'user.create', { id: Number(result.lastInsertRowid), role: data.role });
      res.status(201).json({ ok: true });
    } catch { res.status(409).json({ error: 'An account with that email already exists.' }); }
  });
  app.post('/api/users/:id/profile', allow('admin'), (req, res) => {
    const parsed = profileSchema.safeParse(req.body);
    const id = Number(req.params.id);
    if (!parsed.success || !Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Enter a name, valid email, and valid profile fields.' });
    const target = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    if (!target) return res.status(404).json({ error: 'Account not found.' });
    const data = parsed.data;
    if (db.prepare('SELECT id FROM users WHERE email=? AND id<>?').get(data.email, id)) return res.status(409).json({ error: 'Another account already uses that email.' });
    if(!activeLocation(data.locationId))return res.status(400).json({error:'Choose an active work location.'});
    db.prepare('UPDATE users SET name=?,email=?,address=?,phone=?,department=?,job_title=?,location_id=? WHERE id=?').run(data.name, data.email, data.address, data.phone, data.department, data.jobTitle,data.locationId, id);
    if (target.email !== data.email) db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
    audit(req, 'user.profile.update', { id, fields: ['name', 'email', 'address', 'phone', 'department', 'jobTitle'], sessionsRevoked: target.email !== data.email });
    res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id)), requiresSignIn: target.email !== data.email && id === req.user.id });
  });
  app.get('/api/inventory', allow(), (req, res) => {
    try{const items=inventoryAt(req.query.location||req.user.location_id||'MAIN',req.query.flat==='true');res.json(items.map(item=>costRoles.includes(req.user.role)?item:{...item,price:null}));}catch(error){res.status(400).json({error:error.message});}
  });
  const itemSchema = inventoryItemSchema;
  app.post('/api/inventory', allow('admin', 'estimator'), (req, res) => {
    const parsed = itemSchema.safeParse({...req.body,location_id:req.body.location_id||req.user.location_id||'MAIN'});
    if (!parsed.success) return res.status(400).json({ error: 'Check the part ID, unit, stock, and cost. Leave unknown costs blank.' });
    const item = parsed.data;
    db.exec('BEGIN IMMEDIATE');try{saveItem(item,req.user.id);audit(req,'inventory.save',{id:item.id,locationId:item.location_id});db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');return res.status(409).json({error:error.message});}
    res.json({ ok: true });
  });
  app.get('/api/projects', allow(), (req, res) => res.json(db.prepare('SELECT projects.*,users.name AS author_name FROM projects JOIN users ON users.id=projects.author ORDER BY updated DESC').all().map(project => ({ ...project, building: JSON.parse(project.building) }))));
  app.post('/api/projects', allow(...designRoles), (req, res) => {
    const parsed = buildingSchema.safeParse(req.body.building);
    const id = req.body.id;
    if (!parsed.success || (id != null && (!Number.isSafeInteger(id) || id < 1))) return res.status(400).json({ error: 'The building contains invalid dimensions or project ID.' });
    const building = parsed.data;
    const updated = new Date().toISOString();
    if (id && !db.prepare('SELECT id FROM projects WHERE id=?').get(id)) return res.status(404).json({ error: 'Project not found.' });
    const result = id ? db.prepare('UPDATE projects SET name=?,building=?,updated=?,author=?,revision=revision+1 WHERE id=?').run(building.name, JSON.stringify(building), updated, req.user.id, id) : db.prepare('INSERT INTO projects (name,building,updated,author,owner) VALUES (?,?,?,?,?)').run(building.name, JSON.stringify(building), updated, req.user.id, req.user.id);
    const projectId = id || Number(result.lastInsertRowid);
    audit(req, 'project.save', { id: projectId });
    res.json({ id: projectId, updated });
  });
  app.post('/api/ai/design', allow(...designRoles), (req, res) => res.status(410).json({ error: 'External AI design requests are paused while provider and engineering workflows are under review. Supported dimensional commands run locally.' }));
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(resolve('dist')));
    app.get('/{*path}', (req, res, next) => req.path.startsWith('/api/') ? next() : res.sendFile(resolve('dist/index.html')));
  }
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    res.status(error.status || 500).json({ error: error.status === 413 ? 'Request is too large.' : 'Unable to complete the request.' });
  });
  return { app, db };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { app } = createApp();
  app.listen(Number(process.env.API_PORT || 3001), '0.0.0.0', () => console.log(`Draft Studio API listening on ${process.env.API_PORT || 3001}`));
}