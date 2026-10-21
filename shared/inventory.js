import { z } from 'zod';

export const inventoryItemSchema = z.object({
  id: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._/ -]{0,63}$/),
  name: z.string().trim().min(1).max(120), category: z.string().trim().min(1).max(80),
  unit: z.string().trim().min(1).max(24), stock: z.number().min(0).max(1e9),
  price: z.number().min(0).max(1e8).nullable(), reorder: z.number().min(0).max(1e9),
  location: z.string().trim().max(160).default(''), supplier: z.string().trim().max(160).default(''),
  location_id: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{0,23}$/).default('MAIN'),
});
export const inventoryFields = [
  { id: 'id', name: 'Part ID / SKU', aliases: ['partid', 'sku', 'partnumber', 'itemnumber', 'itemid', 'id'] },
  { id: 'name', name: 'Description / name', aliases: ['description', 'name', 'partname', 'itemname', 'itemdescription'] },
  { id: 'stock', name: 'On-hand count', aliases: ['onhand', 'onhandcount', 'stock', 'quantity', 'qty', 'count', 'quantityonhand'] },
  { id: 'category', name: 'Category', aliases: ['category', 'categories', 'group', 'itemgroup'] },
  { id: 'unit', name: 'Unit', aliases: ['unit', 'units', 'uom', 'unitofmeasure'] },
  { id: 'price', name: 'Unit cost (USD)', aliases: ['unitcost', 'unitcostusd', 'cost', 'price', 'unitprice', 'unitcostusdollar'] },
  { id: 'reorder', name: 'Reorder point', aliases: ['reorder', 'reorderpoint', 'minimumstock', 'minstock'] },
  { id: 'location', name: 'Storage location', aliases: ['location', 'storagelocation', 'warehouse', 'bin', 'binlocation'] },
  { id: 'supplier', name: 'Supplier', aliases: ['supplier', 'vendor', 'vendorname', 'suppliername'] },
];

export function guessInventoryMapping(headers) {
  const normalized = headers.map(header => String(header).toLowerCase().replace(/[^a-z0-9]/g, ''));
  return Object.fromEntries(inventoryFields.map(field => [field.id, normalized.findIndex(header => field.aliases.includes(header))]));
}

function numeric(value, field) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value ?? '').trim().replace(/^\$\s*/, '');
  if (!/^(?:\d+(?:\.\d+)?|\d{1,3}(?:,\d{3})+(?:\.\d+)?)$/.test(text)) throw new Error(`${field} must be a nonnegative number using a decimal point (for example 1,250.50).`);
  return Number(text.replaceAll(',', ''));
}

export function previewInventoryImport({ headers, rows, mapping, mode, locationId = 'MAIN' }, existing, catalog = existing) {
  const current = new Map(existing.map(item => [item.id, inventoryItemSchema.parse(item)]));
  const occurrences = new Map();
  const idIndex = mapping.id;
  if (!Number.isInteger(idIndex) || idIndex < 0 || idIndex >= headers.length) throw new Error('Map a Part ID / SKU column before previewing.');
  const usedColumns = Object.values(mapping).filter(index => index >= 0);
  if (new Set(usedColumns).size !== usedColumns.length) throw new Error('Each source column can be mapped to only one field.');
  for (const row of rows) { const id = String(row[idIndex] ?? '').trim(); occurrences.set(id, (occurrences.get(id) || 0) + 1); }
  const output = rows.map((row, index) => {
    const id = String(row[idIndex] ?? '').trim();
    const before = current.get(id) || null;
    const result = { row: index + 2, id, action: before ? 'update' : 'add', before, item: null, error: '' };
    try {
      if (!id) throw new Error('Part ID / SKU is missing.');
      if (occurrences.get(id) > 1) throw new Error('Duplicate Part ID / SKU in this file. Resolve duplicates before importing.');
      const reference = catalog.find(item => item.id === id);
      const item = before ? { ...before } : { id, name: reference?.name || '', category: reference?.category || 'Uncategorized', unit: reference?.unit || 'ea', stock: null, price: reference?.price ?? null, reorder: 0, location: '', supplier: reference?.supplier || '', location_id: locationId };
      for (const field of inventoryFields) {
        const column = mapping[field.id];
        if (!Number.isInteger(column) || column < 0) continue;
        if (column >= headers.length) throw new Error(`Mapped column for ${field.name} is invalid.`);
        const value = row[column];
        const blank = value == null || String(value).trim() === '';
        if (field.id === 'price') item.price = blank ? null : numeric(value, field.name);
        else if (field.id === 'stock') { if (blank) throw new Error('On-hand count is blank. Enter zero explicitly if stock is zero.'); item.stock = numeric(value, field.name); }
        else if (field.id === 'reorder') { if (!blank) item.reorder = numeric(value, field.name); }
        else if (!blank || ['location', 'supplier'].includes(field.id)) item[field.id] = String(value ?? '').trim();
      }
      if (!item.name) throw new Error('New parts need a description / name.');
      if (item.stock == null) throw new Error('New parts need an explicit on-hand count.');
      const parsed = inventoryItemSchema.safeParse(item);
      if (!parsed.success) throw new Error(`Invalid ${parsed.error.issues[0].path.join('.')}: ${parsed.error.issues[0].message}`);
      result.item = parsed.data;
      if ((mode === 'add' && before) || (mode === 'update' && !before)) { result.action = 'skip'; result.error = mode === 'add' ? 'Already exists; add-only mode leaves it unchanged.' : 'Not in inventory; update-only mode does not create it.'; }
      else if (before && JSON.stringify(before) === JSON.stringify(result.item)) { result.action = 'skip'; result.error = 'No changes.'; }
    } catch (error) { result.action = 'error'; result.error = error.message; }
    return result;
  });
  const counts = { add: 0, update: 0, skip: 0, error: 0 };
  for (const row of output) counts[row.action]++;
  return { rows: output, counts };
}