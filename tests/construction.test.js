import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultBuilding, buildingSchema, buildingMetrics, billOfMaterials, constructionTakeoff, sideWallPanels, longitudinalMembers, parseDesignCommand } from '../shared/model.js';
import { constructionCsv, parseProject } from '../src/files.js';
import { createApp } from '../server/index.js';
import { provisionInitialAdmin } from '../server/accounts.js';

const hillside = () => buildingSchema.parse({ ...defaultBuilding, site: { ...defaultBuilding.site, endElevation: 6 }, construction: { ...defaultBuilding.construction, wallMode: 'concrete', columnMode: 'wall-top' } });

test('terrain produces concrete walls, matching column reductions, and revised covering quantities', () => {
  const building = hillside();
  const result = constructionTakeoff(building);
  assert.equal(result.maxWallHeight, 7);
  assert.equal(result.replacementArea, 940);
  assert.ok(Math.abs(result.concreteVolume - ((480 + (60 - 8 / 12) * 8 - 20) * (8 / 12) / 27)) < 1e-8);
  assert.equal(result.cutVolume, 320);
  assert.equal(result.fillVolume, 0);
  assert.equal(result.columns.length, 18);
  assert.equal(result.columns[0].length, 15);
  assert.equal(result.columns.at(-1).length, 9);
  assert.equal(result.columnReduction, 48);
  assert.ok(buildingMetrics(building).fabricArea < buildingMetrics(defaultBuilding).fabricArea);
  const materials = billOfMaterials(building);
  assert.equal(materials.find(part => part.id === 'FR-008').quantity, 9);
  assert.equal(materials.find(part => part.id === 'FR-008').price, null);
  assert.ok(!materials.some(part => part.id === 'FR-001'));
  assert.equal(materials.find(part => part.id === 'EX-010').quantity, 320);
  const panelArea = sideWallPanels(building).reduce((sum, panel) => sum + (panel.end - panel.start) * (panel.top - (panel.bottomStart + panel.bottomEnd) / 2), 0);
  assert.equal(panelArea, 2 * building.length * building.height - 480);
  assert.equal(longitudinalMembers(building).reduce((sum, member) => sum + member.length, 0), 1392);
  assert.equal(materials.find(part => part.id === 'LM-013').quantity, 1392);
});

test('floor level and explicit fill allowance drive quantities without inventing material costs', () => {
  const building = buildingSchema.parse({ ...hillside(), construction: { ...hillside().construction, floorElevation: 6, fillMaterial: 'stone', fillFactor: 1.15 } });
  const result = constructionTakeoff(building);
  assert.equal(result.cutVolume, 0);
  assert.equal(result.fillVolume, 960);
  assert.ok(Math.abs(result.orderedFillVolume - 1104) < 1e-8);
  assert.equal(billOfMaterials(building).find(part => part.id === 'ST-011').price, null);
});

test('keeping original columns does not claim steel savings and invalid intersections are blocked', () => {
  const building = buildingSchema.parse({ ...hillside(), construction: { ...hillside().construction, columnMode: 'keep' } });
  assert.equal(constructionTakeoff(building).columnReduction, 0);
  assert.ok(billOfMaterials(building).some(part => part.id === 'FR-001'));
  assert.equal(buildingSchema.safeParse({ ...hillside(), site: { ...hillside().site, endElevation: 20 } }).success, false);
  assert.equal(buildingSchema.safeParse({ ...hillside(), site: { ...hillside().site, riseToward: 'south' } }).success, false);
  assert.equal(buildingSchema.safeParse({ ...hillside(), window: { ...defaultBuilding.window, enabled: true, offset: 0, offsetFrom: 'north', sill: 2 } }).success, false);
});

test('zero crossing integration is exact and end walls respect enclosure and door deductions', () => {
  const building = buildingSchema.parse({ ...hillside(), endWalls: false, site: { ...hillside().site, startElevation: -2, endElevation: 6, slopeStart: 0 } });
  const result = constructionTakeoff(building);
  assert.equal(result.cutVolume, 480);
  assert.ok(Math.abs(result.fillVolume - 160 / 3) < 1e-8);
  assert.equal(result.replacementArea, 588);
  assert.ok(Math.abs(result.concreteVolume - 588 * (8 / 12) / 27) < 1e-8);
});

test('manual and typed adaptation parameters share the model and survive project export', () => {
  const changed = parseDesignCommand('Use concrete walls, wall thickness 8 inches, wall clearance 1 ft above grade, and start the columns at wall tops', { ...defaultBuilding, site: { ...defaultBuilding.site, endElevation: 6 } });
  assert.equal(changed.construction.wallMode, 'concrete');
  assert.equal(changed.construction.wallThickness, 8);
  assert.equal(changed.construction.columnMode, 'wall-top');
  assert.equal(constructionTakeoff(changed).columnReduction, 48);
  const filled = parseDesignCommand('Set finished floor elevation to 6 ft and use stone fill with fill factor 1.15', changed);
  assert.ok(Math.abs(constructionTakeoff(filled).orderedFillVolume - 1104) < 1e-8);
  assert.throws(() => parseDesignCommand('Use concrete walls and design the foundations', defaultBuilding), /not available/);
  assert.deepEqual(parseProject(JSON.stringify({ format: 'accusteel-draft', version: 1, building: changed })), changed);
  assert.ok(constructionCsv(changed).includes('NOT RELEASED FOR FABRICATION'));
  assert.ok(constructionCsv(changed).includes('"C09-W"'));
  assert.ok(constructionCsv(changed).includes('"C09-W","Column leg - geometry only","West","96","96","7","16","9","7"'));
});

test('window geometry and the scheduled girts agree about removed opening lengths', () => {
  const building = buildingSchema.parse({ ...hillside(), window: { ...defaultBuilding.window, enabled: true } });
  const members = longitudinalMembers(building);
  assert.equal(members.reduce((sum, member) => sum + member.length, 0), 1388);
  assert.ok(!members.some(member => member.type === 'Side girt' && member.side === 'East' && member.elevation === 9 && member.start < 24 && member.end > 20));
  const panelArea = sideWallPanels(building).reduce((sum, panel) => sum + (panel.end - panel.start) * (panel.top - (panel.bottomStart + panel.bottomEnd) / 2), 0);
  assert.equal(panelArea, 2 * building.length * building.height - 480 - 12);
  const uneven = buildingSchema.parse({ ...hillside(), length: 100 });
  const crossing = longitudinalMembers(uneven).filter(member => member.type === 'Side girt' && member.side === 'East' && member.elevation === 9 && member.start < 50 && member.end > 50);
  assert.equal(crossing.length, 1);
  assert.ok(Math.abs(crossing[0].length - 100 / 9) < 1e-8);
});

test('construction parameters persist in projects and cubic-yard prices update the live takeoff', async () => {
  const { app, db } = createApp({ databasePath: ':memory:' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  let cookie = '';
  async function request(path, body) {
    const response = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0], data: await response.json() };
  }
  try {
    await provisionInitialAdmin(db, { name: 'Construction Tester', email: 'construction@example.test', password: 'isolated-construction-password' });
    const account = await request('/auth/login', { email: 'construction@example.test', password: 'isolated-construction-password' });
    assert.equal(account.status, 200);
    cookie = account.cookie;
    const saved = await request('/projects', { building: hillside() });
    assert.equal(saved.status, 200);
    const projects = (await request('/projects')).data;
    const restored = buildingSchema.parse(projects[0].building);
    assert.equal(constructionTakeoff(restored).columnReduction, 48);
    const inventory = (await request('/inventory')).data;
    const concrete = inventory.find(item => item.id === 'CW-009');
    assert.equal((await request('/inventory', { ...concrete, price: 185.75 })).status, 200);
    const updatedInventory = (await request('/inventory')).data;
    const line = billOfMaterials(restored, updatedInventory).find(item => item.id === 'CW-009');
    assert.equal(line.unit, 'cu yd');
    assert.equal(line.price, 185.75);
    assert.ok(Math.abs(line.total - constructionTakeoff(restored).concreteVolume * 185.75) < 1e-8);
    assert.equal((await request('/inventory', { ...concrete, unit: '' })).status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); db.close(); }
});