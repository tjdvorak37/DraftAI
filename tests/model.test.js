import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultBuilding, buildingMetrics, billOfMaterials, parseDesignCommand, buildingSchema, siteElevationAt, designWarnings } from '../shared/model.js';

test('length and bay spacing determine frames and base hardware consistently', () => {
  const model = { ...defaultBuilding, length: 100, baySpacing: 12 };
  const metrics = buildingMetrics(model);
  assert.equal(metrics.bays, 9);
  assert.equal(metrics.frames, 10);
  assert.equal(metrics.actualBay * metrics.bays, 100);
  const materials = billOfMaterials(model);
  assert.equal(materials.find(part => part.id === 'FR-001').quantity, 10);
  assert.equal(materials.find(part => part.id === 'AB-005').quantity, 20);
  assert.equal(materials.find(part => part.id === 'DR-007').total, null);
});

test('plain language changes validate dimensions and update the same model', () => {
  const changed = parseDesignCommand('Make it 80 ft wide and 120 ft long with 10 ft bays and green fabric', defaultBuilding);
  assert.equal(changed.width, 80);
  assert.equal(changed.length, 120);
  assert.equal(changed.baySpacing, 10);
  assert.equal(changed.fabric, 'green');
  assert.equal(buildingMetrics(changed).frames, 13);
  assert.throws(() => parseDesignCommand('width 900', defaultBuilding));
  assert.throws(() => parseDesignCommand('engineer a foundation', defaultBuilding));
});

test('door dimensions and invalid imports cannot bypass model validation', () => {
  assert.equal(buildingSchema.safeParse({ ...defaultBuilding, doorHeight: 25 }).success, false);
  assert.equal(buildingSchema.safeParse({ ...defaultBuilding, width: '60' }).success, false);
  assert.equal(buildingSchema.safeParse({ ...defaultBuilding, doorWidth: 0 }).success, false);
  assert.equal(parseDesignCommand('Add a 24 x 14 overhead door', defaultBuilding).doorWidth, 24);
});

test('open end walls reduce fabric and remove the door line item', () => {
  const open = { ...defaultBuilding, endWalls: false };
  assert.ok(buildingMetrics(open).fabricArea < buildingMetrics(defaultBuilding).fabricArea);
  assert.ok(!billOfMaterials(open).some(part => part.id === 'DR-007'));
});

test('an empty live inventory cannot silently substitute sample costs', () => {
  assert.ok(billOfMaterials(defaultBuilding, []).every(part => part.price === null && part.total === null));
});

test('door commands support words, abbreviations, feet-and-inches, and context without guessing', () => {
  for (const request of ['I need the garage door to be 20 feet by 14 feet', "Set the garage door to 20' x 14'", 'door 20ft x 14ft']) {
    const result = parseDesignCommand(request, defaultBuilding);
    assert.equal(result.doorWidth, 20);
    assert.equal(result.doorHeight, 14);
    assert.equal(result.height, defaultBuilding.height);
  }
  assert.equal(parseDesignCommand('garage door 20\' 6" x 14\' 3"', defaultBuilding).doorWidth, 20.5);
  assert.throws(() => parseDesignCommand("20' x 14'", defaultBuilding), /Does that size refer/);
  assert.equal(parseDesignCommand("20' x 14'", defaultBuilding, 'door').doorWidth, 20);
});

test('relative height and anchored north extensions preserve other parameters', () => {
  assert.equal(parseDesignCommand('The height of the building needs raised 2 foot', defaultBuilding).height, 18);
  assert.equal(parseDesignCommand('Raise the building height by 2 ft', defaultBuilding).height, 18);
  assert.equal(parseDesignCommand('Lower the building height by 1 foot', defaultBuilding).height, 15);
  assert.equal(parseDesignCommand('Add 5 feet to the north end of the building', defaultBuilding).length, 101);
  assert.throws(() => parseDesignCommand('I need to have 5 feet to the north end of the building', defaultBuilding), /setback/);
});

test('ambiguous corner placements and grade requests never silently apply partial edits', () => {
  assert.throws(() => parseDesignCommand('Raise the building height 2 ft and relocate the window to 20 feet of the south east corner', defaultBuilding), /Which wall/);
  const window = parseDesignCommand('Move the window on the east wall, near edge 20 ft from the southeast corner', defaultBuilding);
  assert.equal(window.window.enabled, true);
  assert.equal(window.window.offset, 20);
  assert.equal(window.window.offsetFrom, 'south');
  assert.throws(() => parseDesignCommand('The height of the building needs raised 2 foot and the grade increases from 0 to 6 feet starting at the halfway mark', defaultBuilding), /What direction/);
  const graded = parseDesignCommand('Raise the building height 2 foot and grade rises from 0 to 6 feet toward north, starting halfway. Accommodate stone and steel.', defaultBuilding);
  assert.equal(graded.height, 18);
  assert.equal(graded.site.endElevation, 6);
  assert.equal(siteElevationAt(graded, 0), 0);
  assert.equal(siteElevationAt(graded, 0.5), 0);
  assert.equal(siteElevationAt(graded, 1), 6);
  assert.equal(siteElevationAt(graded, 0.75), 3);
  assert.ok(designWarnings(graded)[0].includes('uncalculated'));
});