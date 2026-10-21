import { useState } from 'react';
import { Download, FileDown, Layers3, Ruler, ShieldCheck } from 'lucide-react';
import { buildingMetrics, constructionTakeoff, longitudinalMembers, designWarnings, floorTakeoff } from '../shared/model.js';
import { download, constructionCsv } from './files.js';

const number = value => new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(value);

export default function ConstructionReport({ building }) {
  const [section, setSection] = useState('columns');
  const takeoff = constructionTakeoff(building);
  const metrics = buildingMetrics(building);
  const members = longitudinalMembers(building);
  const floor=floorTakeoff(building);
  return <div className="construction-report">
    <div className="report-release-status"><ShieldCheck size={20} /><div><strong>Dimensional takeoff · not released for fabrication</strong><p>Lengths describe the generated layout. Sections, connections, reinforcement, footings, splices, kerf, stock optimization, and structural checks are not resolved by this schedule.</p></div></div>
    <div className="inventory-metrics report-metrics"><div><span>Concrete walls</span><strong>{number(takeoff.concreteVolume)}<small>net cu yd · no footings</small></strong></div><div><span>Column leg length</span><strong>{number(takeoff.columnLength)}<small>ft · {number(takeoff.columnReduction)} ft shorter than baseline</small></strong></div><div><span>Covering area</span><strong>{number(metrics.fabricArea)}<small>sq ft · includes 5% allowance</small></strong></div><div><span>Net cut / fill</span><strong>{number(takeoff.cutVolume)} / {number(takeoff.fillVolume)}<small>cu yd · footprint only</small></strong></div></div>
    <div className="report-actions"><span>{building.name} · floor datum {building.construction.floorElevation} ft</span><button className="button" onClick={() => download('construction-schedule.csv', constructionCsv(building), 'text/csv')}><Download size={14} /> Export schedule</button></div>
    {building.floor.enabled&&<div className="floor-report-summary"><strong>Concrete floor</strong><span>{building.floor.thickness} in draft slab</span><span>{number(floor.area)} sq ft</span><span>{number(floor.netVolume)} cu yd net</span><span>{number(floor.orderVolume)} cu yd incl. {building.floor.wastePercent}% allowance</span></div>}
    <div className="management-tabs" role="tablist" aria-label="Construction schedule"><button role="tab" aria-selected={section === 'columns'} className={section === 'columns' ? 'selected' : ''} onClick={() => setSection('columns')}><Ruler size={14} /> Column legs ({takeoff.columns.length})</button><button role="tab" aria-selected={section === 'members'} className={section === 'members' ? 'selected' : ''} onClick={() => setSection('members')}><Layers3 size={14} /> Purlins & girts ({members.length})</button><button role="tab" aria-selected={section === 'walls'} className={section === 'walls' ? 'selected' : ''} onClick={() => setSection('walls')}>Wall sections</button></div>
    <div className="table-scroll construction-schedule">
      {section === 'columns' && <table className="inventory-table"><thead><tr><th>MARK / SIDE</th><th>FROM SOUTH</th><th>BASE ABOVE FLOOR</th><th>NET LEG LENGTH</th><th>REDUCTION</th></tr></thead><tbody>{takeoff.columns.map(column => <tr key={column.mark}><td><strong>{column.mark}</strong><small>{column.side} · frame {column.frame}</small></td><td>{number(column.station)} ft</td><td>{number(column.base)} ft</td><td><strong>{number(column.length)} ft</strong></td><td>{number(column.reduction)} ft</td></tr>)}</tbody></table>}
      {section === 'members' && <table className="inventory-table"><thead><tr><th>MARK / TYPE</th><th>SIDE</th><th>START FROM SOUTH</th><th>END FROM SOUTH</th><th>NET LENGTH</th></tr></thead><tbody>{members.map(member => <tr key={member.mark}><td><strong>{member.mark}</strong><small>{member.type}</small></td><td>{member.side}</td><td>{number(member.start)} ft</td><td>{number(member.end)} ft</td><td><strong>{number(member.length)} ft</strong></td></tr>)}</tbody></table>}
      {section === 'walls' && <table className="inventory-table"><thead><tr><th>STATION FROM SOUTH</th><th>EXISTING GROUND</th><th>CONCRETE TOP</th><th>ABOVE-WALL HEIGHT</th></tr></thead><tbody>{takeoff.profile.map(point => <tr key={point.fraction}><td>{number(point.station)} ft</td><td>{number(point.ground)} ft</td><td>{number(point.wallTop)} ft</td><td>{number(building.height - point.wallTop)} ft</td></tr>)}</tbody></table>}
    </div>
    <p className="report-measurement-note">Wall end panels butt between side walls; concrete end width is building width minus one wall thickness. Covering deductions use the frame-axis envelope. Ground elevations are relative to the finished floor. Column lengths exclude base plates and connection allowances. Stock lengths are not selected and no unapproved splices are inferred.</p>
    {designWarnings(building).map(warning => <p className="report-warning" key={warning}>{warning}</p>)}
  </div>;
}