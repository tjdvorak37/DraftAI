import { z } from 'zod';
import { buildingSchema, parseDesignCommand } from '../../../shared/model.js';
import { inventoryItemSchema, inventoryFields, previewInventoryImport } from '../../../shared/inventory.js';
import { roles, designRoles, costRoles, supportRoles, projectStatuses, ticketStatuses, ticketPriorities } from '../../../shared/access.js';
import { routeOperations } from './operations.js';
import { routeSupply } from './supply.js';

const profileSchema = z.object({ name: z.string().trim().min(2).max(80), email: z.email().max(254).transform(value => value.toLowerCase()), address: z.string().max(500).default(''), phone: z.string().max(40).default(''), department: z.string().max(80).default(''), jobTitle: z.string().max(80).default(''), locationId:z.string().regex(/^[A-Z0-9][A-Z0-9_-]{0,23}$/).default('MAIN') });
const creationSchema = profileSchema.extend({ password: z.string().min(12).max(72), role: z.enum(roles) });
const profileInput = data => ({ name: data.name, email: data.email, address: data.address, phone: data.phone, department: data.department, job_title: data.jobTitle, location_id:data.locationId });
const publicProfile = (profile, factors = []) => ({ ...profile, jobTitle: profile.job_title, locationId:profile.location_id, twoFactor: factors.some(factor => factor.factor_type === 'totp' && factor.status === 'verified') });
const failure = (message, status = 400, extra = {}) => Object.assign(new Error(message), { status, ...extra });
function checked(result) { if (result.error) throw failure(result.error.message, result.error.code === '42501' ? 403 : 400); return result.data; }
async function allRows(client, table, columns = '*') {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const batch = checked(await client.from(table).select(columns).order('id').range(offset, offset + 999));
    rows.push(...batch);
    if (batch.length < 1000) return rows;
  }
}
async function cryptKey(secret) {
  if (!/^[a-f0-9]{64}$/i.test(secret || '')) throw failure('Configure WORKSPACE_ENCRYPTION_KEY in Supabase function secrets before storing an API key.');
  return crypto.subtle.importKey('raw', new Uint8Array(secret.match(/../g).map(byte => parseInt(byte, 16))), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function encrypt(value, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await cryptKey(secret), new TextEncoder().encode(value)));
  return btoa(String.fromCharCode(...iv, ...encrypted));
}
async function decrypt(value, secret) {
  const bytes = Uint8Array.from(atob(value), character => character.charCodeAt(0));
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, await cryptKey(secret), bytes.subarray(12)));
}

export function createWorkspaceHandler({ createClient, env, fetchProvider = fetch }) {
  return async request => {
    const allowedOrigins = (env('ALLOWED_ORIGINS') || '').split(',').map(value => value.trim()).filter(Boolean);
    const origin = request.headers.get('origin');
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
    if (origin && allowedOrigins.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
    const respond = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });
    if (origin && !allowedOrigins.includes(origin)) return respond({ error: 'This application origin is not allowed.' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return respond({ error: 'Use POST.' }, 405);
    try {
      const url = env('SUPABASE_URL');
      const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
      const anonymousKey = env('SUPABASE_ANON_KEY');
      if (!url || !serviceKey || !anonymousKey) throw failure('Supabase function configuration is incomplete.', 503);
      const authorization = request.headers.get('authorization') || '';
      const token = authorization.match(/^Bearer (.+)$/i)?.[1];
      if (!token) throw failure('Sign in to access your workspace.', 401);
      const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const auth = await service.auth.getUser(token);
      if (auth.error || !auth.data.user) throw failure('Your session expired. Sign in again.', 401);
      const identity = auth.data.user;
      const profile = checked(await service.from('profiles').select('*').eq('id', identity.id).maybeSingle());
      if (!profile || profile.disabled) throw failure('Your account is not authorized. Contact management.', 403);
      const source = await request.text();
      if (source.length > 10 * 1024 * 1024) throw failure('Request exceeds 10 MB.', 413);
      const input = JSON.parse(source);
      const incomingPath = typeof input.path==='string' ? new URL(input.path,'https://workspace.internal') : null;
      const path = incomingPath?.pathname;
      const method = input.method || 'GET';
      const body = input.body || {};
      if (typeof path !== 'string' || !['GET', 'POST'].includes(method)) throw failure('Invalid request.');
      const verifiedFactor = identity.factors?.some(factor => factor.status === 'verified');
      let claims;
      try { claims = JSON.parse(atob(token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/'))); } catch { throw failure('Invalid session token.', 401); }
      if (verifiedFactor && claims.aal !== 'aal2') throw failure('Verify your authenticator before accessing the workspace.', 401, { requiresTwoFactor: true });
      const user = createClient(url, anonymousKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
      if (checked(await user.rpc('workspace_role')) !== profile.role) throw failure('Complete authenticator verification before accessing this workspace.', 401, { requiresTwoFactor: true });
      const permit = allowed => { if (!allowed.includes(profile.role)) throw failure('Your role does not permit this action.', 403); };
      const audit = async (action, detail) => checked(await service.from('audit').insert({ actor: identity.id, action, detail }));
      const setting = async id => checked(await service.from('workspace_settings').select('value').eq('id', id).maybeSingle())?.value;
      const aiSettings = async () => {
        const value = await setting('openai') || {};
        return { ...value, model: value.model || env('OPENAI_MODEL') || 'gpt-4o-mini', enabled: value.enabled !== false, key: value.encryptedKey ? await decrypt(value.encryptedKey, env('WORKSPACE_ENCRYPTION_KEY')) : env('OPENAI_API_KEY') || '' };
      };
      const workspace = async () => ({ ...(await setting('general') || { name: 'Accu-Steel workspace', supportEmail: '' }), aiConnected: Boolean((await aiSettings()).key && (await aiSettings()).enabled) });
      const inventory = async (location=profile.location_id||'MAIN',flat=false) => checked(await user.rpc('inventory_listing',{p_location:location,p_flat:flat}));
      const directory = async () => checked(await service.from('profiles').select('id,name,role').eq('disabled', false));
      const operations=await routeOperations({path,method,body,service,user,identity,profile,permit,checked,audit,failure});
      if(operations)return respond(operations.data);
      const supply=await routeSupply({path,method,body,service,user,profile,permit,checked,failure,query:incomingPath.searchParams});if(supply)return respond(supply.data);
      if (path === '/auth' && method === 'GET') return respond({ user: publicProfile(profile, identity.factors), aiConnected: (await workspace()).aiConnected, setupRequired: false });
      if (path === '/auth/register') throw failure('Public registration is disabled. Management provisions all accounts.', 403);
      if (path === '/workspace' && method === 'GET') return respond(await workspace());
      if (path === '/inventory' && method === 'GET') return respond(await inventory(incomingPath.searchParams.get('location')||profile.location_id||'MAIN',incomingPath.searchParams.get('flat')==='true'));
      if (path === '/inventory' && method === 'POST') { permit(['admin', 'estimator']); const item = inventoryItemSchema.parse({...body,location_id:body.location_id||profile.location_id||'MAIN'}); checked(await user.rpc('save_inventory', { item })); return respond({ ok: true }); }
      if (path === '/inventory/import/preview' && method === 'POST') {
        permit(['admin', 'estimator']);
        const schema = z.object({ headers: z.array(z.string().max(200)).min(1).max(100), rows: z.array(z.array(z.union([z.string().max(2000), z.number().finite(), z.boolean(), z.null()])).max(100)).min(1).max(5000), mapping: z.object(Object.fromEntries(inventoryFields.map(field => [field.id, z.number().int().min(-1).max(99).default(-1)]))), mode: z.enum(['add', 'update', 'upsert']), fileName: z.string().max(200),locationId:z.string().regex(/^[A-Z0-9][A-Z0-9_-]{0,23}$/).default(profile.location_id||'MAIN') });
        const data = schema.parse(body);
        const current=await inventory(data.locationId);
        const preview = previewInventoryImport(data,current,await inventory('all'));
        let previewId = null;
        if (!preview.counts.error && preview.counts.add + preview.counts.update) {
          const result = checked(await service.from('inventory_imports').insert({ actor: identity.id, expires: new Date(Date.now() + 900000).toISOString(), payload: { fileName: data.fileName, counts: preview.counts, rows: preview.rows.filter(row => ['add','update'].includes(row.action)).map(row => ({ item: row.item, before:row.before ? inventoryItemSchema.parse(row.before) : null })) } }).select('id').single());
          previewId = result.id;
        }
        return respond({ ...preview, previewId });
      }
      if (path === '/inventory/import/commit' && method === 'POST') { permit(['admin', 'estimator']); const previewId = z.uuid().parse(body.previewId); const result = await user.rpc('apply_inventory_import', { preview_id: previewId }); if (result.error) throw failure(result.error.message, 409); return respond({ ok: true, counts: result.data }); }
      if (path === '/project-owners' && method === 'GET') return respond((await directory()).filter(person => designRoles.includes(person.role)));
      if (path === '/projects' && method === 'GET') {
        const people = new Map((await directory()).map(person => [person.id, person.name]));
        const projects = checked(await user.from('projects').select('*').order('updated', { ascending: false }));
        return respond(projects.map(project => ({ ...project, author_name: people.get(project.author) || 'Former staff member' })));
      }
      if (path === '/projects' && method === 'POST') {
        permit(designRoles); const building = buildingSchema.parse(body.building);
        const data = { name: building.name, building, author: identity.id, updated: new Date().toISOString() };
        let result;
        if (body.id != null) {
          const id = z.number().int().positive().parse(body.id);
          const current = checked(await service.from('projects').select('revision').eq('id', id).maybeSingle());
          if (!current) throw failure('Project not found.', 404);
          result = checked(await service.from('projects').update({ ...data, revision: current.revision + 1 }).eq('id', id).eq('revision', current.revision).select('id,updated').maybeSingle());
          if (!result) throw failure('Project changed during save. Reload before saving.', 409);
        } else result = checked(await service.from('projects').insert({ ...data, owner: identity.id }).select('id,updated').single());
        await audit('project.save', { id: result.id }); return respond(result);
      }
      let match = path.match(/^\/projects\/(\d+)\/details$/);
      if (match && method === 'POST') {
        permit(designRoles);
        const data = z.object({ client: z.string().max(120), location: z.string().max(200), status: z.enum(projectStatuses), owner: z.uuid().nullable(), due_date: z.union([z.iso.date(), z.literal('')]), notes: z.string().max(5000), revision: z.number().int().positive() }).parse(body);
        if (data.owner && !(await directory()).some(person => person.id === data.owner && designRoles.includes(person.role))) throw failure('Choose an active project owner.');
        const saved = checked(await service.from('projects').update({ ...data, revision: data.revision + 1, updated: new Date().toISOString() }).eq('id', Number(match[1])).eq('revision', data.revision).select('id').maybeSingle());
        if (!saved) throw failure('Project changed or was removed. Refresh and retry.', 409);
        await audit('project.details.update', { id: saved.id, status: data.status }); return respond({ ok: true });
      }
      if (path === '/users' && method === 'GET') {
        permit(['admin']);
        const profiles = await allRows(service, 'profiles');
        const users = checked(await service.auth.admin.listUsers({ page: 1, perPage: 1000 })).users;
        const identities = new Map(users.map(account => [account.id, account.factors || []]));
        return respond(profiles.map(person => publicProfile(person, identities.get(person.id))));
      }
      if (path === '/users' && method === 'POST') {
        permit(['admin']); const data = creationSchema.parse(body);
        if(!checked(await service.from('locations').select('id').eq('id',data.locationId).eq('active',true).maybeSingle()))throw failure('Choose an active work location.');
        const created = checked(await service.auth.admin.createUser({ email: data.email, password: data.password, email_confirm: true }));
        const saved = await service.from('profiles').insert({ id: created.user.id, ...profileInput(data), role: data.role });
        if (saved.error) { await service.auth.admin.deleteUser(created.user.id); throw failure(saved.error.message); }
        await audit('user.create', { id: created.user.id, role: data.role }); return respond({ ok: true }, 201);
      }
      match = path.match(/^\/users\/([a-f0-9-]+)\/(access|profile)$/i);
      if (match && method === 'POST') {
        permit(['admin']); const id = z.uuid().parse(match[1]);
        const current = checked(await service.from('profiles').select('*').eq('id', id).maybeSingle());
        if (!current) throw failure('Account not found.', 404);
        if (match[2] === 'access') {
          const data = z.object({ role: z.enum(roles), disabled: z.boolean() }).parse(body);
          if (id === identity.id && (data.disabled || data.role !== 'admin')) throw failure('You cannot disable or demote your own administrator account.');
          checked(await service.from('profiles').update(data).eq('id', id));
          checked(await service.auth.admin.updateUserById(id, { ban_duration: data.disabled ? '876000h' : 'none' }));
          await audit('user.access.update', { id, ...data }); return respond({ ok: true });
        }
        const data = profileSchema.parse(body);
        if(!checked(await service.from('locations').select('id').eq('id',data.locationId).eq('active',true).maybeSingle()))throw failure('Choose an active work location.');
        if (data.email !== current.email) checked(await service.auth.admin.updateUserById(id, { email: data.email, email_confirm: true }));
        checked(await service.from('profiles').update(profileInput(data)).eq('id', id));
        await audit('user.profile.update', { id, fields: Object.keys(profileInput(data)) }); return respond({ user: publicProfile({ ...current, ...profileInput(data) }), requiresSignIn: id === identity.id && data.email !== current.email });
      }
      if (path === '/support/agents') return respond(supportRoles.includes(profile.role) ? (await directory()).filter(person => supportRoles.includes(person.role)) : []);
      if (path === '/tickets' && method === 'GET') {
        const people = new Map((await directory()).map(person => [person.id, person.name]));
        const tickets = checked(await user.from('tickets').select('*,projects(name)').order('updated', { ascending: false }));
        return respond(tickets.map(ticket => ({ ...ticket, reporter_name: people.get(ticket.reporter) || 'Former staff member', assignee_name: people.get(ticket.assignee) || null, project_name: ticket.projects?.name || null })));
      }
      if (path === '/tickets' && method === 'POST') {
        const data = z.object({ title: z.string().trim().min(4).max(140), description: z.string().trim().min(10).max(10000), category: z.enum(['Design','Inventory','Account','Integration','Other']), priority: z.enum(ticketPriorities), project_id: z.number().int().positive().nullable() }).parse(body);
        const ticket = checked(await service.from('tickets').insert({ ...data, reporter: identity.id }).select('id').single());
        await audit('ticket.create', { id: ticket.id }); return respond(ticket, 201);
      }
      match = path.match(/^\/tickets\/(\d+)(?:\/(replies|triage))?$/);
      if (match) {
        const ticket = checked(await user.from('tickets').select('*').eq('id', Number(match[1])).maybeSingle());
        if (!ticket) throw failure('Ticket not found.', 404);
        if (!match[2] && method === 'GET') {
          const people = new Map((await directory()).map(person => [person.id, person]));
          const messages = checked(await user.from('ticket_messages').select('*').eq('ticket_id', ticket.id).order('id'));
          return respond({ ...ticket, messages: messages.map(message => ({ ...message, author_name: people.get(message.author)?.name || 'Former staff member', author_role: people.get(message.author)?.role || 'viewer' })) });
        }
        if (match[2] === 'replies' && method === 'POST') {
          const data = z.object({ body: z.string().trim().min(1).max(5000) }).parse(body);
          checked(await service.from('ticket_messages').insert({ ticket_id: ticket.id, author: identity.id, body: data.body }));
          checked(await service.from('tickets').update({ updated: new Date().toISOString() }).eq('id', ticket.id));
          await audit('ticket.reply', { id: ticket.id }); return respond({ ok: true });
        }
        if (match[2] === 'triage' && method === 'POST') {
          permit(supportRoles); const data = z.object({ status: z.enum(ticketStatuses), priority: z.enum(ticketPriorities), assignee: z.uuid().nullable() }).parse(body);
          if (data.assignee && !(await directory()).some(person => person.id === data.assignee && supportRoles.includes(person.role))) throw failure('Choose an active technician or administrator.');
          checked(await service.from('tickets').update({ ...data, updated: new Date().toISOString() }).eq('id', ticket.id));
          await audit('ticket.triage', { id: ticket.id, ...data }); return respond({ ok: true });
        }
      }
      if (path === '/admin' && method === 'GET') {
        permit(['admin']); const config = await aiSettings(); const general = await workspace();
        const count = async table => { const result = await service.from(table).select('id', { count: 'exact', head: true }); if (result.error) throw failure(result.error.message); return result.count; };
        const records = checked(await service.from('audit').select('*').order('id', { ascending: false }).limit(60));
        const people = new Map((await directory()).map(person => [person.id, person.name]));
        return respond({ ...general, integrations: { openai: { configured: Boolean(config.key), enabled: config.enabled, model: config.model, source: config.encryptedKey ? 'workspace' : config.key ? 'environment' : 'none' } }, counts: { users: (await directory()).length, projects: await count('projects'), tickets: checked(await service.from('tickets').select('id').not('status','in','(Resolved,Closed)')).length }, audit: records.map(record => ({ ...record, actor_name: people.get(record.actor) || 'System', detail: JSON.stringify(record.detail) })) });
      }
      if (path === '/admin/settings' && method === 'POST') {
        permit(['admin']); const data = z.object({ name: z.string().trim().min(2).max(80), supportEmail: z.union([z.email(), z.literal('')]) }).parse(body);
        checked(await service.from('workspace_settings').upsert({ id: 'general', value: data })); await audit('settings.update', data); return respond(await workspace());
      }
      if (path === '/admin/integrations/openai' && method === 'POST') {
        permit(['admin']); const data = z.object({ model: z.string().regex(/^[a-zA-Z0-9._:-]{1,100}$/), enabled: z.boolean(), apiKey: z.string().min(10).max(500).optional(), removeKey: z.boolean().optional() }).parse(body);
        const previous = await setting('openai') || {};
        const value = { ...previous, model: data.model, enabled: data.enabled };
        if (data.apiKey) value.encryptedKey = await encrypt(data.apiKey, env('WORKSPACE_ENCRYPTION_KEY'));
        if (data.removeKey) delete value.encryptedKey;
        checked(await service.from('workspace_settings').upsert({ id: 'openai', value })); await audit('integration.openai.update', { model: data.model, enabled: data.enabled, keyChanged: Boolean(data.apiKey || data.removeKey) }); return respond({ ok: true, aiConnected: (await workspace()).aiConnected });
      }
      if (path === '/admin/integrations/openai/test' && method === 'POST') {
        permit(['admin']); const config = await aiSettings();
        if (!config.key || !config.enabled) throw failure('Configure and enable OpenAI first.');
        const response = await fetchProvider(`https://api.openai.com/v1/models/${encodeURIComponent(config.model)}`, { signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${config.key}` } });
        if (!response.ok) throw failure(`Provider rejected credentials/model (HTTP ${response.status}).`, 502);
        await audit('integration.openai.test', { success: true }); return respond({ ok: true, message: 'Credentials and model accepted. Billing access is still required for requests.' });
      }
      if (path === '/ai/design' && method === 'POST') {
        permit(designRoles); const building = buildingSchema.parse(body.building); const prompt = z.string().min(1).max(2000).parse(body.prompt);
        let candidate;
        try { candidate = parseDesignCommand(prompt, building, ['door','window','building'].includes(body.context) ? body.context : null); } catch (error) { throw failure(error.issues?.[0]?.message || error.message, 422, { needsClarification: true }); }
        const config = await aiSettings(); if (!config.key || !config.enabled) throw failure('AI is not configured.', 503);
        const response = await fetchProvider('https://api.openai.com/v1/chat/completions', { method: 'POST', signal: AbortSignal.timeout(30000), headers: { Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: config.model, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: 'Return JSON {explanation}. Explain the supplied validated dimensional change in under 50 words. Do not claim safety, structural adequacy, certification, or engineered foundations. Do not introduce unsupported changes.' }, { role: 'user', content: JSON.stringify({ current: building, candidate, prompt }) }] }) });
        if (!response.ok) throw failure('AI provider request failed. Design unchanged.', 502);
        const result = await response.json(); const explanation = JSON.parse(result.choices[0].message.content).explanation;
        return respond({ building: candidate, explanation: String(explanation).slice(0, 600) });
      }
      throw failure('Endpoint not found.', 404);
    } catch (error) {
      return respond({ error: error.issues?.[0]?.message || (error.status ? error.message : 'Unable to complete the workspace request.'), ...(error.requiresTwoFactor ? { requiresTwoFactor: true } : {}), ...(error.needsClarification ? { needsClarification: true } : {}) }, error.status || (error.issues ? 400 : 500));
    }
  };
}