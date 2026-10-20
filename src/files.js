import DxfParser from 'dxf-parser';
import { buildingSchema, constructionTakeoff, longitudinalMembers, buildingMetrics } from '../shared/model.js';

export function download(name, content, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function parseProject(text) {
  const data = JSON.parse(text);
  if (data.format !== 'accusteel-draft' || data.version !== 1) throw new Error('Choose a Draft Studio project file (version 1).');
  return buildingSchema.parse(data.building);
}

export function parseDxf(text, name, units = 'feet') {
  const document = new DxfParser().parseSync(text);
  const declaredUnits = document.header?.$INSUNITS;
  const factors = { 1: 1 / 12, 2: 1, 4: 1 / 304.8, 5: 1 / 30.48, 6: 1 / 0.3048 };
  const manualFactors = { feet: 1, inches: 1 / 12, millimeters: 1 / 304.8, meters: 1 / 0.3048 };
  const factor = factors[declaredUnits] || manualFactors[units];
  if (!factor) throw new Error('Select the source drawing units.');
  const segments = [];
  let unsupported = 0;
  const add = (start, end) => {
    if (segments.length >= 50000) throw new Error('Drawing is too large for the reference viewer. Limit it to 50,000 segments.');
    if (![start.x, start.y, end.x, end.y].every(Number.isFinite)) return;
    segments.push([[start.x * factor, start.y * factor], [end.x * factor, end.y * factor]]);
  };
  for (const entity of document.entities || []) {
    if (['LINE', 'LWPOLYLINE', 'POLYLINE'].includes(entity.type)) {
      const vertices = entity.vertices || [];
      if (vertices.some(vertex => vertex.bulge)) { unsupported++; continue; }
      for (let index = 1; index < vertices.length; index++) add(vertices[index - 1], vertices[index]);
      if (entity.shape && vertices.length > 2) add(vertices.at(-1), vertices[0]);
    } else if (['CIRCLE', 'ARC'].includes(entity.type)) {
      const start = entity.type === 'CIRCLE' ? 0 : entity.startAngle;
      let end = entity.type === 'CIRCLE' ? Math.PI * 2 : entity.endAngle;
      if (end < start) end += Math.PI * 2;
      for (let index = 0; index < 64; index++) {
        const point = angle => ({ x: entity.center.x + Math.cos(angle) * entity.radius, y: entity.center.y + Math.sin(angle) * entity.radius });
        add(point(start + (end - start) * index / 64), point(start + (end - start) * (index + 1) / 64));
      }
    } else unsupported++;
  }
  if (!segments.length) throw new Error('No supported reference geometry found. Export lines, straight polylines, circles, or arcs as ASCII DXF. Blocks, text, dimensions, and solids are not converted.');
  const minX = Math.min(...segments.flatMap(segment => segment.map(point => point[0])));
  const maxX = Math.max(...segments.flatMap(segment => segment.map(point => point[0])));
  const minY = Math.min(...segments.flatMap(segment => segment.map(point => point[1])));
  const maxY = Math.max(...segments.flatMap(segment => segment.map(point => point[1])));
  for (const segment of segments) for (const point of segment) { point[0] -= (minX + maxX) / 2; point[1] -= (minY + maxY) / 2; }
  return { name, segments, unsupported, units: factors[declaredUnits] ? 'DXF-declared units' : units, width: maxX - minX, length: maxY - minY };
}

export function exportDxf(building) {
  const lines = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '2', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'];
  const line = (start, end, layer) => lines.push('0', 'LINE', '8', layer, '10', String(start[0]), '20', String(start[1]), '30', '0', '11', String(end[0]), '21', String(end[1]), '31', '0');
  line([0, 0], [building.width, 0], 'FOOTPRINT');
  line([building.width, 0], [building.width, building.length], 'FOOTPRINT');
  line([building.width, building.length], [0, building.length], 'FOOTPRINT');
  line([0, building.length], [0, 0], 'FOOTPRINT');
  const bays = Math.ceil(building.length / building.baySpacing);
  for (let bay = 1; bay < bays; bay++) line([0, building.length * bay / bays], [building.width, building.length * bay / bays], 'FRAMES');
  lines.push('0', 'ENDSEC', '0', 'EOF');
  return lines.join('\n');
}

export function materialsCsv(materials) {
  const escape = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return [['Part ID', 'Description', 'Quantity', 'Unit', 'Unit cost USD', 'Extended cost USD'], ...materials.map(part => [part.id, part.name, part.quantity, part.unit, part.price, part.total])].map(row => row.map(escape).join(',')).join('\r\n');
}

export function constructionCsv(building) {
  const takeoff = constructionTakeoff(building);
  const escape = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const rows = [
    ['Project', building.name],
    ['Status', 'DIMENSIONAL TAKEOFF ONLY - NOT RELEASED FOR FABRICATION'],
    ['Excluded', 'Structural sizing, connections, reinforcement, footings, stock/kerf/splice optimization, and engineering approval'],
    ['Floor elevation ft', building.construction.floorElevation],
    ['Wall thickness in', building.construction.wallThickness],
    ['Concrete cu yd', takeoff.concreteVolume], ['Excavation cu yd', takeoff.cutVolume],
    ['Net fill cu yd', takeoff.fillVolume], ['Fill factor', building.construction.fillFactor],
    ['Ordered fill allowance cu yd', takeoff.orderedFillVolume], ['Fill material', building.construction.fillMaterial],
    ['Covering sq ft incl 5% allowance', buildingMetrics(building).fabricArea],
    [], ['Mark', 'Member', 'Side', 'Start from south ft', 'End from south ft', 'Base above floor ft', 'Top above floor ft', 'Net length ft', 'Reduction ft'],
    ...takeoff.columns.map(column => [column.mark, 'Column leg - geometry only', column.side, column.station, column.station, column.base, column.top, column.length, column.reduction]),
    ...longitudinalMembers(building).map(member => [member.mark, member.type, member.side, member.start, member.end, '', '', member.length, '']),
    [], ['Station from south ft', 'Existing ground above floor ft', 'Wall top above floor ft'],
    ...takeoff.profile.map(point => [point.station, point.ground, point.wallTop]),
  ];
  return rows.map(row => row.map(escape).join(',')).join('\r\n');
}