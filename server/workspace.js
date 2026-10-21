import { z } from 'zod';
import { roles, projectRoles, supportRoles, projectStatuses, ticketStatuses, ticketPriorities } from '../shared/access.js';

export function registerWorkspace({ app, db, allow, audit, publicUser }) {
  const addColumn = (table, column, sql) => {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some(item => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${sql}`);
  };
  addColumn('users', 'disabled', 'INTEGER NOT NULL DEFAULT 0');
  for (const column of ['address', 'phone', 'department', 'job_title']) addColumn('users', column, "TEXT NOT NULL DEFAULT ''");
  for (const [column, sql] of Object.entries({ client: "TEXT NOT NULL DEFAULT ''", location: "TEXT NOT NULL DEFAULT ''", status: "TEXT NOT NULL DEFAULT 'Planning'", owner: 'INTEGER', due_date: "TEXT NOT NULL DEFAULT ''", notes: "TEXT NOT NULL DEFAULT ''", revision: 'INTEGER NOT NULL DEFAULT 1' })) addColumn('projects', column, sql);
  db.exec(`CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tickets (id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL, priority TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Open', reporter INTEGER NOT NULL, assignee INTEGER, project_id INTEGER, created TEXT NOT NULL, updated TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ticket_messages (id INTEGER PRIMARY KEY, ticket_id INTEGER NOT NULL, author INTEGER NOT NULL, body TEXT NOT NULL, created TEXT NOT NULL);`);
  const setting = (id, fallback = '') => db.prepare('SELECT value FROM settings WHERE id=?').get(id)?.value ?? fallback;
  const saveSetting = (id, value) => db.prepare('INSERT INTO settings VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(id, value);
  const workspaceSettings = () => ({ name: setting('workspace_name', 'Accu-Steel workspace'), supportEmail: setting('support_email') });
  app.get('/api/workspace', allow(), (req, res) => res.json(workspaceSettings()));
  app.get('/api/admin', allow('admin'), (req, res) => {
    res.json({ ...workspaceSettings(), integrations: { providerSelection: 'under-review' }, counts: { users: db.prepare('SELECT COUNT(*) AS total FROM users WHERE disabled=0').get().total, projects: db.prepare('SELECT COUNT(*) AS total FROM projects').get().total, tickets: db.prepare("SELECT COUNT(*) AS total FROM tickets WHERE status NOT IN ('Resolved','Closed')").get().total }, audit: db.prepare('SELECT audit.id, audit.action, audit.detail, audit.created, users.name AS actor_name FROM audit LEFT JOIN users ON users.id=audit.actor ORDER BY audit.id DESC LIMIT 60').all() });
  });
  app.post('/api/admin/settings', allow('admin'), (req, res) => {
    const parsed = z.object({ name: z.string().trim().min(2).max(80), supportEmail: z.union([z.email(), z.literal('')]) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Enter a workspace name and valid support email, or leave the email blank.' });
    saveSetting('workspace_name', parsed.data.name);
    saveSetting('support_email', parsed.data.supportEmail);
    audit(req, 'settings.update', parsed.data);
    res.json(workspaceSettings());
  });
  app.post('/api/admin/integrations/openai', allow('admin'), (req, res) => res.status(410).json({ error: 'Provider connections are paused while AI and engineering workflows are under review. Existing credentials are retained but inactive.' }));
  app.post('/api/admin/integrations/openai/test', allow('admin'), (req, res) => res.status(410).json({ error: 'Provider connections are paused while AI and engineering workflows are under review.' }));
  app.post('/api/users/:id/access', allow('admin'), (req, res) => {
    const parsed = z.object({ role: z.enum(roles), disabled: z.boolean() }).safeParse(req.body);
    const id = Number(req.params.id);
    if (!parsed.success || !Number.isSafeInteger(id)) return res.status(400).json({ error: 'Choose a valid role and account status.' });
    const target = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    if (!target) return res.status(404).json({ error: 'Account not found.' });
    if (id === req.user.id && (parsed.data.disabled || parsed.data.role !== 'admin')) return res.status(400).json({ error: 'You cannot disable or demote your own administrator account.' });
    db.prepare('UPDATE users SET role=?,disabled=? WHERE id=?').run(parsed.data.role, Number(parsed.data.disabled), id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
    audit(req, 'user.access.update', { id, ...parsed.data });
    res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id)) });
  });
  const metadata = z.object({ client: z.string().trim().max(120), location: z.string().trim().max(200), status: z.enum(projectStatuses), owner: z.number().int().positive().nullable(), due_date: z.union([z.iso.date(), z.literal('')]), notes: z.string().max(5000), revision: z.number().int().positive() });
  app.get('/api/project-owners', allow(), (req, res) => res.json(db.prepare("SELECT id,name,role FROM users WHERE disabled=0 AND role IN ('admin','manager','engineer') ORDER BY name").all()));
  app.post('/api/projects/:id/details', allow(...projectRoles), (req, res) => {
    const parsed = metadata.safeParse(req.body);
    const project = db.prepare('SELECT * FROM projects WHERE id=?').get(Number(req.params.id));
    if (!project) return res.status(404).json({ error: 'Project not found.' });
    if (!parsed.success) return res.status(400).json({ error: 'Check project status, date, owner, and notes.' });
    const data = parsed.data;
    if (data.owner && !db.prepare("SELECT id FROM users WHERE id=? AND disabled=0 AND role IN ('admin','manager','engineer')").get(data.owner)) return res.status(400).json({ error: 'Select an active administrator, manager, or engineer as owner.' });
    const result = db.prepare('UPDATE projects SET client=?,location=?,status=?,owner=?,due_date=?,notes=?,updated=?,revision=revision+1 WHERE id=? AND revision=?').run(data.client, data.location, data.status, data.owner, data.due_date, data.notes, new Date().toISOString(), project.id, data.revision);
    if (!result.changes) return res.status(409).json({ error: 'This project changed since you opened it. Reload the project center and retry.' });
    audit(req, 'project.details.update', { id: project.id, status: data.status, owner: data.owner });
    res.json({ ok: true });
  });
  const isStaff = user => supportRoles.includes(user.role);
  const ticketById = (id, user) => db.prepare('SELECT * FROM tickets WHERE id=?').get(id);
  const canRead = (ticket, user) => ticket && (isStaff(user) || ticket.reporter === user.id);
  app.get('/api/support/agents', allow(), (req, res) => res.json(isStaff(req.user) ? db.prepare("SELECT id,name FROM users WHERE disabled=0 AND role IN ('admin','technician') ORDER BY name").all() : []));
  app.get('/api/tickets', allow(), (req, res) => {
    const query = `SELECT tickets.*, reporter.name AS reporter_name, agent.name AS assignee_name, projects.name AS project_name FROM tickets JOIN users reporter ON reporter.id=tickets.reporter LEFT JOIN users agent ON agent.id=tickets.assignee LEFT JOIN projects ON projects.id=tickets.project_id`;
    res.json(db.prepare(`${query}${isStaff(req.user) ? '' : ' WHERE tickets.reporter=?'} ORDER BY tickets.updated DESC,tickets.id DESC`).all(...(isStaff(req.user) ? [] : [req.user.id])));
  });
  const ticketSchema = z.object({ title: z.string().trim().min(4).max(140), description: z.string().trim().min(10).max(10000), category: z.enum(['Design', 'Inventory', 'Account', 'Integration', 'Other']), priority: z.enum(ticketPriorities), project_id: z.number().int().positive().nullable() });
  app.post('/api/tickets', allow(), (req, res) => {
    const parsed = ticketSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Add a title (4+ characters), description (10+ characters), category, and priority.' });
    const data = parsed.data;
    if (data.project_id && !db.prepare('SELECT id FROM projects WHERE id=?').get(data.project_id)) return res.status(400).json({ error: 'The linked project no longer exists.' });
    const now = new Date().toISOString();
    const result = db.prepare('INSERT INTO tickets (title,description,category,priority,reporter,project_id,created,updated) VALUES (?,?,?,?,?,?,?,?)').run(data.title, data.description, data.category, data.priority, req.user.id, data.project_id, now, now);
    const id = Number(result.lastInsertRowid);
    audit(req, 'ticket.create', { id, priority: data.priority });
    res.status(201).json({ id });
  });
  app.get('/api/tickets/:id', allow(), (req, res) => {
    const ticket = ticketById(Number(req.params.id), req.user);
    if (!canRead(ticket, req.user)) return res.status(404).json({ error: 'Ticket not found.' });
    res.json({ ...ticket, messages: db.prepare('SELECT ticket_messages.*,users.name AS author_name,users.role AS author_role FROM ticket_messages JOIN users ON users.id=ticket_messages.author WHERE ticket_id=? ORDER BY ticket_messages.id').all(ticket.id) });
  });
  app.post('/api/tickets/:id/replies', allow(), (req, res) => {
    const ticket = ticketById(Number(req.params.id), req.user);
    if (!canRead(ticket, req.user)) return res.status(404).json({ error: 'Ticket not found.' });
    const parsed = z.object({ body: z.string().trim().min(1).max(5000) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Enter a reply of 1-5,000 characters.' });
    const now = new Date().toISOString();
    db.prepare('INSERT INTO ticket_messages (ticket_id,author,body,created) VALUES (?,?,?,?)').run(ticket.id, req.user.id, parsed.data.body, now);
    db.prepare('UPDATE tickets SET updated=? WHERE id=?').run(now, ticket.id);
    audit(req, 'ticket.reply', { id: ticket.id });
    res.json({ ok: true });
  });
  app.post('/api/tickets/:id/triage', allow(...supportRoles), (req, res) => {
    const ticket = ticketById(Number(req.params.id), req.user);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });
    const parsed = z.object({ status: z.enum(ticketStatuses), priority: z.enum(ticketPriorities), assignee: z.number().int().positive().nullable() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Choose a valid status, priority, and assignee.' });
    const data = parsed.data;
    if (data.assignee && !db.prepare("SELECT id FROM users WHERE id=? AND disabled=0 AND role IN ('admin','technician')").get(data.assignee)) return res.status(400).json({ error: 'Select an active technician or administrator.' });
    db.prepare('UPDATE tickets SET status=?,priority=?,assignee=?,updated=? WHERE id=?').run(data.status, data.priority, data.assignee, new Date().toISOString(), ticket.id);
    audit(req, 'ticket.triage', { id: ticket.id, ...data });
    res.json({ ok: true });
  });
  return { workspaceSettings };
}