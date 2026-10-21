import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpRight, Box, Check, ChevronDown, ChevronRight, CircleHelp, Cloud, Copy, Download, Expand, File, FileDown, FilePlus2, FileUp, FolderOpen, Grid2X2, History, Layers3, LayoutTemplate, ListFilter, LoaderCircle, LockKeyhole, LogIn, LogOut, Maximize, MessageSquare, Minus, MoreHorizontal, MousePointer2, Package, PanelLeftClose, Plus, Redo2, Ruler, Save, Search, Send, Settings2, ShieldCheck, Sparkles, Square, Trash2, Undo2, Users, Warehouse, X } from 'lucide-react';
import Scene from './Scene.jsx';
import { defaultBuilding, buildingSchema, buildingMetrics, billOfMaterials, initialInventory, parseDesignCommand, designWarnings } from '../shared/model.js';
import { download, parseProject, parseDxf, exportDxf, materialsCsv } from './files.js';
import { api } from './client.js';
import { Modal, IconButton } from './ui.jsx';
import { AdminCenter, ProjectCenter, SupportCenter } from './WorkspacePages.jsx';
import { roles, designRoles, costRoles } from '../shared/access.js';
import SiteControls, { describeDesignValue } from './SiteControls.jsx';
import ConstructionReport from './ConstructionReport.jsx';
import LoginPage from './LoginPage.jsx';
import InventoryImport from './InventoryImport.jsx';
import { inventoryCsv } from './inventoryFiles.js';
import { CustomersPage, ShippingPage } from './OperationsPages.jsx';
import { logisticsRoles } from '../shared/operations.js';
import ComponentEditor, { ComponentBrowser } from './ComponentEditor.jsx';
import { Bell, ClipboardCheck, ShoppingCart } from 'lucide-react';
import SupplyPages from './SupplyPages.jsx';
import { purchasingRoles, receivingRoles, supplyReadRoles } from '../shared/purchasing.js';

function InventoryPage({ inventory, user, onEdit, onAdd, onExport, onImport,locations,locationId,onLocationChange }) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All parts');
  const canEdit = ['admin', 'estimator'].includes(user.role)&&locationId!=='all';
  const visible = inventory.filter(item => `${item.name} ${item.id} ${item.location || ''} ${item.supplier || ''}`.toLowerCase().includes(search.toLowerCase()) && (category === 'All parts' || item.category === category));
  const value = inventory.reduce((sum, item) => sum + item.stock * (item.price || 0), 0);
  return <main className="management-page">
    <div className="page-eyebrow">WORKSPACE / MATERIALS</div>
    <div className="inventory-location-bar"><MapLocationIcon/><label>Inventory location<select aria-label="Inventory location" value={locationId} onChange={event=>onLocationChange(event.target.value)}>{locations.filter(location=>location.active).map(location=><option key={location.id} value={location.id}>{location.name}{location.id===user.locationId?' · my work location':''}</option>)}<option value="all">All locations · combined totals</option></select></label><span>{locationId==='all'?'Choose one site to edit counts or import stock.':'On hand includes held and staged goods. Neither leaves stock until dispatch.'}</span></div>
    <div className="page-title"><div><h1>Inventory</h1><p>Every component. Every cost. In one place.</p></div><div className="button-group"><button className="button" onClick={onExport}><Download size={16} /> Export sheet</button><button className="button" onClick={onImport} disabled={!canEdit}><FileUp size={16} /> Import inventory</button><button className="button primary" onClick={onAdd} disabled={!canEdit}><Plus size={17} /> Add part</button></div></div>
    <div className="inventory-metrics"><div><span>Catalog parts</span><strong>{inventory.length}<small>active items</small></strong></div><div><span>Inventory value</span><strong>{!costRoles.includes(user.role) ? 'Restricted' : money(value)}<small>priced stock only</small></strong></div><div><span>Below reorder point</span><strong className="amber-text">{inventory.filter(item => (item.available??item.stock) < item.reorder).length}<small>available quantity below minimum</small></strong></div><div><span>Awaiting pricing</span><strong>{inventory.filter(item => item.price == null).length}<small>custom or unpriced parts</small></strong></div></div>
    <div className="table-toolbar"><div className="search-field"><Search size={16} /><input aria-label="Search inventory" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search part name, ID, or location…" /></div><select aria-label="Filter inventory category" value={category} onChange={event => setCategory(event.target.value)}>{['All parts', ...[...new Set(inventory.map(item => item.category))].sort()].map(item => <option key={item}>{item}</option>)}</select><span>{visible.length} parts</span></div>
    <div className="table-scroll"><table className="inventory-table"><thead><tr><th>PART / DESCRIPTION</th><th>CATEGORY</th><th>ON HAND</th><th>HELD</th><th>STAGED</th><th>AVAILABLE</th><th>UNIT COST</th><th>STOCK VALUE</th><th>STATUS</th><th></th></tr></thead><tbody>{visible.map(item => <tr key={item.id}><td><strong>{item.name}</strong><small>{item.id} · {item.unit}{item.location ? ` · ${item.location}` : ''}</small>{item.supplier && <small>{item.supplier}</small>}</td><td><span className="category-label">{item.category}</span></td><td>{number(item.stock)} <span className="muted">{item.unit}</span></td><td>{number(item.held??item.reserved??0)}</td><td>{number(item.staged??0)}</td><td><strong>{number(item.available??item.stock)}</strong></td><td>{!costRoles.includes(user.role) ? 'Restricted' : money(item.price)}</td><td>{item.price == null ? '—' : money(item.stock * item.price)}</td><td><span className={`stock-label ${(item.available??item.stock) < item.reorder ? 'low' : item.price == null ? 'unpriced' : ''}`}><i />{(item.available??item.stock) < item.reorder ? 'Low stock' : item.price == null ? 'Needs pricing' : 'In stock'}</span></td><td><IconButton icon={Settings2} label={`Edit ${item.name}`} disabled={!canEdit} onClick={() => onEdit(item)} /></td></tr>)}</tbody></table>{!visible.length && <div className="empty-state"><Search size={30} /><h3>No matching parts</h3><p>Try another part name or category.</p><button className="button" onClick={() => { setSearch(''); setCategory('All parts'); }}>Clear filters</button></div>}</div>
    <p className="table-footnote">Stock is tracked independently from project estimates. Saving a design does not reserve or consume inventory.</p>
  </main>;
}

function MapLocationIcon(){return <Warehouse size={22} strokeWidth={1.4}/>;}

const money = value => value == null ? 'Not priced' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 }).format(value);
const number = value => new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(value);
const fabricColors = { ivory: '#deddd0', white: '#fff', green: '#6f8068', gray: '#969f9b' };
const fieldNames = { width: 'Width', length: 'Length', height: 'Eave height', baySpacing: 'Bay spacing', roof: 'Roof profile', fabric: 'Fabric color', endWalls: 'End walls', doorWidth: 'Door width', doorHeight: 'Door height', name: 'Project name', window: 'East-wall window', site: 'Existing terrain', construction: 'Wall & frame adaptation',floor:'Concrete floor' };

function NumberField({ label, value, onChange, min, max, disabled }) {
  const [input, setInput] = useState(String(value));
  useEffect(() => setInput(String(value)), [value]);
  const commit = () => {
    const candidate = Number(input);
    if (input.trim() && Number.isFinite(candidate) && candidate >= min && candidate <= max) onChange(candidate);
    setInput(String(value));
  };
  return <label className="number-field"><span>{label}</span><div className={disabled ? 'disabled' : ''}><input aria-label={label} type="number" min={min} max={max} step="1" value={input} disabled={disabled} onChange={event => setInput(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') event.target.blur(); }} /><span className="unit">ft</span><div className="steppers"><button aria-label={`Increase ${label.toLowerCase()}`} disabled={disabled || value >= max} onClick={() => onChange(Math.min(max, value + 1))}><Plus size={10} /></button><button aria-label={`Decrease ${label.toLowerCase()}`} disabled={disabled || value <= min} onClick={() => onChange(Math.max(min, value - 1))}><Minus size={10} /></button></div></div></label>;
}

function AuthDialog({ setup, onClose, onSuccess }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [twoFactor, setTwoFactor] = useState(false);
  const submit = async event => {
    event.preventDefault(); setError(''); setBusy(true);
    const form = Object.fromEntries(new FormData(event.currentTarget));
    try { const data = await api(`/auth/${setup ? 'register' : 'login'}`, form); onSuccess(data.user); }
    catch (error) { setError(error.message); if (error.requiresTwoFactor) setTwoFactor(true); }
    finally { setBusy(false); }
  };
  return <Modal title={setup ? 'Create your workspace' : 'Welcome back'} subtitle={setup ? 'The first account becomes the workspace administrator.' : 'Sign in to your Accu-Steel workspace.'} onClose={onClose}><form onSubmit={submit} className="form-stack">{setup && <label>Full name<input name="name" autoComplete="name" minLength={2} required placeholder="Your name" /></label>}<label>Work email<input name="email" type="email" autoComplete="username" required placeholder="you@accusteel.com" /></label><label>Password<input name="password" type="password" autoComplete={setup ? 'new-password' : 'current-password'} required minLength={setup ? 12 : 1} maxLength={72} placeholder={setup ? 'At least 12 characters' : 'Your password'} /></label>{twoFactor && <label>Authenticator code<input name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" required autoFocus /></label>}{error && <p className="form-error" role="alert">{error}</p>}<button className="button primary full" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : <LockKeyhole size={16} />}{setup ? 'Create workspace' : 'Sign in'}</button><p className="form-note"><ShieldCheck size={14} /> Private workspace · Role-based access</p></form></Modal>;
}

function AccountDialog({ user, onClose, onUser, notify, onLogout, onManagePeople }) {
  const [setup, setSetup] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function begin() { setBusy(true); try { setSetup(await api('/auth/2fa/setup', {})); } catch (error) { setError(error.message); } finally { setBusy(false); } }
  async function verify(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { const data = await api('/auth/2fa/verify', { code: new FormData(event.currentTarget).get('code') }); onUser(data.user); setSetup(null); notify('Two-factor authentication enabled.'); }
    catch (error) { setError(error.message); } finally { setBusy(false); }
  }
  return <Modal title="Workspace settings" subtitle={`${user.name} · ${user.email}`} onClose={onClose}>
    <div className="form-stack"><div className="security-status"><ShieldCheck size={24}/><div><strong>Two-factor authentication</strong><p>{user.twoFactor?'Enabled · authenticator app':'Not enabled for this account'}</p></div>{user.twoFactor&&<Check size={18}/>}</div>
      {!user.twoFactor&&!setup&&<button className="button primary" disabled={busy} onClick={begin}>Set up authenticator <ArrowRight size={15}/></button>}
      {setup&&<form onSubmit={verify} className="form-stack"><img className="qr-code" src={setup.qr} alt="Authenticator enrollment QR code"/><p className="muted">Scan with your authenticator, then enter its code. Back up the authenticator; self-service recovery is not available.</p><label>Manual setup key<code className="secret">{setup.secret}</code></label><label>Authenticator code<input name="code" inputMode="numeric" pattern="[0-9]{6}" required maxLength={6} autoComplete="one-time-code"/></label><button className="button primary" disabled={busy}>Verify & enable</button></form>}
      <div className="role-info"><span>Workspace role</span><strong className="capitalize">{user.role}</strong></div><div className="role-info"><span>Work location</span><strong>{user.locationId||'MAIN'}</strong></div>
      {user.role==='admin'&&<button className="button" onClick={onManagePeople}><Users size={15}/> Manage people & locations</button>}
      {error&&<p className="form-error" role="alert">{error}</p>}
    </div><div className="account-footer"><button className="button" onClick={onLogout}><LogOut size={14}/> Sign out of workspace</button></div>
  </Modal>;
}

function PartDialog({ part, onClose, onSave }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async event => {
    event.preventDefault(); setBusy(true); setError('');
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try { await onSave({ ...values, stock: Number(values.stock), reorder: Number(values.reorder), price: values.price === '' ? null : Number(values.price) }); }
    catch (error) { setError(error.message); } finally { setBusy(false); }
  };
  return <Modal title={part ? 'Edit inventory part' : 'Add inventory part'} subtitle="Unknown costs stay blank, not zero." onClose={onClose}>
    <form className="form-stack" onSubmit={submit}>
      <div className="form-grid"><label>Part ID<input name="id" defaultValue={part?.id} pattern="[A-Za-z0-9][A-Za-z0-9._/ -]{0,63}" maxLength={64} readOnly={Boolean(part)} required placeholder="CP-008" /></label><label>Category<input aria-label="Part category" name="category" defaultValue={part?.category || 'Custom'} maxLength={80} required /></label></div>
      <label>Description<input name="name" defaultValue={part?.name} required maxLength={120} placeholder="Custom fabricated bracket" /></label>
      <div className="form-grid"><label>Unit<input aria-label="Part unit" name="unit" defaultValue={part?.unit || 'ea'} maxLength={24} required /></label><label>Unit cost ($)<input name="price" type="number" min="0" step="0.01" defaultValue={part?.price ?? ''} placeholder="Not yet priced" /></label><label>On hand<input name="stock" type="number" min="0" step="0.01" defaultValue={part?.stock ?? 0} required /></label><label>Reorder point<input name="reorder" type="number" min="0" step="0.01" defaultValue={part?.reorder ?? 0} required /></label></div>
      <label>Storage location<input name="location" defaultValue={part?.location || ''} maxLength={160} /></label><label>Supplier<input name="supplier" defaultValue={part?.supplier || ''} maxLength={160} /></label>
      {error && <p className="form-error">{error}</p>}<button className="button primary full" disabled={busy}><Save size={16} /> Save part</button>
    </form>
  </Modal>;
}

function ImportDialog({ onClose, onImport }) {
  const [units, setUnits] = useState('feet');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function load(file) {
    if (!file) return;
    setError(''); setBusy(true);
    try {
      if (file.size > 8 * 1024 * 1024) throw new Error('Choose a file smaller than 8 MB.');
      const text = await file.text();
      if (/\.json$/i.test(file.name)) onImport({ building: parseProject(text) });
      else if (/\.dxf$/i.test(file.name)) onImport({ reference: parseDxf(text, file.name, units) });
      else throw new Error('Choose a .json project or an ASCII .dxf drawing. DWG requires conversion to DXF in your source CAD software.');
    } catch (error) { setError(error.message); } finally { setBusy(false); }
  }
  return <Modal title="Bring your work with you" subtitle="Import an editable project or a CAD reference." onClose={onClose}><div className="form-stack"><label className="upload-zone" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); load(event.dataTransfer.files[0]); }}><FileUp size={30} /><strong>{busy ? 'Reading drawing…' : 'Choose a drawing or project'}</strong><span>ASCII DXF or Draft Studio JSON · up to 8 MB</span><input type="file" accept=".json,.dxf" aria-label="Choose import file" onChange={event => load(event.target.files[0])} /></label><label>Source units, when not declared in DXF<select value={units} onChange={event => setUnits(event.target.value)}><option value="feet">Feet</option><option value="inches">Inches</option><option value="millimeters">Millimeters</option><option value="meters">Meters</option></select></label><div className="import-detail"><Layers3 size={19} /><p>DXF lines, straight polylines, arcs, and circles become a centered 2D reference. Blocks, text, solids, and dimensions are not converted into building parts. Reference overlays are session-only.</p></div><p className="muted">Native DWG, IFC, Revit, and STEP editing are not supported in this version.</p>{error && <p className="form-error" role="alert">{error}</p>}</div></Modal>;
}

function ExportDialog({ building, materials, onClose, notify }) {
  const fileName = building.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const exportFile = kind => {
    if (kind === 'project') download(`${fileName}.json`, JSON.stringify({ format: 'accusteel-draft', version: 1, building }, null, 2));
    if (kind === 'csv') download(`${fileName}-materials.csv`, materialsCsv(materials), 'text/csv');
    if (kind === 'dxf') download(`${fileName}-plan.dxf`, exportDxf(building), 'application/dxf');
    notify('Export downloaded.'); onClose();
  };
  return <Modal title="Export project" subtitle="Take your design into the next stage." onClose={onClose}><div className="export-options">{[{ kind: 'project', icon: Box, name: 'Draft Studio project', description: 'Editable building parameters · .json' }, { kind: 'dxf', icon: Ruler, name: '2D footprint & bay layout', description: 'ASCII DXF, feet · reference geometry only' }, { kind: 'csv', icon: Package, name: 'Bill of materials', description: 'Preliminary quantities & unit costs · .csv' }].map(({ kind, icon: Icon, name, description }) => <button key={kind} onClick={() => exportFile(kind)}><span className="export-icon"><Icon size={22} /></span><span><strong>{name}</strong><small>{description}</small></span><ArrowDownToLine size={18} /></button>)}</div><p className="form-note">Preliminary design only. Not a stamped construction document.</p></Modal>;
}

function Inventory({ inventory, user, onEdit, onAdd, onSignIn, onExport }) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All parts');
  const canEdit = ['admin', 'estimator'].includes(user?.role);
  const visible = inventory.filter(item => `${item.name} ${item.id}`.toLowerCase().includes(search.toLowerCase()) && (category === 'All parts' || item.category === category));
  const value = inventory.reduce((sum, item) => sum + item.stock * (item.price || 0), 0);
  return <main className="management-page"><div className="page-eyebrow">WORKSPACE / MATERIALS</div><div className="page-title"><div><h1>Inventory</h1><p>Every component. Every cost. In one place.</p></div><div className="button-group"><button className="button" onClick={onExport}><Download size={16} /> Export sheet</button><button className="button primary" onClick={() => user ? onAdd() : onSignIn()} disabled={Boolean(user && !canEdit)}><Plus size={17} /> Add part</button></div></div>{!user && <div className="demo-banner"><Warehouse size={18} /><span>Sample inventory · Sign in to manage your workspace’s live stock and costs.</span><button onClick={onSignIn}>Sign in <ArrowRight size={14} /></button></div>}<div className="inventory-metrics"><div><span>Catalog parts</span><strong>{inventory.length}<small>active items</small></strong></div><div><span>Inventory value</span><strong>{user?.role === 'viewer' ? 'Restricted' : money(value)}<small>priced stock only</small></strong></div><div><span>Below reorder point</span><strong className="amber-text">{inventory.filter(item => item.stock < item.reorder).length}<small>parts need attention</small></strong></div><div><span>Awaiting pricing</span><strong>{inventory.filter(item => item.price == null).length}<small>custom or unpriced parts</small></strong></div></div><div className="table-toolbar"><div className="search-field"><Search size={16} /><input aria-label="Search inventory" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search part name or ID…" /></div><select aria-label="Filter inventory category" value={category} onChange={event => setCategory(event.target.value)}>{['All parts', 'Structural', 'Covering', 'Hardware', 'Custom'].map(item => <option key={item}>{item}</option>)}</select><span>{visible.length} parts</span></div><div className="table-scroll"><table className="inventory-table"><thead><tr><th>PART / DESCRIPTION</th><th>CATEGORY</th><th>ON HAND</th><th>UNIT COST</th><th>STOCK VALUE</th><th>STATUS</th><th></th></tr></thead><tbody>{visible.map(item => <tr key={item.id}><td><strong>{item.name}</strong><small>{item.id} · {item.unit}</small></td><td><span className="category-label">{item.category}</span></td><td>{number(item.stock)} <span className="muted">{item.unit}</span></td><td>{money(item.price)}</td><td>{item.price == null ? '—' : money(item.stock * item.price)}</td><td><span className={`stock-label ${item.stock < item.reorder ? 'low' : item.price == null ? 'unpriced' : ''}`}><i />{item.stock < item.reorder ? 'Low stock' : item.price == null ? 'Needs pricing' : 'In stock'}</span></td><td><IconButton icon={Settings2} label={`Edit ${item.name}`} disabled={!canEdit} onClick={() => onEdit(item)} /></td></tr>)}</tbody></table>{!visible.length && <div className="empty-state"><Search size={30} /><h3>No matching parts</h3><p>Try another part name or category.</p><button className="button" onClick={() => { setSearch(''); setCategory('All parts'); }}>Clear filters</button></div>}</div><p className="table-footnote">Stock is tracked independently from project estimates. Saving a design does not reserve or consume inventory.</p></main>;
}

export default function App() {
  const [session, setSession] = useState({ loading: true, user: null, setupRequired: false, unavailable: false });
  async function checkSession() {
    setSession(current => ({ ...current, loading: true, unavailable: false }));
    try { const result = await api('/auth'); setSession({ ...result, loading: false, unavailable: false }); }
    catch { setSession({ user: null, loading: false, setupRequired: false, unavailable: true }); }
  }
  useEffect(() => {
    checkSession();
    const signOut = () => setSession(current => ({ ...current, user: null, loading: false }));
    window.addEventListener('studio:unauthorized', signOut);
    return () => window.removeEventListener('studio:unauthorized', signOut);
  }, []);
  if (session.loading || !session.user) return <LoginPage key={session.user?.id || 'login'} loading={session.loading} setupRequired={session.setupRequired} unavailable={session.unavailable} onRetry={checkSession} onSuccess={user => setSession({ user, loading: false, setupRequired: false, unavailable: false })} />;
  return <WorkspaceApp key={session.user.id} account={session.user} onSignedOut={() => setSession(current => ({ ...current, user: null }))} />;
}

function WorkspaceApp({ account, onSignedOut }) {
  const [history, setHistory] = useState(() => {
    let building = defaultBuilding;
    try { const saved = JSON.parse(localStorage.getItem(`accusteel-draft:${account.id}:${account.email}`)); if (saved) building = buildingSchema.parse(saved); } catch {}
    return { past: [], present: building, future: [] };
  });
  const building = history.present;
  const [tab, setTab] = useState('design');
  const [view, setView] = useState('3d');
  const [cutaway, setCutaway] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [showDimensions, setShowDimensions] = useState(true);
  const [wireframe, setWireframe] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [selected, setSelected] = useState(null);
  const [reference, setReference] = useState(null);
  const [modal, setModal] = useState(null);
  const [user, setUser] = useState(account);
  const [setupRequired, setSetupRequired] = useState(false);
  const [aiConnected, setAiConnected] = useState(false);
  const [inventory, setInventory] = useState([]);
  const [inventoryLocation,setInventoryLocation]=useState(account.locationId||'MAIN');
  const [locations,setLocations]=useState([]);
  const [stockWarnings,setStockWarnings]=useState([]);
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState(null);
  const [savedModel, setSavedModel] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [part, setPart] = useState(null);
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState([]);
  const [proposal, setProposal] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [commandContext, setCommandContext] = useState(null);
  const [mobilePanel, setMobilePanel] = useState('model');
  const [bomExpanded, setBomExpanded] = useState(false);
  const [workspace, setWorkspace] = useState({ name: 'Accu-Steel workspace', supportEmail: '' });
  const conversationRef = useRef(null);
  const currentModelRef = useRef(building);
  currentModelRef.current = building;
  const canDesign = designRoles.includes(user.role);
  const metrics = buildingMetrics(building);
  const materials = billOfMaterials(building, inventory);
  const total = materials.reduce((sum, part) => sum + (part.total || 0), 0);
  const unpriced = materials.filter(part => part.price == null).length;
  const warnings = designWarnings(building);
  const dirty = JSON.stringify(building) !== savedModel;
  const notify = message => setToast(message);
  function editComponent(label){setSelected(label);setModal('component');}
  async function reloadProjects() { const data = await api('/projects'); setProjects(data); return data; }
  async function reloadLocations(){const data=await api('/locations');setLocations(data);return data;}
  async function reloadInventory(){setInventory(await api(`/inventory?location=${encodeURIComponent(inventoryLocation)}`));}
  async function reloadStockWarnings(){if(supplyReadRoles.includes(user.role))setStockWarnings(await api(`/ordering-board?location=${encodeURIComponent(inventoryLocation)}`));}
  async function refreshStock(){await Promise.all([reloadInventory(),reloadStockWarnings()]);}
  function workspaceChanged(settings) { setWorkspace(current => ({ ...current, ...settings })); if ('aiConnected' in settings) setAiConnected(settings.aiConnected); }

  useEffect(() => { api('/auth').then(data => { if (!data.user) onSignedOut(); else { setUser(data.user); setAiConnected(data.aiConnected); } }).catch(() => onSignedOut()); }, []);
  useEffect(() => { api('/workspace').then(workspaceChanged).catch(() => {}); }, []);
  useEffect(() => { try { localStorage.setItem(`accusteel-draft:${account.id}:${account.email}`, JSON.stringify(building)); } catch { notify('Local storage is unavailable. Export your project to keep a copy.'); } }, [building]);
  useEffect(() => {
    if (!user) { setInventory(initialInventory); setProjects([]); return; }
    reloadLocations().catch(error=>notify(error.message));
    api('/projects').then(setProjects).catch(error => notify(error.message));
  }, [user]);
  useEffect(()=>{reloadInventory().catch(error=>notify(error.message));},[inventoryLocation,user.id]);
  useEffect(()=>{reloadStockWarnings().catch(()=>{});const timer=setInterval(()=>reloadStockWarnings().catch(()=>{}),60000);return()=>clearInterval(timer);},[inventoryLocation,user.role,tab]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), 5000); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { conversationRef.current?.scrollTo({ top: conversationRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, proposal, aiBusy]);

  function update(changes) {
    if (!canDesign) { notify('Your role has read-only access to designs.'); return; }
    const parsed = buildingSchema.safeParse({ ...building, ...changes });
    if (!parsed.success) { notify(parsed.error.issues[0].message); return; }
    if (JSON.stringify(parsed.data) === JSON.stringify(building)) return;
    setHistory(current => ({ past: [...current.past.slice(-49), current.present], present: parsed.data, future: [] }));
    setProposal(null);
  }
  function undo() { setHistory(current => !current.past.length ? current : ({ past: current.past.slice(0, -1), present: current.past.at(-1), future: [current.present, ...current.future] })); setProposal(null); }
  function redo() { setHistory(current => !current.future.length ? current : ({ past: [...current.past, current.present], present: current.future[0], future: current.future.slice(1) })); setProposal(null); }
  async function save() {
    if (!user) { setModal('auth'); return; }
    setBusy(true);
    try { const result = await api('/projects', { id: projectId, building }); setProjectId(result.id); setSavedModel(JSON.stringify(building)); setProjects(await api('/projects')); notify('Project saved to your workspace.'); }
    catch (error) { notify(error.message); } finally { setBusy(false); }
  }
  function openProject(project) {
    if (dirty && projectId && !confirm('Open another project? Your current unsaved changes remain only in the local draft until replaced.')) return;
    setHistory({ past: [], present: buildingSchema.parse(project.building), future: [] }); setProjectId(project.id); setSavedModel(JSON.stringify(project.building)); setReference(null); setProposal(null); setTab('design'); setResetKey(key => key + 1);
  }
  async function sendCommand(text = prompt) {
    if (!text.trim() || aiBusy || !canDesign) return;
    setPrompt(''); setProposal(null); setMessages(current => [...current, { role: 'user', content: text }]); setAiBusy(true);
    try {
      let result;
      const context = selected?.toLowerCase().includes('door') ? 'door' : selected?.toLowerCase().includes('window') ? 'window' : commandContext;
      if (aiConnected && user) result = await api('/ai/design', { prompt: text, building, context });
      else {const candidate=parseDesignCommand(text,building,context);result={building:candidate,explanation:JSON.stringify(candidate.floor)!==JSON.stringify(building.floor)?candidate.floor.enabled?`Concrete floor proposed at ${candidate.floor.thickness} in thickness with ${candidate.floor.wastePercent}% allowance. Confirm these draft inputs before applying; reinforcement and structural adequacy are not calculated.`:'Concrete floor removal proposed. Review before applying.':'I’ve prepared a design update. Review the changes below.'};}
      if (JSON.stringify(currentModelRef.current) !== JSON.stringify(building)) throw new Error('The building changed while this request was being prepared. Please resend the request against the current design.');
      const changes = Object.keys(result.building).filter(key => JSON.stringify(result.building[key]) !== JSON.stringify(building[key]));
      if (/\bdoor\b/i.test(text)) setCommandContext('door');
      else if (/\bwindow\b/i.test(text)) setCommandContext('window');
      else if (/\b(building|footprint|barn)\b/i.test(text)) setCommandContext('building');
      if (changes.length) { setProposal({ ...result, changes }); setMessages(current => [...current, { role: 'assistant', content: result.explanation }]); }
      else setMessages(current => [...current, { role: 'assistant', content: result.explanation || 'This design already matches those settings.' }]);
    } catch (error) { setMessages(current => [...current, { role: 'assistant', content: error.issues?.[0]?.message || error.message, error: true }]); }
    finally { setAiBusy(false); }
  }
  function applyProposal() {
    const changeCount = proposal.changes.length;
    update(proposal.building);
    setMessages(current => [...current, { role: 'assistant', content: `${changeCount} ${changeCount === 1 ? 'change' : 'changes'} applied. The model and material quantities are up to date.`, success: true }]);
  }
  function imported(data) {
    if (data.building) { update(data.building); setProjectId(null); setSavedModel(null); setReference(null); notify('Editable project imported.'); }
    if (data.reference) { setReference(data.reference); setView('plan'); notify(`Reference imported · ${data.reference.segments.length} segments${data.reference.unsupported ? ` · ${data.reference.unsupported} unsupported entities skipped` : ''}.`); }
    setModal(null); setTab('design'); setResetKey(key => key + 1);
  }

  return <div className="app-shell">
    <header className="app-header">
      <a href="#" className="brand" onClick={event => { event.preventDefault(); setTab('design'); }} aria-label="Accu-Steel Draft Studio"><span className="brand-symbol"><Warehouse size={23} strokeWidth={2} /></span><div><span className="brand-name">ACCU-STEEL<span className="brand-registered">®</span></span><span className="brand-subtitle">DRAFT STUDIO</span></div></a>
      <span className="header-divider" />
      <nav className="main-nav" aria-label="Workspace">
        {[{ id: 'design', name: 'Design', icon: Box }, { id: 'projects', name: 'Projects', icon: FolderOpen }, { id: 'inventory', name: 'Inventory', icon: Package }, ...(logisticsRoles.includes(user.role)?[{id:'customers',name:'Customers',icon:Users}]:[]),...(supplyReadRoles.includes(user.role)?[{id:'shipping',name:'Shipping',icon:Send}]:[]),...(purchasingRoles.includes(user.role)?[{id:'ordering',name:'Ordering',icon:ShoppingCart}]:[]),...(receivingRoles.includes(user.role)?[{id:'receiving',name:'Receiving',icon:ClipboardCheck}]:[]),{ id: 'support', name: 'Support', icon: MessageSquare }, ...(user.role === 'admin' ? [{ id: 'admin', name: 'Admin', icon: ShieldCheck }] : [])].map(({ id, name, icon: Icon }) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><Icon size={17} />{name}</button>)}
      </nav>
      <div className="header-actions"><span className="workspace-label" title={workspace.name}><i />{workspace.name}</span>{supplyReadRoles.includes(user.role)&&<button className="icon-button stock-warning-button" aria-label={`Low-stock warnings: ${stockWarnings.filter(row=>!row.acknowledged).length}`} title="Low-stock warnings at the selected inventory location" onClick={()=>setTab(purchasingRoles.includes(user.role)?'ordering':'receiving')}><Bell size={17}/>{stockWarnings.some(row=>!row.acknowledged)&&<span>{stockWarnings.filter(row=>!row.acknowledged).length}</span>}</button>}<IconButton icon={CircleHelp} label="About Draft Studio" onClick={() => setModal('about')} /><span className="header-divider" />{user ? <button className="account-button" onClick={() => setModal('account')} title="Workspace settings"><span className="avatar">{user.name.split(' ').map(word => word[0]).slice(0, 2).join('')}</span><ChevronDown size={13} /></button> : <button className="button sign-in" onClick={() => setModal('auth')}><LogIn size={15} /> Sign in</button>}</div>
    </header>

    {tab === 'design' && <>
      <section className="project-bar"><div className="project-identity"><div className="breadcrumb">PROJECTS <ChevronRight size={11} /> {projectId ? `AS-${String(projectId).padStart(4, '0')}` : 'LOCAL DRAFT'}</div><div className="project-name-row"><h1><input aria-label="Project name" value={building.name} maxLength={100} readOnly={!canDesign} onChange={event => { if (event.target.value.trim()) update({ name: event.target.value }); }} /></h1><span className="draft-badge">Draft</span></div></div><span className="save-state"><Cloud size={15} />{projectId && !dirty ? 'Saved to workspace' : 'Saved on this device'}</span><div className="project-buttons"><button className="button import-button" disabled={!canDesign} onClick={() => setModal('import')}><FileUp size={16} /> Import</button><button className="button" onClick={() => setModal('export')}><ArrowDownToLine size={16} /> Export <ChevronDown size={12} /></button><button className="button primary" disabled={busy || Boolean(user && !canDesign)} onClick={save}>{busy ? <LoaderCircle size={16} className="spin" /> : <Save size={15} />} Save project</button></div></section>
      <div className="design-context-bar"><div><span className="datum-badge">S → N</span><span>South-end datum</span><span className="context-divider" /><span>{building.construction.wallMode === 'concrete' ? 'Concrete wall adaptation' : building.window.enabled ? '1 east-wall window' : 'No window reference'}</span><span className="context-divider" /><span>{building.site.startElevation === building.site.endElevation ? 'Level terrain' : `${building.site.startElevation} → ${building.site.endElevation} ft terrain`}</span></div><div className="construction-context-actions"><button className="button compact" onClick={() => setModal('construction')}><Ruler size={13} /> Construction schedule</button><button className="button compact" onClick={() => setModal('site')}><Settings2 size={13} /> Site & openings</button></div></div>
      {warnings.length > 0 && <div className="design-review-notice" role="status"><ShieldCheck size={14} /><span>{building.construction.wallMode === 'concrete' ? 'Geometry-based wall, steel-length, and cut/fill takeoff · not engineered or released for fabrication.' : 'Wall adaptation is disabled · site/foundation quantities are not engineered or included in the estimate.'}</span><button onClick={() => setModal('site')}>Review <ChevronRight size={12} /></button></div>}
      <div className="mobile-switcher"><button className={mobilePanel === 'settings' ? 'selected' : ''} onClick={() => setMobilePanel('settings')}><Settings2 size={14} /> Building</button><button className={mobilePanel === 'model' ? 'selected' : ''} onClick={() => setMobilePanel('model')}><Box size={14} /> Model</button><button className={mobilePanel === 'assistant' ? 'selected' : ''} onClick={() => setMobilePanel('assistant')}><Sparkles size={14} /> Assistant</button></div>
      <div className={`design-workspace mobile-${mobilePanel}`}>
        <aside className="properties-panel"><div className="panel-heading"><span><Settings2 size={16} /> Building properties</span><span className="tiny-tag">FT</span></div><div className="properties-scroll"><div className="properties-intro"><div className="structure-icon"><Warehouse size={25} strokeWidth={1.4} /></div><div><strong>Fabric-covered steel</strong><span>Clear-span building system</span></div></div><details open className="property-section"><summary>Dimensions <ChevronDown size={14} /></summary><div className="dimension-inputs"><NumberField label="Width" value={building.width} min={20} max={160} disabled={!canDesign} onChange={value => update({ width: value })} /><NumberField label="Length" value={building.length} min={24} max={400} disabled={!canDesign} onChange={value => update({ length: value })} /><NumberField label="Eave height" value={building.height} min={8} max={32} disabled={!canDesign} onChange={value => update({ height: value })} /><NumberField label="Bay spacing" value={building.baySpacing} min={6} max={24} disabled={!canDesign} onChange={value => update({ baySpacing: value })} /></div><div className="calculated-row"><span>Floor area</span><strong>{number(metrics.area)} <small>sq ft</small></strong></div>{metrics.actualBay !== building.baySpacing && <p className="field-note">{metrics.bays} equal bays at {number(metrics.actualBay)} ft to fit the building length.</p>}</details><details open className="property-section"><summary>Structure <ChevronDown size={14} /></summary><label className="field-label">Roof profile<select disabled={!canDesign} value={building.roof} onChange={event => update({ roof: event.target.value })}><option value="arch">Arched · clear span</option><option value="gable">Gable · pitched roof</option></select></label><div className="read-only-field"><span>Frame material</span><div><span className="material-dot" /> Galvanized steel <LockKeyhole size={11} /></div></div><div className="calculated-row"><span>Primary frames</span><strong>{metrics.frames} <small>frames</small></strong></div></details><details open className="property-section"><summary>Covering & enclosure <ChevronDown size={14} /></summary><label className="field-label">Fabric color<span className="color-label">{building.fabric}</span></label><div className="color-options">{Object.entries(fabricColors).map(([name, color]) => <button title={`${name} fabric`} aria-label={`${name} fabric`} aria-pressed={building.fabric === name} disabled={!canDesign} key={name} onClick={() => update({ fabric: name })} className={building.fabric === name ? 'selected' : ''} style={{ '--swatch': color }}>{building.fabric === name && <Check size={15} />}</button>)}</div><label className="toggle-row"><span>Enclose end walls</span><input type="checkbox" checked={building.endWalls} disabled={!canDesign} onChange={event => update({ endWalls: event.target.checked })} /><span className="toggle-track" /></label></details><details open className="property-section"><summary>Front opening <ChevronDown size={14} /></summary><div className="dimension-inputs"><NumberField label="Door width" value={building.doorWidth} min={0} max={40} disabled={!canDesign || !building.endWalls} onChange={value => update(value === 0 ? { doorWidth: 0, doorHeight: 0 } : { doorWidth: value, doorHeight: building.doorHeight || 14 })} /><NumberField label="Door height" value={building.doorHeight} min={0} max={28} disabled={!canDesign || !building.endWalls} onChange={value => update(value === 0 ? { doorWidth: 0, doorHeight: 0 } : { doorHeight: value, doorWidth: building.doorWidth || 20 })} /></div><span className="custom-note"><span /> Custom part · pricing required</span></details>{reference && <div className="reference-info"><div><File size={16} /><strong>{reference.name}</strong><IconButton icon={X} label="Remove DXF reference" onClick={() => setReference(null)} /></div><span>{number(reference.width)} × {number(reference.length)} ft · {reference.units}</span><small>{reference.unsupported} unsupported entities skipped · session-only</small></div>}</div><div className="properties-footer"><ShieldCheck size={17} /><div><strong>Built on precision.</strong><span>Designed for what’s next.</span></div><span className="footer-mark">AS</span></div></aside>

        <main className={`model-workspace ${bomExpanded ? 'bom-expanded' : ''}`}>
          <div className="viewport-toolbar"><div className="view-tabs" role="group" aria-label="Drawing view"><button className={view==='3d'?'selected':''} onClick={()=>setView('3d')}><Box size={14}/> 3D model</button><button className={view==='plan'?'selected':''} onClick={()=>setView('plan')}>Plan</button><button className={view==='front'?'selected':''} onClick={()=>setView('front')}>Elevation</button></div><div className="toolbar-right"><button className="button compact components-button" onClick={()=>setModal('components')}><Layers3 size={14}/> Components</button><div className="undo-tools"><IconButton icon={Undo2} label="Undo design change" disabled={!history.past.length||!canDesign} onClick={undo}/><IconButton icon={Redo2} label="Redo design change" disabled={!history.future.length||!canDesign} onClick={redo}/></div><IconButton icon={Maximize} label="Fit building in view" onClick={()=>setResetKey(key=>key+1)}/></div></div>
          <div className="viewport">
            <Scene building={building} view={view} cutaway={cutaway} showGrid={showGrid} showDimensions={showDimensions} wireframe={wireframe} reference={reference} resetKey={resetKey} onSelect={setSelected} onEdit={editComponent} selectedPart={selected}/>
            <div className="viewport-tag"><span/>{view==='3d'?'PERSPECTIVE':view==='plan'?'TOP / PLAN':'FRONT ELEVATION'}<span className="tag-divider"/>{wireframe?'WIREFRAME':'SHADED'}</div>
            <div className="floating-tools"><IconButton icon={MousePointer2} label="Select a component, then edit properties" active/><IconButton icon={Ruler} label="Toggle dimensions" active={showDimensions} onClick={()=>setShowDimensions(value=>!value)}/><IconButton icon={Grid2X2} label="Toggle ground grid" active={showGrid} onClick={()=>setShowGrid(value=>!value)}/><span/><IconButton icon={Layers3} label="Toggle wireframe" active={wireframe} onClick={()=>setWireframe(value=>!value)}/></div>
            <button className={`cutaway-button ${cutaway?'selected':''}`} onClick={()=>setCutaway(value=>!value)} aria-pressed={cutaway}><Box size={14}/> Cutaway <span className="mini-toggle"/></button><div className="orientation"><span className="north">N</span><div className="compass-arrow"/><span className="east">E</span></div>
            <div className="viewport-bottom"><span className="model-live"><i/> Model up to date</span><span>UNITS: FEET <span className="dot-separator">·</span> {metrics.bays} BAYS</span></div>
            {selected&&<div className="selection-popover editable-selection"><Box size={16}/><div><strong>{selected}</strong><small>Selected component</small></div><button className="button primary compact" onClick={()=>editComponent(selected)}><Settings2 size={13}/> {canDesign?'Edit properties':'View properties'}</button><IconButton icon={X} label="Clear selection" onClick={()=>setSelected(null)}/></div>}
          </div>
          <div className="model-stats"><div><span>BUILDING FOOTPRINT</span><strong>{building.width}′ <span>×</span> {building.length}′</strong></div><div><span>FLOOR AREA</span><strong>{number(metrics.area)} <small>sq ft</small></strong></div><div><span>RIDGE HEIGHT</span><strong>{number(metrics.ridge)} <small>ft</small></strong></div><div><span>STRUCTURAL BAYS</span><strong>{metrics.bays} <small>@ {number(metrics.actualBay)} ft</small></strong></div></div>
          <section className="bom-section"><div className="bom-heading"><div><Package size={16}/><h2>Bill of materials</h2><span className="count-badge">{materials.length}</span><span className="preliminary-badge">Preliminary</span></div><div><IconButton icon={Download} label="Download bill of materials CSV" onClick={()=>download('materials.csv',materialsCsv(materials),'text/csv')}/><IconButton icon={Expand} label={bomExpanded?'Collapse material list':'Expand material list'} active={bomExpanded} onClick={()=>setBomExpanded(value=>!value)}/></div></div>
            <div className="bom-table-scroll"><table className="bom-table"><thead><tr><th>COMPONENT</th><th>QTY</th><th>UNIT</th><th>UNIT COST</th><th>TOTAL</th></tr></thead><tbody>{materials.map(item=><tr key={item.id}><td><span className={`part-type ${item.category.toLowerCase()}`}><Layers3 size={13}/></span><span>{item.name}</span>{item.price==null&&<span className="unpriced-dot" title="Pricing required"/>}</td><td>{number(item.quantity)}</td><td>{item.unit}</td><td className={item.price==null?'unpriced-text':''}>{item.price==null?<button onClick={()=>{if(['admin','estimator'].includes(user.role)){setPart(item);setModal('part');}else notify('Ask an estimator or administrator to price this part.');}}>Add price <Plus size={10}/></button>:money(item.price)}</td><td>{item.total==null?'—':money(item.total)}</td></tr>)}</tbody></table></div>
            <div className="bom-total"><span><i/> {unpriced?`${unpriced} ${unpriced===1?'item needs':'items need'} pricing`:'All catalog items priced'} <small>· Excludes labor, freight & foundations</small></span><span>Material estimate <strong>{costRoles.includes(user.role)?money(total):'Restricted'}</strong></span></div>
          </section>
        </main>

        <aside className="assistant-panel">
          <div className="panel-heading"><span><Sparkles size={16} className="accent-icon" /> Design assistant</span><span className="assistant-status"><i />{aiConnected && user ? 'AI CONNECTED' : 'LOCAL COMMANDS'}</span></div>
          <div className="conversation" ref={conversationRef}>
            <div className="assistant-welcome"><div className="assistant-emblem"><Sparkles size={23} strokeWidth={1.4} /></div><span className="eyebrow">A LITTLE VISION. A LOT OF POSSIBILITY.</span><h2>Let’s build<br />something great.</h2><p>Your {building.width} × {building.length} ft building is taking shape.<br />What would you like to change?</p></div>
            <div className="conversation-divider"><span>YOUR DESIGN, IN YOUR WORDS</span></div>
            <div className="assistant-initial"><span className="assistant-avatar"><Sparkles size={13} /></span><div><strong>Accu-Steel assistant <span>NOW</span></strong><p>I have your building at {building.width}′ wide, {building.length}′ long, with {metrics.frames} galvanized frames and {building.fabric} fabric.</p><div className="assistant-model-card"><Warehouse size={27} strokeWidth={1.2} /><div><strong>{building.name}</strong><span>{number(metrics.area)} sq ft · {building.roof === 'arch' ? 'Arched' : 'Gable'} roof</span></div><span className="model-card-dot" /></div></div></div>
            {messages.length === 0 && <div className="suggestions"><span>A FEW STARTING POINTS</span>{[{ text: 'Make it 80 ft wide', icon: ArrowUpRight }, { text: 'Switch to a gable roof', icon: LayoutTemplate }, { text: 'Use green fabric', icon: Square }].map(({ text, icon: Icon }) => <button disabled={!canDesign} key={text} onClick={() => sendCommand(text)}><Icon size={14} />{text}<Plus size={13} /></button>)}</div>}
            {messages.map((message, index) => <div className={`chat-message ${message.role} ${message.error ? 'error' : ''} ${message.success ? 'success' : ''}`} key={index}>{message.role === 'assistant' && <span className="assistant-avatar">{message.success ? <Check size={13} /> : <Sparkles size={13} />}</span>}<p>{message.content}</p></div>)}
            {aiBusy && <div className="thinking"><LoaderCircle size={14} className="spin" /> Preparing your design…</div>}
            {proposal && <div className="proposal"><strong><Settings2 size={14} /> Proposed changes</strong>{proposal.changes.map(key => <div className={['window', 'site', 'construction','floor'].includes(key) ? 'nested-proposal-row' : ''} key={key}><span>{fieldNames[key]}</span><span>{describeDesignValue(key, building[key])} <ArrowRight size={11} /> <b>{describeDesignValue(key, proposal.building[key])}</b></span></div>)}{designWarnings(proposal.building).map(warning => <p className="proposal-warning" key={warning}>{warning}</p>)}<button className="button primary full" onClick={applyProposal}><Check size={14} /> Apply to building</button><button className="text-button" onClick={() => { setProposal(null); setMessages(current => [...current, { role: 'assistant', content: 'Changes discarded. Your building is unchanged.' }]); }}>Discard changes</button></div>}
          </div>
          <div className="assistant-composer"><form onSubmit={event => { event.preventDefault(); sendCommand(); }}><textarea aria-label="Describe a design change" placeholder={canDesign ? 'Describe your next design change…' : 'Your role has read-only design access'} value={prompt} maxLength={2000} rows={2} disabled={!canDesign} onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendCommand(); } }} /><div><span><Sparkles size={12} />{aiConnected && user ? 'AI-assisted design' : 'Local dimension commands'}</span><button aria-label="Send design request" title="Send design request" disabled={!prompt.trim() || aiBusy || !canDesign}><ArrowRight size={17} /></button></div></form><p><ShieldCheck size={11} /> Engineer review required before construction.</p></div>
          <div className="assistant-bottom"><span className="brand-wordmark">ACCU-STEEL</span><span>BUILT TO ENDURE.</span></div>
        </aside>
      </div>
    </>}

    {tab === 'inventory' && <InventoryPage inventory={inventory} user={user} locations={locations} locationId={inventoryLocation} onLocationChange={setInventoryLocation} onEdit={item => { setPart(item); setModal('part'); }} onAdd={() => { setPart(null); setModal('part'); }} onImport={() => setModal('inventory-import')} onExport={async()=>{try{const items=inventoryLocation==='all'?await api('/inventory?location=all&flat=true'):inventory;download('inventory.csv',inventoryCsv(items),'text/csv');}catch(error){notify(error.message);}}} />}
    {tab==='customers'&&logisticsRoles.includes(user.role)&&<CustomersPage notify={notify}/>}
    {tab==='shipping'&&supplyReadRoles.includes(user.role)&&<ShippingPage user={user} notify={notify} onStockChanged={refreshStock}/>}
    {['ordering','receiving'].includes(tab)&&supplyReadRoles.includes(user.role)&&<SupplyPages key={tab} user={user} mode={tab} notify={notify} onStockChanged={refreshStock}/>}
    {tab === 'projects' && <ProjectCenter user={user} projects={projects} onReload={reloadProjects} onOpen={openProject} onSignIn={() => setModal('auth')} notify={notify} />}
    {tab === 'support' && <SupportCenter user={user} projects={projects} supportEmail={workspace.supportEmail} onSignIn={() => setModal('auth')} notify={notify} />}
    {tab === 'admin' && <AdminCenter user={user} notify={notify} onWorkspaceChange={workspaceChanged} onSecurity={() => setModal(user ? 'account' : 'auth')} onSupport={() => setTab('support')} onSignIn={() => setModal('auth')} onLocationsChanged={reloadLocations} />}

    <footer className="app-status"><div><span className="status-indicator" /> DRAFT STUDIO <span className="status-version">v0.1</span><span className="status-rule" /><span>Preliminary design workspace</span></div><div><span>Audubon, Iowa</span><span className="status-rule" /><span>Imperial (ft / in)</span><span className="status-rule" /><span className="status-scale">{user ? `${user.role} access` : 'Local draft'}</span></div></footer>
    {toast && <div className="toast" role="status"><Check size={16} /><span>{toast}</span><IconButton icon={X} label="Dismiss notification" onClick={() => setToast(null)} /></div>}
    {modal === 'auth' && <AuthDialog setup={setupRequired} onClose={() => setModal(null)} onSuccess={account => { setUser(account); setSetupRequired(false); setModal(null); notify('Welcome to your workspace.'); }} />}
    {modal === 'account' && user && <AccountDialog user={user} onClose={() => setModal(null)} onUser={setUser} notify={notify} onManagePeople={()=>{setModal(null);setTab('admin');}} onLogout={async () => { try { await api('/auth/logout', {}); onSignedOut(); } catch (error) { notify(error.message); } }} />}
    {modal === 'inventory-import' && <InventoryImport inventory={inventory} locations={locations} locationId={inventoryLocation} onClose={() => setModal(null)} onImported={async result => {const site=result.locationId||inventoryLocation;setInventoryLocation(site);setInventory(await api(`/inventory?location=${encodeURIComponent(site)}`));setModal(null);notify(`Inventory imported: ${result.counts.add} added, ${result.counts.update} updated, ${result.counts.skip} skipped.`); }} />}
    {modal === 'import' && <ImportDialog onClose={() => setModal(null)} onImport={imported} />}
    {modal === 'export' && <ExportDialog building={building} materials={materials} onClose={() => setModal(null)} notify={notify} />}
    {modal === 'site' && <Modal wide title="Site & openings" subtitle="Manual site, wall, floor, and opening parameters · engineering review required." onClose={() => setModal(null)}><SiteControls building={building} canEdit={canDesign} onSave={changes => { update(changes); setModal(null); notify('Construction geometry and material takeoff updated. Engineering release remains pending.'); }} /></Modal>}
    {modal === 'construction' && <Modal wide title="Construction schedule" subtitle="Calculated from the current building revision · review before fabrication." onClose={() => setModal(null)}><ConstructionReport building={building} /></Modal>}
    {modal==='components'&&<Modal title="Building components" subtitle="Choose a modeled component to view or edit its properties." onClose={()=>setModal(null)}><ComponentBrowser building={building} onChoose={editComponent}/></Modal>}
    {modal==='component'&&<Modal wide title={canDesign?'Component properties':'Component properties · read only'} subtitle={selected||'Building'} onClose={()=>setModal(null)}><ComponentEditor key={selected} label={selected} building={building} canEdit={canDesign} onSave={changes=>{update(changes);setModal(null);notify('Component updated. Model and quantities recalculated.');}}/></Modal>}
    {modal === 'part' && <PartDialog part={part} onClose={() => setModal(null)} onSave={async item => {if(inventoryLocation==='all')throw new Error('Choose one inventory location before editing quantities.');await api('/inventory',{...item,location_id:part?.location_id||inventoryLocation});await reloadInventory();setModal(null);notify('Inventory balance and material costs saved.'); }} />}
    {modal === 'about' && <Modal title="Accu-Steel Draft Studio" subtitle="A connected foundation for your next building." onClose={() => setModal(null)}><div className="form-stack"><p className="about-copy">A working design prototype for parametric fabric-covered steel structures, preliminary material takeoffs, and inventory costs.</p><div className="notice"><ShieldCheck size={21} /><p><strong>Not construction-ready engineering.</strong> Frame sizes, loads, connections, foundations, fire ratings, and site-specific code compliance require a licensed engineer. Catalog prices and quantities are illustrative.</p></div><p className="muted">DXF imports are reference-only. Native AutoCAD DWG editing, certified structural calculations, and arbitrary 3D part modeling are not implemented. Local commands are deterministic; connected AI requires a server-side API key.</p><a className="button" href="https://accusteel.com" target="_blank" rel="noreferrer">Accu-Steel <ArrowUpRight size={15} /></a></div></Modal>}
  </div>;
}
