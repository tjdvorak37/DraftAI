import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProject, parseDxf, exportDxf, materialsCsv } from '../src/files.js';
import { defaultBuilding, billOfMaterials } from '../shared/model.js';

test('project and ASCII DXF exports round-trip with explicit units', () => {
  assert.deepEqual(parseProject(JSON.stringify({ format: 'accusteel-draft', version: 1, building: defaultBuilding })), defaultBuilding);
  assert.throws(() => parseProject('{}'));
  const reference = parseDxf(exportDxf(defaultBuilding), 'test.dxf');
  assert.equal(reference.width, 60);
  assert.equal(reference.length, 96);
  assert.equal(reference.unsupported, 0);
  assert.equal(reference.segments.length, 11);
  assert.equal(materialsCsv(billOfMaterials(defaultBuilding)).split('\r\n').length, 8);
});