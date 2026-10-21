import { useState } from 'react';
import { Check, Mountain, Save, ShieldCheck, SquareDashed } from 'lucide-react';
import { buildingSchema, designWarnings, constructionTakeoff, floorTakeoff } from '../shared/model.js';

export function describeDesignValue(key, value) {
  if (key === 'window') return value.enabled ? `${value.width} × ${value.height} ft · east wall · near edge ${value.offset} ft from ${value.offsetFrom}` : 'No window';
  if (key === 'site') return `${value.startElevation} → ${value.endElevation} ft toward ${value.riseToward} · slope starts ${value.slopeStart}%`;
  if (key === 'construction') return value.wallMode === 'concrete' ? `${value.wallThickness} in concrete · ${value.clearance} ft clearance · floor ${value.floorElevation} ft · ${value.columnMode === 'wall-top' ? 'wall-supported columns' : 'original columns'}` : `No wall adaptation · floor ${value.floorElevation} ft`;
  if(key==='floor')return value.enabled?`${value.thickness} in slab · ${value.wastePercent}% allowance`:'No concrete floor';
  return typeof value === 'boolean' ? value ? 'Yes' : 'No' : String(value);
}

export default function SiteControls({ building, onSave, canEdit }) {
  const [draft, setDraft] = useState({ window: { ...building.window }, site: { ...building.site }, construction: { ...building.construction },floor:{...building.floor} });
  const [error, setError] = useState('');
  function change(group, field, value) { setDraft(current => ({ ...current, [group]: { ...current[group], [field]: value } })); setError(''); }
  function field(group, name, label, min, max, unit = 'ft') {
    return <label>{label} ({unit})<input type="number" aria-label={label} value={draft[group][name]} min={min} max={max} step="any" required disabled={!canEdit} onChange={event => change(group, name, event.target.value === '' ? '' : Number(event.target.value))} /></label>;
  }
  function submit(event) {
    event.preventDefault();
    const result = buildingSchema.safeParse({ ...building, ...draft });
    if (!result.success) { setError(result.error.issues[0].message); return; }
    onSave(draft);
  }
  const warnings = designWarnings({ ...building, ...draft });
  const takeoff = constructionTakeoff({ ...building, ...draft });
  return <form className="form-stack site-controls" onSubmit={submit}>
    <div className="datum-note"><SquareDashed size={18} /><div><strong>Building-local datum</strong><p>Length runs south to north. The south end stays fixed when extending north. Window offsets measure to the nearest opening edge, not its center. Elevations are relative to a level floor datum, not surveyed coordinates.</p></div></div>
    <div className="site-controls-grid">
      <fieldset disabled={!canEdit}><legend>East-wall window</legend><label className="checkbox-label"><input type="checkbox" checked={draft.window.enabled} onChange={event => change('window', 'enabled', event.target.checked)} /> Include window reference</label><div className="form-grid">{field('window', 'width', 'Window width', 1, 20)}{field('window', 'height', 'Window height', 1, 12)}{field('window', 'sill', 'Window sill height', 0, 30)}{field('window', 'offset', 'Window near-edge offset', 0, 400)}</div><label>Measure offset from<select aria-label="Window offset origin" value={draft.window.offsetFrom} onChange={event => change('window', 'offsetFrom', event.target.value)}><option value="south">Southeast corner · toward north</option><option value="north">Northeast corner · toward south</option></select></label><p className="muted">One east-wall window reference is supported. Other walls, multiple windows, custom reinforcement, and fabrication details are not yet modeled.</p></fieldset>
      <fieldset disabled={!canEdit}><legend><Mountain size={16} /> Existing terrain profile</legend><div className="form-grid">{field('site', 'startElevation', 'Ground start elevation', -50, 50)}{field('site', 'endElevation', 'Ground end elevation', -50, 50)}{field('site', 'slopeStart', 'Slope start', 0, 95, '%')}</div><label>Travel direction<select aria-label="Terrain travel direction" value={draft.site.riseToward} onChange={event => change('site', 'riseToward', event.target.value)}><option value="north">South → north</option><option value="south">North → south</option></select></label><div className="terrain-profile-preview" aria-label="Terrain profile preview"><span>{draft.site.startElevation || 0} ft</span><div style={{ '--slope-start': `${draft.site.slopeStart || 0}%`, '--slope-rise': `${Math.min(35, Math.abs(Number(draft.site.endElevation) - Number(draft.site.startElevation)) * 5)}px` }} /><span>{draft.site.endElevation || 0} ft</span></div><p className="muted">The ground remains at its starting elevation until the chosen percentage, then changes linearly. A survey and geotechnical design are still required.</p></fieldset>
    </div>
    <fieldset className="construction-settings" disabled={!canEdit}><legend>Concrete floor</legend><label className="checkbox-label"><input type="checkbox" checked={draft.floor.enabled} onChange={event=>change('floor','enabled',event.target.checked)}/> Include concrete floor</label><div className="form-grid">{field('floor','thickness','Floor slab thickness',2,36,'in')}{field('floor','wastePercent','Floor concrete allowance',0,30,'%')}</div>{draft.floor.enabled&&<p className="muted">{floorTakeoff({...building,...draft}).netVolume.toFixed(3)} cu yd net · {floorTakeoff({...building,...draft}).orderVolume.toFixed(3)} cu yd with allowance. Thickness and allowance are draft inputs, not engineered recommendations.</p>}</fieldset>
    <fieldset className="construction-settings" disabled={!canEdit}>
      <legend>Wall & frame adaptation</legend>
      <div className="form-grid"><label>Below-grade wall treatment<select aria-label="Wall treatment" value={draft.construction.wallMode} onChange={event => { change('construction', 'wallMode', event.target.value); if (event.target.value === 'none') change('construction', 'columnMode', 'keep'); }}><option value="none">No wall adaptation</option><option value="concrete">Concrete wall · dimensional layout</option></select></label><label>Column base treatment<select aria-label="Column base treatment" value={draft.construction.columnMode} disabled={draft.construction.wallMode !== 'concrete'} onChange={event => change('construction', 'columnMode', event.target.value)}><option value="keep">Keep original column lengths</option><option value="wall-top">Start column legs at wall tops</option></select></label>{field('construction', 'floorElevation', 'Finished floor elevation', -50, 50)}{field('construction', 'wallThickness', 'Concrete wall thickness', 4, 36, 'in')}{field('construction', 'clearance', 'Wall clearance above grade', 0, 6)}<label>Fill material<select aria-label="Fill material" value={draft.construction.fillMaterial} onChange={event => change('construction', 'fillMaterial', event.target.value)}><option value="unspecified">Not specified · cost excluded</option><option value="stone">Stone fill</option><option value="engineered-fill">Engineered fill</option></select></label>{field('construction', 'fillFactor', 'Fill volume factor', 1, 2, '×')}</div>
      <p className="muted">Wall dimensions and support choices are your inputs, not structural recommendations. Concrete volume excludes footings and reinforcement. Net cut/fill covers the footprint only; the fill factor is your explicit allowance, not an inferred soil factor.</p>
      {takeoff.adapted && <div className="construction-live-summary"><span>Concrete<strong>{takeoff.concreteVolume.toFixed(3)} cu yd</strong></span><span>Excavation<strong>{takeoff.cutVolume.toFixed(2)} cu yd</strong></span><span>Net fill<strong>{takeoff.fillVolume.toFixed(2)} cu yd</strong></span><span>Column reduction<strong>{takeoff.columnReduction.toFixed(2)} ft</strong></span></div>}
    </fieldset>
    {warnings.map(warning => <div className="notice" key={warning}><ShieldCheck size={19} /><p>{warning}</p></div>)}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="site-controls-footer"><span>Changes update the same project model as typed requests.</span><button className="button primary" disabled={!canEdit}><Save size={15} /> Apply site & opening changes</button></div>
  </form>;
}