const measurement = String.raw`\d+(?:\.\d+)?\s*(?:(?:feet|foot|ft|')\s*(?:\d+(?:\.\d+)?\s*(?:inches|inch|in|"))?|(?:inches|inch|in|"))?`;
const pairPattern = new RegExp(`(${measurement})\\s*(?:by|x|×)\\s*(${measurement})`, 'i');

export class ClarificationError extends Error {
  constructor(message) { super(message); this.name = 'ClarificationError'; this.needsClarification = true; }
}

export function measurementInFeet(text) {
  const normalized = String(text).trim().toLowerCase().replace(/[′’]/g, "'").replace(/[″“”]/g, '"');
  const feet = normalized.match(/^(\d+(?:\.\d+)?)\s*(?:feet|foot|ft|')\s*(?:(\d+(?:\.\d+)?)\s*(?:inches|inch|in|"))?$/);
  if (feet) {
    const inches = Number(feet[2] || 0);
    if (inches >= 12) throw new ClarificationError('Use fewer than 12 inches in a feet-and-inches measurement, such as 20\' 6".');
    return Number(feet[1]) + inches / 12;
  }
  const inches = normalized.match(/^(\d+(?:\.\d+)?)\s*(?:inches|inch|in|")$/);
  if (inches) return Number(inches[1]) / 12;
  if (/^\d+(?:\.\d+)?$/.test(normalized)) return Number(normalized);
  throw new ClarificationError(`I could not read the measurement "${text}". Use feet, ft, foot, inches, or apostrophe notation.`);
}

export function parseDesignChanges(input, building, context = null) {
  const text = input.replace(/[′’]/g, "'").replace(/[″“”]/g, '"').replace(/\bsouth[ -]?east\b/gi, 'southeast').replace(/\bnorth[ -]?east\b/gi, 'northeast');
  const changes = {};
  const construction = { ...building.construction };
  let constructionRequested = false;
  if (/\b(?:use|add|enable)\s+(?:the\s+)?concrete\s+(?:stem\s*)?walls?\b/i.test(text)) { construction.wallMode = 'concrete'; constructionRequested = true; }
  if (/\b(?:remove|disable|no)\s+concrete\s+(?:stem\s*)?walls?\b/i.test(text)) { construction.wallMode = 'none'; construction.columnMode = 'keep'; constructionRequested = true; }
  if (/\b(?:start|mount|support)\b.{0,40}\b(?:columns?|steel)\b.{0,30}\bwall\s*tops?\b/i.test(text)) { construction.wallMode = 'concrete'; construction.columnMode = 'wall-top'; constructionRequested = true; }
  if (/\bkeep\s+(?:the\s+)?(?:original\s+)?columns?(?:\s+lengths?)?\b/i.test(text)) { construction.columnMode = 'keep'; constructionRequested = true; }
  const thickness = text.match(new RegExp(`wall\\s*thickness\\s*(?:to|of|at|=)?\\s*(${measurement})`, 'i'));
  if (thickness) {
    if (!/feet|foot|ft|inches|inch|in|['"]/i.test(thickness[1])) throw new ClarificationError('Include the wall thickness unit, such as "wall thickness 8 inches".');
    construction.wallThickness = measurementInFeet(thickness[1]) * 12; constructionRequested = true;
  }
  const clearance = text.match(new RegExp(`(?:wall\\s*)?clearance\\s*(?:to|of|at|=)?\\s*(${measurement})`, 'i'));
  if (clearance) { construction.clearance = measurementInFeet(clearance[1]); constructionRequested = true; }
  const floor = text.match(new RegExp(`finished\\s*floor(?:\\s*elevation)?\\s*(?:to|of|at|=)?\\s*(${measurement})`, 'i'));
  if (floor) { construction.floorElevation = measurementInFeet(floor[1]); constructionRequested = true; }
  if (/\b(?:use|select)\s+stone\s*fill\b/i.test(text)) { construction.fillMaterial = 'stone'; constructionRequested = true; }
  if (/\b(?:use|select)\s+engineered[ -]fill\b/i.test(text)) { construction.fillMaterial = 'engineered-fill'; constructionRequested = true; }
  const factor = text.match(/\bfill\s*factor\s*(?:to|of|at|=)?\s*(\d+(?:\.\d+)?)/i);
  if (factor) { construction.fillFactor = Number(factor[1]); constructionRequested = true; }
  if (constructionRequested) changes.construction = construction;
  if (/\b(?:design|size|engineer|calculate)\b.{0,40}\b(?:footings?|foundations?|reinforcement|retaining\s*capacity|steel\s*(?:size|sizing))\b/i.test(text)) throw new ClarificationError('Structural and foundation sizing is not available. You can specify wall dimensions, support layout, floor elevation, and fill allowance for a dimensional takeoff, but an engineer must resolve strength, connections, reinforcement, and footings.');
  const relativeHeight = text.match(new RegExp(`(?:raise|raised|increase|increased|higher|lower|lowered|decrease|decreased)\\s*(?:the\\s*(?:building\\s*)?(?:height)?\\s*)?(?:by\\s*)?(${measurement})`, 'i'));
  const hasHeight = /\b(height|building|eave|roof)\b/i.test(text);
  if (relativeHeight && hasHeight && !/\b(roof pitch|roof slope)\b/i.test(text)) {
    const amount = measurementInFeet(relativeHeight[1]);
    changes.height = building.height + (/lower|decrease/i.test(relativeHeight[0]) ? -amount : amount);
  }
  const dimensionExpressions = {
    width: [new RegExp(`(?:width|wide)\\s*(?:to|of|=|is)?\\s*(${measurement})`, 'i'), new RegExp(`(${measurement})\\s*(?:wide|width)\\b`, 'i')],
    length: [new RegExp(`(?:length|long)\\s*(?:to|of|=|is)?\\s*(${measurement})`, 'i'), new RegExp(`(${measurement})\\s*(?:long|length)\\b`, 'i')],
    height: [new RegExp(`(?:eave height|height|tall)\\s*(?:to|of|=|is)?\\s*(${measurement})`, 'i'), new RegExp(`(${measurement})\\s*(?:tall|high)\\b`, 'i')],
    baySpacing: [new RegExp(`(?:bay spacing|bays|spacing)\\s*(?:to|of|=|is|at)?\\s*(${measurement})`, 'i'), new RegExp(`(${measurement})\\s*bays\\b`, 'i')],
  };
  const openingRequest = /\b(door|window)\b/i.test(text);
  if (!openingRequest) for (const [field, expressions] of Object.entries(dimensionExpressions)) {
    if (field === 'height' && relativeHeight && hasHeight) continue;
    for (const expression of expressions) { const match = text.match(expression); if (match) { changes[field] = measurementInFeet(match[1]); break; } }
  }
  const pair = text.match(pairPattern);
  if (pair) {
    const subject = /\bdoor\b/i.test(text) ? 'door' : /\bwindow\b/i.test(text) ? 'window' : /\b(building|footprint|barn|structure)\b/i.test(text) ? 'building' : context;
    if (!subject) throw new ClarificationError('Does that size refer to the building footprint, garage door, or window? For example: "Set the garage door to 20\' x 14\'".');
    const width = measurementInFeet(pair[1]);
    const heightOrLength = measurementInFeet(pair[2]);
    if (subject === 'door') { changes.doorWidth = width; changes.doorHeight = heightOrLength; }
    if (subject === 'building') { changes.width = width; changes.length = heightOrLength; }
    if (subject === 'window') changes.window = { ...building.window, enabled: true, width, height: heightOrLength };
  }
  const extension = text.match(new RegExp(`(?:add|extend(?:\\s+(?:the\\s+)?(?:building|barn))?\\s+by)\\s*(${measurement})\\s*(?:to|at|on)?\\s*(?:the\\s*)?(north|south|east|west)\\s*(?:end|side)?`, 'i'));
  if (extension) {
    if (extension[2].toLowerCase() !== 'north') throw new ClarificationError('This version supports a north-end extension with the south datum held fixed. Other directional extensions need an anchor/placement decision. Set the overall width or length manually, or specify the required anchor.');
    changes.length = building.length + measurementInFeet(extension[1]);
  } else if (/\b(north|south|east|west)\b/i.test(text) && !/\b(window|grade|landscape|slope|terrain)\b/i.test(text)) throw new ClarificationError('Do you mean extend the building by 5 ft, move it 5 ft, or leave a 5 ft setback? State the operation and the edge that stays fixed; I have not changed the design.');
  if (/\bwindow\b/i.test(text)) {
    const window = { ...building.window, ...changes.window, enabled: !/\b(remove|delete|no)\b/i.test(text) };
    const wall = text.match(/\b(north|south|east|west)\s*(?:wall|side)\b/i);
    const corner = text.match(/\b(southeast|northeast)\s*corner\b/i);
    const offset = text.match(new RegExp(`(?:to|at|(?:near|nearest)\\s*edge|offset(?:\\s+of)?)\\s*(${measurement})\\s*(?:from|of)\\s*(?:the\\s*)?(?:southeast|northeast)`, 'i'));
    if (/\b(relocate|move|position|offset|corner)\b/i.test(text)) {
      if (!wall || !corner || !offset || !/\b(?:near|nearest)\s*edge\b/i.test(text)) throw new ClarificationError('Which wall should the window be on, and is the offset to its near edge or center? Supported example: "Move the window on the east wall, near edge 20 ft from the southeast corner". No changes have been applied.');
      if (wall[1].toLowerCase() !== 'east') throw new ClarificationError('Window placement currently supports the east wall only. Other walls and multiple openings need the expanded CAD opening model; I have not moved the window.');
      window.offset = measurementInFeet(offset[1]);
      window.offsetFrom = corner[1].toLowerCase() === 'southeast' ? 'south' : 'north';
    }
    if (wall && wall[1].toLowerCase() !== 'east') throw new ClarificationError('Only east-wall windows are modeled in this version.');
    if (!pair && !offset && !/\b(remove|delete|add|no)\b/i.test(text)) throw new ClarificationError('Specify a window size or an east-wall near-edge position. For example: "Set the window to 4 ft by 3 ft".');
    changes.window = window;
  }
  if (/\b(grade|landscape|slope|terrain|land scape)\b/i.test(text) && (!/\b(clearance|above[ -]grade)\b/i.test(text) || /\bfrom\s*\d/i.test(text))) {
    const elevations = text.match(new RegExp(`from\\s*(${measurement})\\s*to\\s*(${measurement})`, 'i'));
    const direction = text.match(/\b(?:toward|towards|to)\s*(?:the\s*)?(north|south)\b/i);
    const halfway = /\b(halfway|half way|half-way|midpoint)\b/i.test(text);
    const percent = text.match(/(?:starting|start|beginning)\s*(?:at\s*)?(\d+(?:\.\d+)?)\s*%/i);
    if (!elevations || !direction || (!halfway && !percent && !/\b(?:full length|south end|north end)\b/i.test(text))) throw new ClarificationError('What direction does the ground rise, and where does the slope begin? For example: "Grade rises from 0 to 6 ft toward north, starting halfway along the building". Foundation, stone, and steel sizing remain uncalculated.');
    changes.site = { ...building.site, startElevation: measurementInFeet(elevations[1]), endElevation: measurementInFeet(elevations[2]), slopeStart: halfway ? 50 : percent ? Number(percent[1]) : 0, riseToward: direction[1].toLowerCase() };
  }
  if (/\b(foundation|foundations|footing|footings|stone|landscap(?:e|ing)|retaining|soil|geotechnical|steal|steel sizing)\b/i.test(text) && !changes.site && !constructionRequested) throw new ClarificationError('Site-specific foundation, fill/stone, and structural steel requirements need approved engineering rules and site data. I cannot size them from a description alone; enter the terrain profile and submit it for engineering review.');
  if (/\b(gable|arch|arched)\b/i.test(text)) changes.roof = /gable/i.test(text) ? 'gable' : 'arch';
  const color = text.match(/\b(ivory|white|green|gray)\b/i);
  if (color) changes.fabric = color[1].toLowerCase();
  if (/(?:remove|no|without)\s+end\s*walls?/i.test(text)) changes.endWalls = false;
  if (/(?:add|close|include)\s+end\s*walls?/i.test(text)) changes.endWalls = true;
  if (!Object.keys(changes).length) throw new ClarificationError('I could not map this request to supported building parameters. Specify the dimension, opening, or site profile. Arbitrary CAD parts and structural calculations are not available yet.');
  return changes;
}