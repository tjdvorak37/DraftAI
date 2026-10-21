import test from 'node:test';
import assert from 'node:assert/strict';
import { previewInventoryImport, guessInventoryMapping } from '../shared/inventory.js';
import { createApp } from '../server/index.js';
import { provisionInitialAdmin } from '../server/accounts.js';
import { inventoryCsv, parseInventoryCsv, parseInventoryFile } from '../src/inventoryFiles.js';

const headers = ['SKU', 'Description', 'Count', 'Category', 'UOM', 'Unit Cost', 'Bin', 'Vendor'];
const mapping = guessInventoryMapping(headers);
const rows = [['AC/001', 'Custom clamp', '1,250', 'Fabrication supplies', 'box', '$12.50', 'Bin A', 'Iowa Supplier'], ['AC/002', 'Custom plate', '0', 'Plate steel', 'kg', '', '', '']];

test('CSV and Excel readers preserve IDs and cells, allow worksheet selection, and reject formulas', async () => {
  const csv = parseInventoryCsv('SKU;Description;Count\n0012;"Steel, custom";10\n0013;"Two\nlines";0');
  assert.equal(csv.rows[0][0], '0012');
  assert.equal(csv.rows[1][1], 'Two\nlines');
  assert.throws(() => parseInventoryCsv('SKU,SKU\n1,2'), /unique/);
  const module = await import('exceljs');
  const Workbook = module.Workbook || module.default.Workbook;
  const workbook = new Workbook();
  workbook.addWorksheet('Parts').addRows([headers, ...rows]);
  workbook.addWorksheet('Warehouse B').addRows([['SKU', 'Count'], ['B-002', 12]]);
  const buffer = await workbook.xlsx.writeBuffer();
  const sheets = await parseInventoryFile({ name: 'parts.xlsx', size: buffer.length, arrayBuffer: async () => buffer });
  assert.equal(sheets.length, 2);
  assert.equal(sheets[0].rows[0][0], 'AC/001');
  assert.equal(sheets[1].name, 'Warehouse B');
  workbook.getWorksheet('Parts').getCell('C2').value = { formula: '1+1', result: 2 };
  const formulaBuffer = await workbook.xlsx.writeBuffer();
  await assert.rejects(() => parseInventoryFile({ name: 'formulas.xlsx', size: formulaBuffer.length, arrayBuffer: async () => formulaBuffer }), /contains a formula/);
  const exported = inventoryCsv([{ id: 'P-1', name: '=DANGEROUS()', category: 'Parts', unit: 'ea', stock: 0, price: null, reorder: 0 }]);
  assert.ok(exported.includes("'=DANGEROUS()"));
});

test('import mappings preserve custom categories, zero counts, unknown costs, locations, and suppliers', () => {
  const preview = previewInventoryImport({ headers, rows, mapping, mode: 'upsert' }, []);
  assert.deepEqual(preview.counts, { add: 2, update: 0, skip: 0, error: 0 });
  assert.equal(preview.rows[0].item.stock, 1250);
  assert.equal(preview.rows[0].item.price, 12.5);
  assert.equal(preview.rows[0].item.category, 'Fabrication supplies');
  assert.equal(preview.rows[1].item.price, null);
  assert.equal(preview.rows[1].item.stock, 0);
  const countsOnly = previewInventoryImport({ headers: ['SKU', 'Count'], rows: [['AC/001', '15']], mapping: guessInventoryMapping(['SKU', 'Count']), mode: 'update' }, preview.rows.map(row => row.item));
  assert.equal(countsOnly.rows[0].item.name, 'Custom clamp');
  assert.equal(countsOnly.rows[0].item.price, 12.5);
  assert.equal(countsOnly.rows[0].item.stock, 15);
  assert.equal(previewInventoryImport({ headers, rows: [rows[0], rows[0]], mapping, mode: 'upsert' }, []).counts.error, 2);
  assert.equal(previewInventoryImport({ headers, rows: [['BAD', 'Bad stock', '-2']], mapping, mode: 'upsert' }, []).counts.error, 1);
  assert.equal(previewInventoryImport({ headers, rows: [['BAD', 'Bad stock', '1,5']], mapping, mode: 'upsert' }, []).counts.error, 1);
});

test('bulk import is role-protected, previewed, atomic, conflict-safe, audited, and non-replayable', async () => {
  const { app, db } = createApp({ databasePath: ':memory:' });
  await provisionInitialAdmin(db, { name: 'Inventory Admin', email: 'inventory@test.com', password: 'inventory-test-password' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  let cookie = '';
  async function request(path, body, session = cookie) {
    const response = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Cookie: session }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  const input = { headers, rows, mapping, mode: 'upsert', fileName: 'inventory.csv' };
  try {
    assert.equal((await request('/inventory/import/preview', input)).status, 401);
    cookie = (await request('/auth/login', { email: 'inventory@test.com', password: 'inventory-test-password' })).cookie;
    const preview = await request('/inventory/import/preview', input);
    assert.ok(preview.data.previewId);
    assert.equal(db.prepare("SELECT id FROM inventory WHERE id='AC/001'").get(), undefined);
    assert.equal((await request('/inventory/import/commit', { previewId: preview.data.previewId })).status, 200);
    assert.equal((await request('/inventory/import/commit', { previewId: preview.data.previewId })).status, 409);
    assert.equal(db.prepare("SELECT category FROM inventory WHERE id='AC/001'").get().category, 'Fabrication supplies');
    const pending = await request('/inventory/import/preview', { ...input, rows: [['AC/001', 'Changed clamp', '99'], ['AC/003', 'New clamp', '3']] });
    db.prepare("UPDATE inventory_balances SET stock=12 WHERE part_id='AC/001' AND location_id='MAIN'").run();
    assert.equal((await request('/inventory/import/commit', { previewId: pending.data.previewId })).status, 409);
    assert.equal(db.prepare("SELECT id FROM inventory WHERE id='AC/003'").get(), undefined);
    const invalid = await request('/inventory/import/preview', { ...input, rows: [rows[0], ['INVALID', 'Bad', '-10']] });
    assert.equal(invalid.data.previewId, null);
    await request('/users', { name: 'Read Only', email: 'viewer@test.com', password: 'viewer-test-password', role: 'viewer' });
    const viewer = (await request('/auth/login', { email: 'viewer@test.com', password: 'viewer-test-password' })).cookie;
    assert.equal((await request('/inventory/import/preview', input, viewer)).status, 403);
    assert.equal(db.prepare("SELECT COUNT(*) AS total FROM audit WHERE action='inventory.import'").get().total, 1);
  } finally { await new Promise(resolve => server.close(resolve)); db.close(); }
});