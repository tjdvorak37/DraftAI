import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultBuilding, buildingSchema, parseDesignCommand, floorTakeoff, billOfMaterials, designWarnings } from '../shared/model.js';
import { parseProject } from '../src/files.js';
import { componentGroup, componentPatch } from '../shared/components.js';

test('add a concrete floor creates a validated editable component with an explicit draft thickness', () => {
  const building = parseDesignCommand('add a concrete floor', defaultBuilding);
  assert.equal(building.floor.enabled, true);
  assert.equal(building.floor.thickness, 6);
  const quantities = floorTakeoff(building);
  assert.equal(quantities.area, 5760);
  assert.ok(Math.abs(quantities.netVolume - 106.6666666667) < 1e-7);
  assert.ok(Math.abs(quantities.orderVolume - 112) < 1e-9);
  const line = billOfMaterials(building, []).find(part => part.id === 'SL-014');
  assert.ok(Math.abs(line.quantity - 112) < 1e-9);
  assert.equal(line.price, null);
  assert.ok(designWarnings(building).some(warning => warning.includes('draft thickness')));
});

test('floor dimensions, removal, bounds, and old-project compatibility share one model', () => {
  const building = parseDesignCommand('add a 4 inch concrete floor with allowance 10%', defaultBuilding);
  assert.equal(building.floor.thickness, 4);
  assert.equal(building.floor.wastePercent, 10);
  assert.equal(parseDesignCommand('add a 4-inch concrete floor',defaultBuilding).floor.thickness,4);
  assert.equal(parseDesignCommand('add a 4 inch slab',defaultBuilding).floor.thickness,4);
  assert.equal(parseDesignCommand('remove floor',building).floor.enabled,false);
  assert.throws(()=>parseDesignCommand('concrete floor thickness -4 inches',defaultBuilding),/positive measurement/);
  assert.equal(parseDesignCommand('concrete floor thickness 8 inches', building).floor.thickness, 8);
  assert.equal(parseDesignCommand('remove the concrete floor', building).floor.enabled, false);
  assert.equal(buildingSchema.safeParse({ ...building, floor: { ...building.floor, thickness: 0 } }).success, false);
  assert.throws(() => parseDesignCommand('add a reinforced concrete floor', defaultBuilding), /reinforcement/i);
  assert.throws(() => parseDesignCommand('add a concrete floor 20 x 14', defaultBuilding), /full building footprint/);
  const { floor, ...legacy } = defaultBuilding;
  assert.equal(parseProject(JSON.stringify({ format: 'accusteel-draft', version: 1, building: legacy })).floor.enabled, false);
  assert.deepEqual(parseProject(JSON.stringify({ format: 'accusteel-draft', version: 1, building })), building);
});

test('selected components resolve to real editors and patch only their owned parameters',()=>{
  assert.equal(componentGroup('Concrete floor slab'),'floor');
  assert.equal(componentGroup('Floor datum · no concrete slab specified'),'floor');
  assert.equal(componentGroup('Galvanized arch frame'),'structure');
  assert.equal(componentGroup('Column base plate · proposed elevation 7.00 ft'),'structure');
  assert.equal(componentGroup('Custom end-wall door'),'door');
  assert.equal(componentGroup('East-wall window reference'),'window');
  assert.equal(componentGroup('Architectural fabric membrane'),'covering');
  assert.equal(componentGroup('Existing terrain · wall adaptation disabled'),'site');
  const patch=componentPatch('floor',{...defaultBuilding,floor:{enabled:true,thickness:4,wastePercent:10},construction:{...defaultBuilding.construction,floorElevation:2,wallThickness:36}},defaultBuilding);
  assert.equal(patch.floor.thickness,4);
  assert.equal(patch.construction.floorElevation,2);
  assert.equal(patch.construction.wallThickness,defaultBuilding.construction.wallThickness);
  assert.ok(!('width' in patch));
});