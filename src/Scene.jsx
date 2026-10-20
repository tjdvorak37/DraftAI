import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildingMetrics, roofHeightAt, siteElevationAt, constructionTakeoff, wallTopAt, sideWallPanels, longitudinalMembers } from '../shared/model.js';

const colors = { ivory: '#e6e4d6', white: '#f8f8f4', green: '#687a64', gray: '#a0a8a6' };

export default function Scene({ building, view, cutaway, showGrid, showDimensions, wireframe, reference, resetKey, onSelect }) {
  const host = useRef(null);
  const engine = useRef(null);
  const selection = useRef(onSelect);
  selection.current = onSelect;

  useEffect(() => {
    const container = host.current;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); }
    catch { container.innerHTML = '<p class="canvas-error">3D preview requires WebGL. Plan and material quantities remain available.</p>'; return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor('#edf0eb', 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.5, 4000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 35;
    controls.maxDistance = 1000;
    controls.maxPolarAngle = Math.PI / 2 - 0.025;
    scene.add(new THREE.HemisphereLight('#ffffff', '#b1b9a9', 2.6));
    const sunlight = new THREE.DirectionalLight('#fff8e8', 3.4);
    sunlight.position.set(-90, 170, 80);
    sunlight.castShadow = true;
    sunlight.shadow.mapSize.set(2048, 2048);
    sunlight.shadow.camera.left = sunlight.shadow.camera.bottom = -240;
    sunlight.shadow.camera.right = sunlight.shadow.camera.top = 240;
    sunlight.shadow.camera.far = 600;
    sunlight.shadow.bias = -0.0004;
    sunlight.shadow.normalBias = 0.15;
    scene.add(sunlight);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), new THREE.ShadowMaterial({ color: '#73816c', opacity: 0.13 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.36;
    ground.receiveShadow = true;
    scene.add(ground);
    const model = new THREE.Group();
    scene.add(model);
    const grid = new THREE.GridHelper(1200, 240, '#bfc8bb', '#dce2d6');
    grid.position.y = -0.32;
    grid.material.transparent = true;
    grid.material.opacity = 0.6;
    scene.add(grid);
    const labels = [];
    let animation;
    const render = () => {
      animation = requestAnimationFrame(render);
      controls.update();
      for (const label of labels) {
        const projected = label.point.clone().project(camera);
        label.element.style.left = `${(projected.x * 0.5 + 0.5) * container.clientWidth}px`;
        label.element.style.top = `${(-projected.y * 0.5 + 0.5) * container.clientHeight}px`;
        label.element.style.display = projected.z > 1 ? 'none' : '';
      }
      renderer.render(scene, camera);
    };
    render();
    const resize = new ResizeObserver(() => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      engine.current?.fit?.();
    });
    resize.observe(container);
    const pointer = new THREE.Vector2();
    const raycaster = new THREE.Raycaster();
    let down;
    const pointerDown = event => { down = { x: event.clientX, y: event.clientY }; };
    const pointerUp = event => {
      if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) return;
      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const selected = raycaster.intersectObjects(model.children, true).find(hit => hit.object.userData.part);
      selection.current?.(selected?.object.userData.part || null);
    };
    renderer.domElement.addEventListener('pointerdown', pointerDown);
    renderer.domElement.addEventListener('pointerup', pointerUp);
    engine.current = { renderer, scene, camera, controls, model, grid, labels };
    return () => {
      cancelAnimationFrame(animation);
      resize.disconnect();
      controls.dispose();
      scene.traverse(object => { object.geometry?.dispose(); if (object.material) for (const material of [].concat(object.material)) material.dispose(); });
      renderer.dispose();
      container.replaceChildren();
      engine.current = null;
    };
  }, []);

  useEffect(() => {
    if (!engine.current) return;
    const { model, labels, grid } = engine.current;
    model.traverse(object => { object.geometry?.dispose(); if (object.material) for (const material of [].concat(object.material)) material.dispose(); });
    model.clear();
    for (const label of labels) label.element.remove();
    labels.length = 0;
    grid.visible = showGrid;
    const { width, length, height } = building;
    const { bays, actualBay } = buildingMetrics(building);
    const takeoff = constructionTakeoff(building);
    const steel = new THREE.MeshStandardMaterial({ color: '#929d99', metalness: 0.72, roughness: 0.39 });
    const darkSteel = new THREE.MeshStandardMaterial({ color: '#65736b', metalness: 0.55, roughness: 0.5 });
    const fabric = new THREE.MeshStandardMaterial({ color: colors[building.fabric], metalness: 0, roughness: 0.9, side: THREE.DoubleSide, wireframe });
    const tube = (points, radius = 0.16, material = steel, part = 'Galvanized arch frame') => {
      const curve = new THREE.CurvePath();
      for (let index = 1; index < points.length; index++) curve.add(new THREE.LineCurve3(new THREE.Vector3(...points[index - 1]), new THREE.Vector3(...points[index])));
      const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(2, points.length * 2), radius, 6, false), material);
      mesh.castShadow = true;
      mesh.userData.part = part;
      model.add(mesh);
      return mesh;
    };
    const box = (size, position, material, part) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
      mesh.position.set(...position);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.part = part;
      model.add(mesh);
      return mesh;
    };
    box([width + 3.5, 0.5, length + 3.5], [0, -0.25, 0], new THREE.MeshStandardMaterial({ color: '#cbd0c8', roughness: 1 }), 'Level floor datum · foundation not designed');
    if (takeoff.adapted && takeoff.fillVolume > 0 && building.construction.fillMaterial !== 'unspecified') {
      const fillMaterial = new THREE.MeshStandardMaterial({ color: building.construction.fillMaterial === 'stone' ? '#b2b6ad' : '#aca58e', roughness: 1 });
      for (let index = 1; index < takeoff.profile.length; index++) {
        const start = takeoff.profile[index - 1];
        const end = takeoff.profile[index];
        if (Math.min(start.ground, end.ground) >= 0) continue;
        const section = new THREE.Shape();
        section.moveTo(start.station, 0);
        section.lineTo(end.station, 0);
        section.lineTo(end.station, Math.min(0, end.ground));
        section.lineTo(start.station, Math.min(0, start.ground));
        section.closePath();
        const fill = new THREE.Mesh(new THREE.ExtrudeGeometry(section, { depth: width, bevelEnabled: false, steps: 1 }), fillMaterial);
        fill.rotation.y = Math.PI / 2;
        fill.position.set(-width / 2, 0, length / 2);
        fill.castShadow = true;
        fill.receiveShadow = true;
        fill.userData.part = `${building.construction.fillMaterial === 'stone' ? 'Stone' : 'Engineered'} fill · net geometric volume · suitability unverified`;
        model.add(fill);
      }
    }
    if (building.site.startElevation !== 0 || building.site.endElevation !== 0 || building.construction.floorElevation !== 0) {
      const terrainVertices = [];
      const terrainWidth = width / 2 + 15;
      for (let station = 0; station < 64; station++) {
        const fraction = station / 64;
        const next = (station + 1) / 64;
        const southZ = length / 2 - length * fraction;
        const northZ = length / 2 - length * next;
        const southHeight = siteElevationAt(building, fraction) - building.construction.floorElevation - 0.03;
        const northHeight = siteElevationAt(building, next) - building.construction.floorElevation - 0.03;
        const strips = takeoff.adapted ? [[-terrainWidth, -width / 2 - building.construction.wallThickness / 24], [width / 2 + building.construction.wallThickness / 24, terrainWidth]] : [[-terrainWidth, terrainWidth]];
        for (const [left, right] of strips) terrainVertices.push(left, southHeight, southZ, right, southHeight, southZ, left, northHeight, northZ, right, southHeight, southZ, right, northHeight, northZ, left, northHeight, northZ);
      }
      const terrainGeometry = new THREE.BufferGeometry();
      terrainGeometry.setAttribute('position', new THREE.Float32BufferAttribute(terrainVertices, 3));
      terrainGeometry.computeVertexNormals();
      const terrain = new THREE.Mesh(terrainGeometry, new THREE.MeshStandardMaterial({ color: '#a2af92', roughness: 1, side: THREE.DoubleSide }));
      terrain.receiveShadow = true;
      terrain.userData.part = takeoff.adapted ? 'Existing ground outside the proposed wall · site engineering pending' : 'Existing terrain · wall adaptation disabled';
      model.add(terrain);
      const profile = [];
      for (let station = 0; station <= 64; station++) profile.push(new THREE.Vector3(width / 2 + 9, siteElevationAt(building, station / 64) - building.construction.floorElevation, length / 2 - length * station / 64));
      model.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(profile), new THREE.LineBasicMaterial({ color: '#af7755' })));
    }
    for (let bay = 0; bay <= bays; bay++) {
      const depth = -length / 2 + actualBay * bay;
      const base = takeoff.columns[(bays - bay) * 2].base;
      for (const offset of [0, 0.9]) {
        const points = [[-width / 2 + offset, base, depth], [-width / 2 + offset, height - offset, depth]];
        for (let step = 0; step <= 32; step++) {
          const horizontal = -width / 2 + width * step / 32;
          points.push([horizontal * (1 - offset / width * 2), roofHeightAt(building, horizontal) - offset, depth]);
        }
        points.push([width / 2 - offset, base, depth]);
        tube(points, offset ? 0.105 : 0.19);
      }
      for (let step = 1; step < 24; step++) {
        const horizontal = -width / 2 + width * step / 24;
        tube([[horizontal, roofHeightAt(building, horizontal), depth], [(horizontal + width / 24) * (1 - 1.8 / width), roofHeightAt(building, horizontal + width / 24) - 0.9, depth]], 0.065);
      }
      for (const side of [-1, 1]) {
        box([1.2, 0.16, 1.2], [side * width / 2, base + 0.1, depth], darkSteel, `Column base plate · proposed elevation ${base.toFixed(2)} ft`);
        for (let level = base + 2; level < height - 1; level += 3) tube([[side * width / 2, level, depth], [side * (width / 2 - 0.9), level + 1, depth]], 0.065);
      }
    }
    for (const member of longitudinalMembers(building)) {
      const horizontal = member.type === 'Roof purlin' ? -width / 2 + width * member.run / 8 : (member.side === 'East' ? 1 : -1) * width / 2;
      const elevation = member.type === 'Roof purlin' ? roofHeightAt(building, horizontal) - 0.3 : member.elevation;
      tube([[horizontal, elevation, length / 2 - member.start], [horizontal, elevation, length / 2 - member.end]], 0.12, steel, `${member.mark} · ${member.type} · ${member.length.toFixed(2)} ft`);
    }
    for (const side of [-1, 1]) {
      for (const end of [-1, 1]) {
        const depth = end * length / 2;
        const startBase = wallTopAt(building, end === 1 ? 0 : 1);
        const endBase = wallTopAt(building, end === 1 ? 1 / bays : 1 - 1 / bays);
        tube([[side * width / 2, startBase + 1, depth], [side * width / 2, height, depth - end * actualBay]], 0.055, darkSteel, 'Cross-bracing layout · connection review required');
        tube([[side * width / 2, height, depth], [side * width / 2, endBase + 1, depth - end * actualBay]], 0.055, darkSteel, 'Cross-bracing layout · connection review required');
      }
    }
    const coverEnd = cutaway ? length / 2 - actualBay * Math.min(2.2, bays * 0.4) : length / 2;
    const vertices = [];
    for (let step = 0; step < 64; step++) {
      const left = -width / 2 + width * step / 64;
      const right = -width / 2 + width * (step + 1) / 64;
      const topLeft = roofHeightAt(building, left) + 0.16;
      const topRight = roofHeightAt(building, right) + 0.16;
      vertices.push(left, topLeft, -length / 2, right, topRight, -length / 2, left, topLeft, coverEnd, right, topRight, -length / 2, right, topRight, coverEnd, left, topLeft, coverEnd);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
    const roof = new THREE.Mesh(geometry, fabric);
    roof.castShadow = true;
    roof.receiveShadow = true;
    roof.userData.part = 'Architectural fabric membrane';
    model.add(roof);
    for (const panel of sideWallPanels(building, length / 2 - coverEnd)) {
      const shape = new THREE.Shape();
      shape.moveTo(panel.start, panel.bottomStart);
      shape.lineTo(panel.end, panel.bottomEnd);
      shape.lineTo(panel.end, panel.top);
      shape.lineTo(panel.start, panel.top);
      shape.closePath();
      const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), fabric);
      mesh.rotation.y = Math.PI / 2;
      mesh.position.set((panel.side === 'East' ? 1 : -1) * (width / 2 + 0.12), 0, length / 2);
      mesh.castShadow = true;
      mesh.userData.part = `${panel.side} covering · concrete and window openings deducted`;
      model.add(mesh);
    }
    if (takeoff.adapted) {
      const concrete = new THREE.MeshStandardMaterial({ color: '#b4b5ac', roughness: 0.98 });
      const thickness = building.construction.wallThickness / 12;
      for (const side of [-1, 1]) {
        const shape = new THREE.Shape();
        shape.moveTo(0, 0);
        shape.lineTo(length, 0);
        for (const point of [...takeoff.profile].reverse()) shape.lineTo(point.station, point.wallTop);
        shape.closePath();
        const wall = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, steps: 1 }), concrete);
        wall.rotation.y = Math.PI / 2;
        wall.position.set(side * width / 2 - thickness / 2, 0, length / 2);
        wall.castShadow = true;
        wall.receiveShadow = true;
        wall.userData.part = `${side === 1 ? 'East' : 'West'} concrete wall · ${building.construction.wallThickness} in · engineering pending`;
        model.add(wall);
      }
      if (building.endWalls) {
        const northTop = takeoff.profile.at(-1).wallTop;
        const southTop = takeoff.profile[0].wallTop;
        if (northTop > 0) box([width - thickness, northTop, thickness], [0, northTop / 2, -length / 2], concrete, 'North concrete wall · net geometric takeoff');
        if (southTop > 0) {
          if (building.doorWidth > 0) {
            const endWidth = (width - thickness - building.doorWidth) / 2;
            for (const side of [-1, 1]) box([endWidth, southTop, thickness], [side * (building.doorWidth / 2 + endWidth / 2), southTop / 2, length / 2], concrete, 'South concrete wall · door opening deducted');
            if (southTop > building.doorHeight) box([building.doorWidth, southTop - building.doorHeight, thickness], [0, (southTop + building.doorHeight) / 2, length / 2], concrete, 'South wall above door');
          } else box([width - thickness, southTop, thickness], [0, southTop / 2, length / 2], concrete, 'South concrete wall');
        }
      }
    }
    if (building.window.enabled) {
      const opening = building.window;
      const windowZ = opening.offsetFrom === 'south' ? length / 2 - opening.offset - opening.width / 2 : -length / 2 + opening.offset + opening.width / 2;
      const windowY = opening.sill + opening.height / 2;
      const windowX = width / 2 + 0.38;
      const glass = new THREE.MeshStandardMaterial({ color: '#8faead', metalness: 0.2, roughness: 0.3, transparent: true, opacity: 0.8 });
      box([0.1, opening.height, opening.width], [windowX, windowY, windowZ], glass, 'East-wall window reference · detailing unresolved');
      for (const vertical of [-1, 1]) box([0.17, opening.height + 0.2, 0.14], [windowX, windowY, windowZ + vertical * opening.width / 2], darkSteel, 'Window reference frame');
      for (const horizontal of [-1, 1]) box([0.17, 0.14, opening.width], [windowX, windowY + horizontal * opening.height / 2, windowZ], darkSteel, 'Window reference frame');
    }
    if (building.endWalls) {
      const shape = new THREE.Shape();
      const backBase = wallTopAt(building, 1);
      shape.moveTo(-width / 2, backBase);
      shape.lineTo(-width / 2, height);
      for (let step = 0; step <= 64; step++) {
        const horizontal = -width / 2 + width * step / 64;
        shape.lineTo(horizontal, roofHeightAt(building, horizontal));
      }
      shape.lineTo(width / 2, backBase);
      const back = new THREE.Mesh(new THREE.ShapeGeometry(shape), fabric);
      back.position.z = -length / 2 - 0.1;
      back.castShadow = true;
      back.userData.part = 'Rear end-wall fabric';
      model.add(back);
      if (!cutaway) {
        const frontBase = wallTopAt(building, 0);
        const frontShape = new THREE.Shape();
        frontShape.moveTo(-width / 2, frontBase);
        frontShape.lineTo(-width / 2, height);
        for (let step = 0; step <= 64; step++) {
          const horizontal = -width / 2 + width * step / 64;
          frontShape.lineTo(horizontal, roofHeightAt(building, horizontal));
        }
        frontShape.lineTo(width / 2, frontBase);
        if (building.doorWidth > 0) {
          frontShape.lineTo(building.doorWidth / 2, frontBase);
          frontShape.lineTo(building.doorWidth / 2, Math.max(frontBase, building.doorHeight));
          frontShape.lineTo(-building.doorWidth / 2, Math.max(frontBase, building.doorHeight));
          frontShape.lineTo(-building.doorWidth / 2, frontBase);
        }
        frontShape.closePath();
        const front = new THREE.Mesh(new THREE.ShapeGeometry(frontShape), fabric);
        front.position.z = length / 2 + 0.1;
        front.userData.part = 'Front end-wall fabric';
        model.add(front);
      }
      if (building.doorWidth > 0) {
        const doorZ = length / 2 + 0.25;
        tube([[-building.doorWidth / 2, 0, doorZ], [-building.doorWidth / 2, building.doorHeight, doorZ], [building.doorWidth / 2, building.doorHeight, doorZ], [building.doorWidth / 2, 0, doorZ]], 0.25, darkSteel, 'Custom end-wall door');
      }
    }
    if (showDimensions) {
      const dimensionMaterial = new THREE.LineBasicMaterial({ color: '#778476', transparent: true, opacity: 0.8 });
      const dimension = (start, end, text, labelPosition) => {
        const points = [new THREE.Vector3(...start), new THREE.Vector3(...end)];
        model.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), dimensionMaterial));
        for (const point of [start, end]) {
          const tick = [new THREE.Vector3(point[0] - 0.8, point[1] - 0.5, point[2] - 0.8), new THREE.Vector3(point[0] + 0.8, point[1] + 0.5, point[2] + 0.8)];
          model.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(tick), dimensionMaterial));
        }
        const element = document.createElement('div');
        element.className = 'dimension-label';
        element.textContent = text;
        host.current.appendChild(element);
        labels.push({ element, point: new THREE.Vector3(...labelPosition) });
      };
      dimension([-width / 2, 0.1, length / 2 + 9], [width / 2, 0.1, length / 2 + 9], `${width}'–0"`, [0, 0.1, length / 2 + 10]);
      dimension([width / 2 + 9, 0.1, -length / 2], [width / 2 + 9, 0.1, length / 2], `${length}'–0"`, [width / 2 + 10, 0.1, 0]);
      dimension([-width / 2 - 5, 0, length / 2], [-width / 2 - 5, height, length / 2], `${height}'–0"`, [-width / 2 - 8, height / 2, length / 2]);
    }
    if (reference?.segments) {
      const points = reference.segments.flatMap(segment => segment.map(point => new THREE.Vector3(point[0], 0.3, -point[1])));
      const lines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: '#ba5b42' }));
      lines.userData.part = `DXF reference · ${reference.name}`;
      model.add(lines);
    }
  }, [building, cutaway, showGrid, showDimensions, wireframe, reference]);

  useEffect(() => {
    if (!engine.current) return;
    const { camera, controls } = engine.current;
    const fit = () => {
      const size = Math.max(building.width, building.length, 65);
      const margin = Math.max(1, 1.4 / camera.aspect);
      controls.target.set(0, building.height * 0.5, 0);
      if (view === 'plan') camera.position.set(0, size * 2.05 * margin, 0.01);
      else if (view === 'front') camera.position.set(0, building.height * 0.65, size * 1.95 * margin);
      else camera.position.set(size * 1.2 * margin, size * 0.92 * margin, size * 1.4 * margin);
      controls.enableRotate = view === '3d';
      controls.update();
    };
    engine.current.fit = fit;
    fit();
  }, [view, resetKey]);

  return <div className="scene-canvas" ref={host} aria-label={`${view} view of ${building.width} by ${building.length} foot steel building`} />;
}