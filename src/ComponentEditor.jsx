import { useState } from 'react';
import { Box, Save, ShieldCheck } from 'lucide-react';
import { buildingSchema, buildingMetrics, floorTakeoff } from '../shared/model.js';
import { componentGroup, componentPatch } from '../shared/components.js';
import SiteControls from './SiteControls.jsx';

export function ComponentBrowser({building,onChoose}){
  const items=[['Building frame',`${building.width} × ${building.length} ft · ${building.height} ft eave`],['Fabric covering',`${building.fabric} · ${building.endWalls?'enclosed ends':'open ends'}`],['Garage door',`${building.doorWidth} × ${building.doorHeight} ft`],['East-wall window',building.window.enabled?`${building.window.width} × ${building.window.height} ft`:'Not included'],['Concrete floor slab',building.floor.enabled?`${building.floor.thickness} in · ${building.floor.wastePercent}% allowance`:'Not included'],['Terrain & concrete walls',building.construction.wallMode==='concrete'?'Concrete wall adaptation':'Terrain reference']];
  return <div className="component-browser">{items.map(([label,description])=><button key={label} aria-label={`Edit ${label}`} onClick={()=>onChoose(label)}><Box size={21}/><span><strong>{label}</strong><small>{description}</small></span><span className="component-edit-label">Properties</span></button>)}</div>;
}

export default function ComponentEditor({ label, building, canEdit, onSave }) {
  const group = componentGroup(label);
  const [draft,setDraft] = useState(()=>structuredClone(building));
  const [error,setError] = useState('');
  function change(field,value) { setDraft(current=>({...current,[field]:value}));setError(''); }
  function nested(field,key,value) { change(field,{...draft[field],[key]:value}); }
  function numeric(field,title,min,max,unit='ft') { return <label>{title} ({unit})<input aria-label={`Component ${title}`} type="number" min={min} max={max} step="any" required disabled={!canEdit} value={draft[field]} onChange={event=>change(field,event.target.value===''?'':Number(event.target.value))}/></label>; }
  function nestedNumber(field,key,title,min,max,unit='ft') { return <label>{title} ({unit})<input aria-label={`Component ${title}`} type="number" min={min} max={max} step="any" required disabled={!canEdit} value={draft[field][key]} onChange={event=>nested(field,key,event.target.value===''?'':Number(event.target.value))}/></label>; }
  function toggle(field,title) { return <label className="checkbox-label"><input type="checkbox" disabled={!canEdit} checked={draft[field]} onChange={event=>change(field,event.target.checked)}/>{title}</label>; }
  function submit(event) {
    event.preventDefault();
    const patch=componentPatch(group,draft,building);
    const validated=buildingSchema.safeParse({...building,...patch});
    if(!validated.success){setError(validated.error.issues[0].message);return;}
    onSave(patch);
  }
  if(group==='site') return <SiteControls building={building} canEdit={canEdit} onSave={onSave}/>;
  if(group==='reference') return <div className="form-stack"><p className="muted">Imported DXF is reference geometry, not an editable building assembly. Edit its source CAD geometry and reimport, or change the modeled building using its own components.</p></div>;
  const floor=floorTakeoff(draft);
  const metrics=buildingMetrics(building);
  return <form className="form-stack component-editor" onSubmit={submit}>
    <div className="component-identity"><Box size={22}/><div><strong>{label||'Building'}</strong><span>{group==='structure'?'Scope: shared frame system and building dimensions':group==='covering'?'Scope: building covering and enclosure':group==='floor'?'Scope: full-footprint concrete floor':'Scope: parametric building component'}</span></div></div>
    {(group==='structure'||group==='building')&&<><div className="form-grid">{numeric('width','Width',20,160)}{numeric('length','Length',24,400)}{numeric('height','Eave height',8,32)}{numeric('baySpacing','Bay spacing',6,24)}</div><label>Roof profile<select aria-label="Component roof profile" disabled={!canEdit} value={draft.roof} onChange={event=>change('roof',event.target.value)}><option value="arch">Arched</option><option value="gable">Gable</option></select></label><p className="component-scope-note">{metrics.frames} primary frames in the current model. These edits affect the shared assembly; independent member positions, sections, connection plates, and bolt patterns are not modeled yet.</p></>}
    {(group==='covering'||group==='building')&&<><label>Fabric color<select aria-label="Component fabric color" disabled={!canEdit} value={draft.fabric} onChange={event=>change('fabric',event.target.value)}>{['ivory','white','green','gray'].map(color=><option key={color}>{color}</option>)}</select></label>{toggle('endWalls','Enclose end walls')}</>}
    {group==='door'&&<>{toggle('endWalls','Enclose end walls')}<div className="form-grid">{numeric('doorWidth','Door width',0,40)}{numeric('doorHeight','Door height',0,28)}</div><p className="component-scope-note">Front/south opening. Set both dimensions to zero to remove it. Door mechanism and connection engineering remain unspecified.</p></>}
    {group==='window'&&<><label className="checkbox-label"><input type="checkbox" disabled={!canEdit} checked={draft.window.enabled} onChange={event=>nested('window','enabled',event.target.checked)}/> Include east-wall window</label><div className="form-grid">{nestedNumber('window','width','Window width',1,20)}{nestedNumber('window','height','Window height',1,12)}{nestedNumber('window','sill','Window sill height',0,30)}{nestedNumber('window','offset','Window near-edge offset',0,400)}</div><label>Offset origin<select aria-label="Component window origin" disabled={!canEdit} value={draft.window.offsetFrom} onChange={event=>nested('window','offsetFrom',event.target.value)}><option value="south">Southeast corner</option><option value="north">Northeast corner</option></select></label></>}
    {group==='floor'&&<><label className="checkbox-label"><input type="checkbox" disabled={!canEdit} checked={draft.floor.enabled} onChange={event=>nested('floor','enabled',event.target.checked)}/> Include concrete floor</label><div className="form-grid">{nestedNumber('floor','thickness','Slab thickness',2,36,'in')}{nestedNumber('floor','wastePercent','Concrete allowance',0,30,'%')}{nestedNumber('construction','floorElevation','Finished floor elevation',-50,50)}</div><div className="floor-quantities"><div><span>Footprint</span><strong>{building.width} × {building.length} ft</strong></div><div><span>Net concrete</span><strong>{floor.netVolume.toFixed(3)} cu yd</strong></div><div><span>With allowance</span><strong>{floor.orderVolume.toFixed(3)} cu yd</strong></div></div><div className="notice"><ShieldCheck size={18}/><p>Thickness is a draft input, not a recommendation. Reinforcement, joints, subbase, vapor barrier, load capacity, slab excavation, and engineering approval remain unresolved.</p></div></>}
    {!canEdit&&<p className="form-note">Your role has read-only design access.</p>}
    {error&&<p className="form-error" role="alert">{error}</p>}
    <button className="button primary" disabled={!canEdit}><Save size={15}/> Apply component changes</button>
  </form>;
}