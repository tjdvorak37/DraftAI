export const defaultConstruction = {
  wallMode: 'none', wallThickness: 8, clearance: 1, floorElevation: 0,
  columnMode: 'keep', fillMaterial: 'unspecified', fillFactor: 1,
};

export function groundElevation(site, fractionFromSouth) {
  const distance = site.riseToward === 'north' ? fractionFromSouth : 1 - fractionFromSouth;
  const fraction = Math.max(0, Math.min(1, (distance - site.slopeStart / 100) / (1 - site.slopeStart / 100)));
  return site.startElevation + (site.endElevation - site.startElevation) * fraction;
}

export function wallTopAt(building, fractionFromSouth) {
  const construction = { ...defaultConstruction, ...building.construction };
  return construction.wallMode === 'concrete' ? Math.max(0, groundElevation(building.site, fractionFromSouth) - construction.floorElevation + construction.clearance) : 0;
}

export function constructionTakeoff(building) {
  const config = { ...defaultConstruction, ...building.construction };
  const slopeStart = building.site.riseToward === 'north' ? building.site.slopeStart / 100 : 1 - building.site.slopeStart / 100;
  const stations = new Set([0, 1, slopeStart]);
  const originalStations = [...stations].sort((first, second) => first - second);
  for (let index = 1; index < originalStations.length; index++) {
    const start = originalStations[index - 1];
    const end = originalStations[index];
    const first = groundElevation(building.site, start) - config.floorElevation;
    const last = groundElevation(building.site, end) - config.floorElevation;
    for (const threshold of [0, -config.clearance]) {
      if ((first - threshold) * (last - threshold) < 0) stations.add(start + (end - start) * (threshold - first) / (last - first));
    }
  }
  const profile = [...stations].sort((first, second) => first - second).map(fraction => ({ fraction, station: fraction * building.length, ground: groundElevation(building.site, fraction) - config.floorElevation, wallTop: wallTopAt(building, fraction) }));
  let sideArea = 0;
  let cutCubicFeet = 0;
  let fillCubicFeet = 0;
  for (let index = 1; index < profile.length; index++) {
    const start = profile[index - 1];
    const end = profile[index];
    const run = end.station - start.station;
    sideArea += (start.wallTop + end.wallTop) / 2 * run;
    cutCubicFeet += (Math.max(0, start.ground) + Math.max(0, end.ground)) / 2 * run * building.width;
    fillCubicFeet += (Math.max(0, -start.ground) + Math.max(0, -end.ground)) / 2 * run * building.width;
  }
  const southTop = profile[0].wallTop;
  const northTop = profile.at(-1).wallTop;
  const thickness = config.wallThickness / 12;
  const doorArea = building.endWalls ? building.doorWidth * Math.min(building.doorHeight, southTop) : 0;
  const endArea = building.endWalls ? building.width * (southTop + northTop) - doorArea : 0;
  const concreteEndArea = building.endWalls ? (building.width - thickness) * (southTop + northTop) - doorArea : 0;
  const replacementArea = 2 * sideArea + endArea;
  const concreteVolume = config.wallMode === 'concrete' ? (2 * sideArea + concreteEndArea) * thickness / 27 : 0;
  const bays = Math.ceil(building.length / building.baySpacing);
  const columns = [];
  for (let frame = 0; frame <= bays; frame++) {
    const fraction = frame / bays;
    const base = config.wallMode === 'concrete' && config.columnMode === 'wall-top' ? wallTopAt(building, fraction) : 0;
    for (const side of ['East', 'West']) columns.push({ mark: `C${String(frame + 1).padStart(2, '0')}-${side[0]}`, frame: frame + 1, side, station: fraction * building.length, base, top: building.height, length: building.height - base, reduction: base });
  }
  return {
    profile, columns, replacementArea, concreteVolume,
    cutVolume: cutCubicFeet / 27, fillVolume: fillCubicFeet / 27,
    orderedFillVolume: fillCubicFeet / 27 * config.fillFactor,
    columnReduction: columns.reduce((sum, column) => sum + column.reduction, 0),
    columnLength: columns.reduce((sum, column) => sum + column.length, 0),
    maxWallHeight: Math.max(...profile.map(point => point.wallTop)),
    adapted: config.wallMode === 'concrete',
  };
}

export function sideWallPanels(building, southStation = 0) {
  const profile = constructionTakeoff(building).profile;
  const opening = building.window;
  const windowStart = opening.offsetFrom === 'south' ? opening.offset : building.length - opening.offset - opening.width;
  const windowEnd = windowStart + opening.width;
  const stations = [...new Set([southStation, building.length, ...profile.map(point => point.station), ...(opening.enabled ? [windowStart, windowEnd] : [])])].filter(station => station >= southStation && station <= building.length).sort((first, second) => first - second);
  const panels = [];
  for (const side of ['East', 'West']) for (let index = 1; index < stations.length; index++) {
    const start = stations[index - 1];
    const end = stations[index];
    const bottomStart = wallTopAt(building, start / building.length);
    const bottomEnd = wallTopAt(building, end / building.length);
    const windowSegment = side === 'East' && opening.enabled && start >= windowStart && end <= windowEnd;
    if (windowSegment) {
      if (opening.sill > Math.max(bottomStart, bottomEnd)) panels.push({ side, start, end, bottomStart, bottomEnd, top: opening.sill });
      panels.push({ side, start, end, bottomStart: opening.sill + opening.height, bottomEnd: opening.sill + opening.height, top: building.height });
    } else panels.push({ side, start, end, bottomStart, bottomEnd, top: building.height });
  }
  return panels.filter(panel => panel.end > panel.start && panel.top > Math.min(panel.bottomStart, panel.bottomEnd));
}

export function longitudinalMembers(building) {
  const bays = Math.ceil(building.length / building.baySpacing);
  const members = [];
  for (let run = 0; run <= 8; run++) for (let bay = 0; bay < bays; bay++) members.push({ mark: `P${run + 1}-B${bay + 1}`, type: 'Roof purlin', side: 'Roof', run, start: bay * building.length / bays, end: (bay + 1) * building.length / bays, length: building.length / bays });
  const profile = constructionTakeoff(building).profile;
  for (const side of ['East', 'West']) for (let elevation = 4; elevation < building.height; elevation += 5) {
    for (let bay = 0; bay < bays; bay++) {
      const bayStart = bay * building.length / bays;
      const bayEnd = (bay + 1) * building.length / bays;
      const stations = [...new Set([bayStart, bayEnd, ...profile.map(point => point.station).filter(station => station > bayStart && station < bayEnd)])].sort((first, second) => first - second);
      const visible = [];
      for (let index = 1; index < stations.length; index++) {
        let start = stations[index - 1];
        let end = stations[index];
        const startTop = wallTopAt(building, start / building.length);
        const endTop = wallTopAt(building, end / building.length);
        if (startTop >= elevation && endTop >= elevation) continue;
        if ((startTop - elevation) * (endTop - elevation) < 0) {
          const intersection = start + (end - start) * (elevation - startTop) / (endTop - startTop);
          if (startTop >= elevation) start = intersection;
          else end = intersection;
        }
        if (end - start > 0.000001) {
          const previous = visible.at(-1);
          if (previous && Math.abs(previous[1] - start) < 0.000001) previous[1] = end;
          else visible.push([start, end]);
        }
      }
      visible.forEach(([start, end], interval) => {
        let intervals = [[start, end]];
        if (side === 'East' && building.window.enabled && elevation >= building.window.sill && elevation <= building.window.sill + building.window.height) {
          const windowStart = building.window.offsetFrom === 'south' ? building.window.offset : building.length - building.window.offset - building.window.width;
          const windowEnd = windowStart + building.window.width;
          intervals = intervals.flatMap(([first, last]) => windowStart >= last || windowEnd <= first ? [[first, last]] : [[first, Math.min(last, windowStart)], [Math.max(first, windowEnd), last]]);
        }
        intervals.forEach(([first, last], piece) => {
          if (last - first > 0.000001) members.push({ mark: `G-${side[0]}-${elevation}-B${bay + 1}-${interval + 1}-${piece + 1}`, type: 'Side girt', side, elevation, start: first, end: last, length: last - first });
        });
      });
    }
  }
  return members;
}