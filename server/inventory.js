import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { inventoryItemSchema, inventoryFields, previewInventoryImport } from '../shared/inventory.js';

export function registerInventoryImport({ app, db, allow, audit,inventoryAt,saveItem }) {
  const columns = db.prepare('PRAGMA table_info(inventory)').all();
  for (const column of ['location', 'supplier']) if (!columns.some(item => item.name === column)) db.exec(`ALTER TABLE inventory ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`);
  db.exec('CREATE TABLE IF NOT EXISTS inventory_imports (id TEXT PRIMARY KEY, actor INTEGER NOT NULL, payload TEXT NOT NULL, expires INTEGER NOT NULL)');
  const fingerprint = item => item ? createHash('sha256').update(JSON.stringify(inventoryItemSchema.parse(item))).digest('hex') : null;
  const inputSchema = z.object({
    headers: z.array(z.string().max(200)).min(1).max(100),
    rows: z.array(z.array(z.union([z.string().max(2000), z.number().finite(), z.boolean(), z.null()])).max(100)).min(1).max(5000),
    mapping: z.object(Object.fromEntries(inventoryFields.map(field => [field.id, z.number().int().min(-1).max(99).default(-1)]))),
    mode: z.enum(['add', 'update', 'upsert']), fileName: z.string().max(200),
    locationId:z.string().regex(/^[A-Z0-9][A-Z0-9_-]{0,23}$/).optional(),
  });
  app.post('/api/inventory/import/preview', allow('admin', 'estimator'), (req, res) => {
    const parsed = inputSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Choose 1-5,000 rows, no more than 100 columns, and valid column mappings.' });
    try {
      const data={...parsed.data,locationId:parsed.data.locationId||req.user.location_id||'MAIN'};
      const preview = previewInventoryImport(data,inventoryAt(data.locationId),inventoryAt('all'));
      let previewId = null;
      if (!preview.counts.error && preview.counts.add + preview.counts.update > 0) {
        previewId = randomUUID();
        db.prepare('DELETE FROM inventory_imports WHERE expires < ?').run(Date.now());
        db.prepare('INSERT INTO inventory_imports VALUES (?,?,?,?)').run(previewId, req.user.id, JSON.stringify({ fileName: parsed.data.fileName, counts: preview.counts, rows: preview.rows.filter(row => ['add', 'update'].includes(row.action)).map(row => ({ item: row.item, expected: fingerprint(row.before) })) }), Date.now() + 15 * 60 * 1000);
      }
      res.json({ ...preview, previewId });
    } catch (error) { res.status(400).json({ error: error.message }); }
  });
  app.post('/api/inventory/import/commit', allow('admin', 'estimator'), (req, res) => {
    if (typeof req.body.previewId !== 'string') return res.status(400).json({ error: 'Preview the import first.' });
    const preview = db.prepare('SELECT * FROM inventory_imports WHERE id=? AND actor=? AND expires>?').get(req.body.previewId, req.user.id, Date.now());
    if (!preview) return res.status(409).json({ error: 'The import preview expired, was already applied, or belongs to another user. Preview again.' });
    const payload = JSON.parse(preview.payload);
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const row of payload.rows) {
        if (fingerprint(inventoryAt(row.item.location_id).find(item=>item.id===row.item.id)) !== row.expected) throw new Error(`Part ${row.item.id} changed after preview. No rows were imported. Preview again.`);
      }
      for (const { item } of payload.rows) saveItem(item,req.user.id);
      db.prepare('DELETE FROM inventory_imports WHERE id=?').run(preview.id);
      audit(req, 'inventory.import', { fileName: payload.fileName, ...payload.counts });
      db.exec('COMMIT');
      res.json({ ok: true, counts: payload.counts });
    } catch (error) { db.exec('ROLLBACK'); res.status(409).json({ error: error.message }); }
  });
}