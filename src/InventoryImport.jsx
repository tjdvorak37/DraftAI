import { useState } from 'react';
import { ArrowLeft, Check, Download, FileUp, LoaderCircle, Package, ShieldCheck } from 'lucide-react';
import { Modal } from './ui.jsx';
import { api } from './client.js';
import { download } from './files.js';
import { inventoryFields, guessInventoryMapping } from '../shared/inventory.js';
import { inventoryCsv, parseInventoryFile } from './inventoryFiles.js';

export default function InventoryImport({ inventory, onClose, onImported,locations=[],locationId='MAIN' }) {
  const [targetLocation,setTargetLocation]=useState(locationId==='all'?'MAIN':locationId);
  const [sheets, setSheets] = useState([]);
  const [selected, setSelected] = useState(0);
  const [fileName, setFileName] = useState('');
  const [mapping, setMapping] = useState({});
  const [mode, setMode] = useState('add');
  const [preview, setPreview] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sheet = sheets[selected];
  function chooseSheet(index) { setSelected(index); setMapping(guessInventoryMapping(sheets[index].headers)); setPreview(null); setConfirmed(false); setError(''); }
  async function load(file) {
    if (!file || busy) return;
    setBusy(true); setError(''); setPreview(null); setConfirmed(false); setSheets([]);
    try { const data = await parseInventoryFile(file); setSheets(data); setSelected(0); setMapping(guessInventoryMapping(data[0].headers)); setFileName(file.name); }
    catch (error) { setError(error.message); } finally { setBusy(false); }
  }
  async function prepare() {
    setBusy(true); setError(''); setConfirmed(false);
    try { setPreview(await api('/inventory/import/preview', { headers: sheet.headers, rows: sheet.rows, mapping, mode, fileName,locationId:targetLocation })); }
    catch (error) { setError(error.message); } finally { setBusy(false); }
  }
  async function commit() {
    if (!confirmed || !preview?.previewId) return;
    setBusy(true); setError('');
    try { const result = await api('/inventory/import/commit', { previewId: preview.previewId }); await onImported({...result,locationId:targetLocation}); }
    catch (error) { setError(error.message); setPreview(null); setConfirmed(false); } finally { setBusy(false); }
  }
  return <Modal wide title="Import inventory" subtitle="CSV or Excel · preview every change before applying." onClose={onClose}>
    <div className="inventory-import-content form-stack">
      {!preview ? <>
        <label>Import into location<select aria-label="Inventory import location" value={targetLocation} onChange={event=>setTargetLocation(event.target.value)} disabled={busy}>{locations.filter(location=>location.active).map(location=><option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
        <p className="muted">Counts and bin assignments apply only to this site. Descriptions, categories, units, and unit costs are shared by the part catalog. Import one location at a time.</p>
        <label className="upload-zone" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); load(event.dataTransfer.files[0]); }}><FileUp size={29} /><strong>{busy ? 'Reading inventory…' : fileName || 'Choose inventory file'}</strong><span>CSV / XLSX · 8 MB · up to 5,000 rows per sheet</span><input type="file" accept=".csv,.xlsx" aria-label="Choose inventory import file" disabled={busy} onChange={event => load(event.target.files[0])} /></label>
        <div className="import-file-actions"><button className="button compact" onClick={() => download('inventory-template.csv', inventoryCsv([{ id: 'YOUR-SKU-001', name: 'Your component', category: 'Your category', unit: 'ea', stock: 0, price: null, reorder: 0, location: '', supplier: '' }]), 'text/csv')}><Download size={13} /> Download template</button><button className="button compact" onClick={() => download('inventory-before-import.csv', inventoryCsv(inventory), 'text/csv')}><Download size={13} /> Export current inventory</button></div>
        {sheet && <>
          {sheets.length > 1 && <label>Worksheet<select aria-label="Inventory worksheet" value={selected} disabled={busy} onChange={event => chooseSheet(Number(event.target.value))}>{sheets.map((item, index) => <option key={index} value={index}>{item.name} · {item.rows.length} rows</option>)}</select></label>}
          <div className="import-section-heading"><h3>Map your columns</h3><span>{sheet.rows.length} source rows</span></div>
          <div className="inventory-mapping-grid">{inventoryFields.map(field => <label key={field.id}>{field.name}<select aria-label={`Map ${field.name}`} value={mapping[field.id] ?? -1} disabled={busy} onChange={event => setMapping(current => ({ ...current, [field.id]: Number(event.target.value) }))}><option value={-1}>Not mapped</option>{sheet.headers.map((header, index) => <option key={index} value={index}>{header}</option>)}</select><small>{mapping[field.id] >= 0 ? `Example: ${String(sheet.rows[0]?.[mapping[field.id]] ?? '') || '(blank)'}` : field.id === 'id' ? 'Required' : 'Existing values are preserved'}</small></label>)}</div>
          <label>Matching Part ID / SKU behavior<select aria-label="Inventory import mode" value={mode} disabled={busy} onChange={event => setMode(event.target.value)}><option value="add">Add new parts only · skip existing IDs</option><option value="update">Update matching parts only · skip new IDs</option><option value="upsert">Add new parts and update matching IDs</option></select></label>
          <div className="notice"><ShieldCheck size={18} /><p>Counts replace on-hand balances; they are not added to existing counts. Mapped blank costs become unpriced. Unmapped fields on existing parts stay unchanged. No parts are deleted. Keep IDs as spreadsheet text to preserve leading zeroes.</p></div>
          <button className="button primary" disabled={busy || mapping.id < 0 || mapping.id == null} onClick={prepare}>{busy ? <LoaderCircle size={15} className="spin" /> : <Package size={15} />} Preview inventory changes</button>
        </>}
      </> : <>
        <button className="button compact import-back" disabled={busy} onClick={() => { setPreview(null); setConfirmed(false); }}><ArrowLeft size={13} /> Back to mapping</button>
        <div className="import-counts">{[['add', 'New parts'], ['update', 'Updates'], ['skip', 'Skipped'], ['error', 'Errors']].map(([key, label]) => <div className={key === 'error' && preview.counts.error ? 'has-errors' : ''} key={key}><span>{label}</span><strong>{preview.counts[key]}</strong></div>)}</div>
        <div className="table-scroll import-preview-table"><table className="inventory-table"><thead><tr><th>ROW / PART ID</th><th>ACTION</th><th>DESCRIPTION</th><th>COUNT</th><th>UNIT COST</th><th>DETAIL</th></tr></thead><tbody>{preview.rows.slice(0, 100).map(row => <tr key={row.row}><td><strong>{row.id || '(missing)'}</strong><small>Row {row.row}</small></td><td><span className={`status-pill ${row.action === 'error' ? 'warning' : row.action === 'add' ? 'success' : ''}`}>{row.action}</span></td><td>{row.item?.name || ''}<small>{row.item?.category || ''}</small></td><td>{row.before && row.action === 'update' ? `${row.before.stock} → ` : ''}{row.item?.stock ?? '—'}</td><td>{row.item ? row.item.price == null ? 'Unpriced' : `$${row.item.price.toFixed(2)}` : '—'}</td><td>{row.error || (row.before ? 'Mapped fields updated' : 'New catalog item')}</td></tr>)}</tbody></table></div>
        {preview.rows.length > 100 && <p className="muted">Showing the first 100 of {preview.rows.length} rows. All rows are validated and counted.</p>}
        {preview.counts.error > 0 ? <p className="form-error" role="alert">No rows can be imported until every error is fixed. Correct your source file and upload it again.</p> : <><label className="checkbox-label"><input type="checkbox" aria-label="Confirm inventory changes" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={!preview.previewId || busy} /> I reviewed these inventory changes.</label><button className="button primary" onClick={commit} disabled={busy || !confirmed || !preview.previewId}>{busy ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />} Apply inventory import</button></>}
      </>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  </Modal>;
}