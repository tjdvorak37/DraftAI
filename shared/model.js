import { z } from 'zod';
import { parseDesignChanges } from './designCommands.js';
import { defaultConstruction, constructionTakeoff, groundElevation, wallTopAt, longitudinalMembers } from './construction.js';
export { defaultConstruction, constructionTakeoff, wallTopAt, sideWallPanels, longitudinalMembers } from './construction.js';

export const defaultWindow = { enabled: false, width: 4, height: 3, sill: 8, offset: 20, offsetFrom: 'south' };
export const defaultSite = { startElevation: 0, endElevation: 0, slopeStart: 50, riseToward: 'north' };

export const buildingSchema = z.object({
  name: z.string().trim().min(1).max(100),
  width: z.number().min(20).max(160),
  length: z.number().min(24).max(400),
  height: z.number().min(8).max(32),
  baySpacing: z.number().min(6).max(24),
  roof: z.enum(['arch', 'gable']),
  fabric: z.enum(['ivory', 'white', 'green', 'gray']),
  endWalls: z.boolean(),
  doorWidth: z.number().min(0).max(40),
  doorHeight: z.number().min(0).max(28),
  window: z.object({ enabled: z.boolean(), width: z.number().min(1).max(20), height: z.number().min(1).max(12), sill: z.number().min(0).max(30), offset: z.number().min(0).max(400), offsetFrom: z.enum(['south', 'north']) }).default(defaultWindow),
  site: z.object({ startElevation: z.number().min(-50).max(50), endElevation: z.number().min(-50).max(50), slopeStart: z.number().min(0).max(95), riseToward: z.enum(['north', 'south']) }).default(defaultSite),
  construction: z.object({ wallMode: z.enum(['none', 'concrete']), wallThickness: z.number().min(4).max(36), clearance: z.number().min(0).max(6), floorElevation: z.number().min(-50).max(50), columnMode: z.enum(['keep', 'wall-top']), fillMaterial: z.enum(['unspecified', 'stone', 'engineered-fill']), fillFactor: z.number().min(1).max(2) }).default(defaultConstruction),
}).superRefine((building, context) => {
  if (building.doorWidth > building.width - 4) context.addIssue({ code: 'custom', message: 'Door must leave at least 2 ft on each side.', path: ['doorWidth'] });
  if (building.doorHeight > building.height) context.addIssue({ code: 'custom', message: 'Door height cannot exceed the eave height.', path: ['doorHeight'] });
  if ((building.doorWidth === 0) !== (building.doorHeight === 0)) context.addIssue({ code: 'custom', message: 'Set both door dimensions to zero to remove the door.', path: ['doorWidth'] });
  if (building.window.enabled && building.window.offset + building.window.width > building.length) context.addIssue({ code: 'custom', message: 'The window must fit within the east wall at the specified near-edge offset.', path: ['window'] });
  if (building.window.enabled && building.window.sill + building.window.height > building.height) context.addIssue({ code: 'custom', message: 'Window sill plus height cannot exceed the eave height.', path: ['window'] });
  const takeoff = constructionTakeoff(building);
  if (takeoff.maxWallHeight >= building.height - 1) context.addIssue({ code: 'custom', message: 'Concrete wall tops must remain at least 1 ft below the eave. Change the floor elevation, terrain, or wall clearance.', path: ['construction'] });
  if (takeoff.adapted && building.endWalls && building.doorWidth > 0 && takeoff.profile[0].ground > 0.01) context.addIssue({ code: 'custom', message: 'The south/front door intersects existing ground. Raise the finished floor or revise the proposed site profile before generating this layout.', path: ['construction'] });
  if (takeoff.adapted && building.window.enabled) {
    const start = building.window.offsetFrom === 'south' ? building.window.offset / building.length : 1 - (building.window.offset + building.window.width) / building.length;
    const end = start + building.window.width / building.length;
    if (Math.max(wallTopAt(building, start), wallTopAt(building, end)) > building.window.sill) context.addIssue({ code: 'custom', message: 'The concrete wall intersects the window. Raise the sill or move the opening.', path: ['window'] });
  }
});

export const defaultBuilding = {
  name: 'Equipment storage', width: 60, length: 96, height: 16,
  baySpacing: 12, roof: 'arch', fabric: 'ivory', endWalls: true,
  doorWidth: 20, doorHeight: 14,
  window: { ...defaultWindow }, site: { ...defaultSite },
  construction: { ...defaultConstruction },
};

export const initialInventory = [
  { id: 'FR-001', name: 'Galvanized arch frame', category: 'Structural', unit: 'ea', stock: 34, price: 1180, reorder: 10 },
  { id: 'PU-002', name: 'Galvanized purlin · 12 ft', category: 'Structural', unit: 'ea', stock: 280, price: 42.5, reorder: 80 },
  { id: 'FB-003', name: 'Architectural fabric membrane', category: 'Covering', unit: 'sq ft', stock: 24000, price: 2.85, reorder: 5000 },
  { id: 'BP-004', name: 'Column base plate', category: 'Hardware', unit: 'ea', stock: 96, price: 68, reorder: 24 },
  { id: 'AB-005', name: 'Anchor bolt kit', category: 'Hardware', unit: 'kit', stock: 64, price: 32, reorder: 20 },
  { id: 'CB-006', name: 'Cross-bracing cable kit', category: 'Structural', unit: 'kit', stock: 12, price: 145, reorder: 16 },
  { id: 'DR-007', name: 'Custom end-wall door', category: 'Custom', unit: 'ea', stock: 0, price: null, reorder: 0 },
  { id: 'FR-008', name: 'Custom wall-supported frame assembly', category: 'Custom', unit: 'ea', stock: 0, price: null, reorder: 0 },
  { id: 'CW-009', name: 'Concrete wall · net geometric volume', category: 'Custom', unit: 'cu yd', stock: 0, price: null, reorder: 0 },
  { id: 'EX-010', name: 'Excavation · footprint volume only', category: 'Custom', unit: 'cu yd', stock: 0, price: null, reorder: 0 },
  { id: 'ST-011', name: 'Stone fill · user-specified allowance', category: 'Custom', unit: 'cu yd', stock: 0, price: null, reorder: 0 },
  { id: 'EF-012', name: 'Engineered fill · user-specified allowance', category: 'Custom', unit: 'cu yd', stock: 0, price: null, reorder: 0 },
  { id: 'LM-013', name: 'Custom longitudinal steel · scheduled length', category: 'Custom', unit: 'ft', stock: 0, price: null, reorder: 0 },
];

export function roofRise(building) { return building.width * (building.roof === 'arch' ? 0.24 : 0.22); }

export function roofHeightAt(building, horizontal) {
  const ratio = horizontal / (building.width / 2);
  return building.height + roofRise(building) * (building.roof === 'arch' ? Math.sqrt(Math.max(0, 1 - ratio * ratio)) : 1 - Math.abs(ratio));
}

export function buildingMetrics(building) {
  const bays = Math.ceil(building.length / building.baySpacing);
  let roofArc = 0;
  for (let step = 1; step <= 80; step++) {
    const previous = -building.width / 2 + building.width * (step - 1) / 80;
    const current = -building.width / 2 + building.width * step / 80;
    roofArc += Math.hypot(current - previous, roofHeightAt(building, current) - roofHeightAt(building, previous));
  }
  const roofEndArea = building.roof === 'arch' ? Math.PI * building.width / 2 * roofRise(building) / 2 : building.width * roofRise(building) / 2;
  const endArea = building.endWalls ? 2 * (building.width * building.height + roofEndArea) - building.doorWidth * building.doorHeight : 0;
  const takeoff = constructionTakeoff(building);
  const windowArea = building.window.enabled ? building.window.width * building.window.height : 0;
  const fabricArea = Math.ceil((roofArc * building.length + 2 * building.height * building.length + endArea - takeoff.replacementArea - windowArea) * 1.05);
  return { bays, frames: bays + 1, actualBay: building.length / bays, area: building.width * building.length, ridge: building.height + roofRise(building), fabricArea };
}

export function billOfMaterials(building, inventory = initialInventory) {
  const metrics = buildingMetrics(building);
  const takeoff = constructionTakeoff(building);
  const customFrames = takeoff.columnReduction > 0;
  const quantities = [customFrames ? 0 : metrics.frames, takeoff.adapted ? 0 : metrics.bays * 10, metrics.fabricArea, metrics.frames * 2, metrics.frames * 2, Math.max(4, Math.ceil(metrics.bays / 3) * 2), building.endWalls && building.doorWidth > 0 ? 1 : 0, customFrames ? metrics.frames : 0, takeoff.concreteVolume, takeoff.adapted ? takeoff.cutVolume : 0, takeoff.adapted && building.construction.fillMaterial === 'stone' ? takeoff.orderedFillVolume : 0, takeoff.adapted && building.construction.fillMaterial === 'engineered-fill' ? takeoff.orderedFillVolume : 0, takeoff.adapted ? longitudinalMembers(building).reduce((sum, member) => sum + member.length, 0) : 0];
  return initialInventory.map((part, index) => {
    const current = inventory.find(item => item.id === part.id) || { ...part, price: null, stock: 0 };
    return { ...current, quantity: quantities[index], total: current.price == null ? null : quantities[index] * current.price };
  }).filter(part => part.quantity > 0);
}

export function parseDesignCommand(text, building, context = null) {
  const validated = buildingSchema.parse(building);
  return buildingSchema.parse({ ...validated, ...parseDesignChanges(text, validated, context) });
}

export function siteElevationAt(building, fractionFromSouth) {
  return groundElevation(building.site, fractionFromSouth);
}

export function designWarnings(building) {
  const warnings = [];
  if (building.construction.wallMode === 'concrete') {
    warnings.push('Wall volumes, covering reductions, and column lengths are geometric takeoffs, not a structural design. Footings, reinforcement, retaining capacity, drainage, waterproofing, connections, and steel member sizing remain uncalculated. Do not fabricate or construct before engineering release.');
    if (constructionTakeoff(building).fillVolume > 0 && building.construction.fillMaterial === 'unspecified') warnings.push('Fill is required by the floor/ground profile but no fill material is selected. Fill cost is excluded until you choose a material and unit price.');
  } else if (building.site.startElevation !== 0 || building.site.endElevation !== 0) warnings.push('Terrain has not been adapted to the walls. Enable concrete wall adaptation to calculate geometric wall, column, covering, and cut/fill quantities. Foundations and structural sizing remain uncalculated.');
  if (building.window.enabled) warnings.push('Window area and interrupted girt lengths are deducted from the layout. Headers, reinforcement, connections, membrane detailing, and window procurement remain unresolved and are not included in this takeoff.');
  return warnings;
}