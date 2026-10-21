export function componentGroup(label = '') {
  if (/DXF|reference geometry/i.test(label)) return 'reference';
  if (/floor|slab|datum|concrete pad/i.test(label)) return 'floor';
  if (/window/i.test(label)) return 'window';
  if (/door/i.test(label)) return 'door';
  if (/concrete wall|ground|terrain|fill/i.test(label)) return 'site';
  if (/fabric|membrane|covering/i.test(label)) return 'covering';
  if (/frame|column|purlin|girt|bracing|base plate|anchor/i.test(label)) return 'structure';
  return 'building';
}

export const componentFields = {
  floor: ['floor'], structure: ['width','length','height','baySpacing','roof'],
  covering: ['fabric','endWalls'], door: ['doorWidth','doorHeight','endWalls'],
  window: ['window'], building: ['width','length','height','baySpacing','roof','fabric','endWalls'],
};

export function componentPatch(group, draft, current) {
  const patch = Object.fromEntries((componentFields[group] || []).map(field => [field,draft[field]]));
  if (group === 'floor') patch.construction = { ...current.construction, floorElevation: draft.construction.floorElevation };
  return patch;
}