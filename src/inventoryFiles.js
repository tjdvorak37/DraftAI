import Papa from 'papaparse';

function table(data, name) {
  const nonempty = data.filter(row => row.some(value => value != null && String(value).trim() !== ''));
  if (nonempty.length < 2) throw new Error('Include a header row and at least one inventory row.');
  if (nonempty.length > 5001) throw new Error('Import no more than 5,000 inventory rows at a time.');
  const headers = nonempty[0].map(value => String(value ?? '').trim());
  if (headers.length > 100 || headers.some(header => !header)) throw new Error('Use up to 100 named columns with no blank header cells.');
  if (new Set(headers.map(header => header.toLowerCase())).size !== headers.length) throw new Error('Column headers must be unique.');
  if (nonempty.slice(1).some(row => row.length > headers.length)) throw new Error('A row contains more columns than the header. Check separators and quoted values.');
  return { name, headers, rows: nonempty.slice(1).map(row => headers.map((header, index) => row[index] ?? '')) };
}

export function parseInventoryCsv(text, name = 'CSV') {
  const parsed = Papa.parse(text, { skipEmptyLines: 'greedy', dynamicTyping: false });
  const errors = parsed.errors.filter(error => error.code !== 'UndetectableDelimiter');
  if (errors.length) throw new Error(`CSV parse error: ${errors[0].message}`);
  return table(parsed.data, name);
}

export async function parseInventoryFile(file) {
  if (file.size > 8 * 1024 * 1024) throw new Error('Choose a CSV or XLSX file smaller than 8 MB.');
  if (/\.csv$/i.test(file.name)) return [parseInventoryCsv(await file.text(), file.name)];
  if (!/\.xlsx$/i.test(file.name)) throw new Error('Choose .csv or .xlsx. Export older .xls workbooks to CSV or XLSX first.');
  const module = await import('exceljs');
  const Workbook = module.Workbook || module.default.Workbook;
  const workbook = new Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  if (workbook.worksheets.length > 10) throw new Error('Use a workbook with no more than 10 worksheets.');
  const sheets = [];
  for (const sheet of workbook.worksheets) {
    if (!sheet.actualRowCount) continue;
    if (sheet.rowCount > 5001 || sheet.columnCount > 100) throw new Error(`Worksheet ${sheet.name} exceeds 5,000 rows or 100 columns. Remove unused formatted rows/columns or export CSV.`);
    const rows = [];
    sheet.eachRow(row => {
      const values = [];
      for (let index = 1; index <= sheet.columnCount; index++) {
        const cell = row.getCell(index);
        const value = cell.value;
        if (value && typeof value === 'object' && ('formula' in value || 'sharedFormula' in value)) throw new Error(`Worksheet ${sheet.name}, cell ${cell.address} contains a formula. Export values, not formulas, before importing.`);
        if (value && typeof value === 'object' && 'richText' in value) values.push(value.richText.map(part => part.text).join(''));
        else if (value && typeof value === 'object' && 'text' in value) values.push(value.text);
        else if (value instanceof Date) values.push(value.toISOString());
        else if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) values.push(value ?? '');
        else throw new Error(`Unsupported value at ${sheet.name}!${cell.address}. Export this worksheet as CSV values.`);
      }
      rows.push(values);
    });
    if (rows.length > 1) sheets.push(table(rows, sheet.name));
  }
  if (!sheets.length) throw new Error('No worksheet contains headers and inventory rows.');
  return sheets;
}

export function inventoryCsv(items) {
  return Papa.unparse({ fields: ['Part ID', 'Description', 'Category', 'Unit', 'On hand', 'Unit cost USD', 'Reorder point', 'Location', 'Supplier','Inventory location','Held','Available'], data: items.map(item => [item.id, item.name, item.category, item.unit, item.stock, item.price ?? '', item.reorder, item.location || '', item.supplier || '',item.location_id||'MAIN',item.reserved||0,item.available??item.stock]) }, { quotes: true, escapeFormulae: true });
}