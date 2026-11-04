import * as THREE from "three";
import { analyzeStructuralConnectivity } from "../domain/buildingModel.js";

function createMaterials() {
  return {
    concrete: new THREE.MeshStandardMaterial({ color: "#a9b0b5", roughness: 0.82 }),
    slab: new THREE.MeshStandardMaterial({ color: "#737d85", roughness: 0.9, side: THREE.DoubleSide }),
    beam: new THREE.MeshStandardMaterial({ color: "#c5cbd0", roughness: 0.76 }),
    wall: new THREE.MeshStandardMaterial({ color: "#d2d0c8", roughness: 0.9, side: THREE.DoubleSide }),
    door: new THREE.MeshStandardMaterial({ color: "#725d49", roughness: 0.82 }),
    foundation: new THREE.MeshStandardMaterial({ color: "#69747c", roughness: 0.92 }),
    roof: new THREE.MeshStandardMaterial({ color: "#8d969c", roughness: 0.82, side: THREE.DoubleSide }),
    glazing: new THREE.MeshPhysicalMaterial({ color: "#8bb9c8", roughness: 0.16, metalness: 0.12, transmission: 0.28, transparent: true, opacity: 0.52, side: THREE.DoubleSide, depthWrite: false }),
    frame: new THREE.MeshStandardMaterial({ color: "#aeb8bf", roughness: 0.48, metalness: 0.38 }),
    rebar: new THREE.MeshStandardMaterial({ color: "#c18b58", metalness: 0.62, roughness: 0.38 })
  };
}
const UNIT_SCALE = { m: 1, mm: 0.001, cm: 0.01, ft: 0.3048 };
const vec = (p, s) => new THREE.Vector3(p.x * s, p.y * s, p.z * s);

function orientedMemberQuaternion(axis, upHint = new THREE.Vector3(0, 1, 0)) {
  const x = axis.clone().normalize();
  let y = upHint.clone().addScaledVector(x, -upHint.dot(x));
  if (y.lengthSq() < 1e-8) {
    const fallback = Math.abs(x.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    y = fallback.addScaledVector(x, -fallback.dot(x));
  }
  y.normalize();
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  y = new THREE.Vector3().crossVectors(z, x).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

function createWallPrismGeometry(start, direction, normal, from, to, bottom, top, thickness, baseYAt) {
  const a = start.clone().addScaledVector(direction, from);
  const b = start.clone().addScaledVector(direction, to);
  const half = thickness / 2;
  const yA = baseYAt(from), yB = baseYAt(to);
  const vertices = [
    a.x + normal.x * half, yA + bottom, a.z + normal.z * half,
    b.x + normal.x * half, yB + bottom, b.z + normal.z * half,
    b.x + normal.x * half, yB + top, b.z + normal.z * half,
    a.x + normal.x * half, yA + top, a.z + normal.z * half,
    a.x - normal.x * half, yA + bottom, a.z - normal.z * half,
    b.x - normal.x * half, yB + bottom, b.z - normal.z * half,
    b.x - normal.x * half, yB + top, b.z - normal.z * half,
    a.x - normal.x * half, yA + top, a.z - normal.z * half
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex([
    0, 1, 2, 0, 2, 3, 5, 4, 7, 5, 7, 6,
    4, 0, 3, 4, 3, 7, 1, 5, 6, 1, 6, 2,
    3, 2, 6, 3, 6, 7, 4, 5, 1, 4, 1, 0
  ]);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function addMesh(group, elements, mesh, id, category, label, metadata = {}) {
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.userData = { id, name: label || id, category, ...metadata };
  group.add(mesh); elements.push(mesh); return mesh;
}
function addRod(group, elements, bar, scale, fallbackId, owner, layout, layoutIndex, MATERIALS) {
  const a = vec(bar.start, scale), b = vec(bar.end, scale);
  const direction = b.clone().sub(a), length = direction.length();
  const diameter = bar.diameter?.value;
  if (!Number.isFinite(length) || length <= 0 || !Number.isFinite(diameter) || diameter <= 0) return;
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(diameter * scale / 2, diameter * scale / 2, length, 10), MATERIALS.rebar);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  addMesh(group, elements, mesh, bar.id || fallbackId, "reinforcement", bar.id || fallbackId, { ownerId: owner.id, ownerName: owner.label || owner.id, reinforcementType: layout.arrangement || "longitudinal", diameter: diameter, spacing: layout.spacing?.value ?? null, cover: layout.cover?.value ?? null, barMark: layout.barMark || null, quantity: layout.quantity ?? (layout.bars?.length || 1), provenance: bar.provenance || layout.provenance || null, layoutIndex });
}
function addCylinderBetween(group, elements, a, b, diameter, id, metadata = {}, MATERIALS) {
  const direction = b.clone().sub(a), length = direction.length();
  if (length <= 0) return;
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(diameter / 2, diameter / 2, length, 8), MATERIALS.rebar);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  addMesh(group, elements, mesh, id, "reinforcement", id, metadata);
}
function addDerivedStirrups(group, elements, item, scale, category, MATERIALS) {
  const layouts = item.reinforcement || [];
  for (let li = 0; li < layouts.length; li++) {
    const layout = layouts[li];
    if (!["closed_stirrups", "links"].includes(layout.arrangement) || layout.bars?.length ||
      !layout.spacing?.value || !layout.cover?.value || !layout.barDiameter?.value) continue;
    const start = category === "columns" ? vec(item.base, scale) : vec(item.start, scale);
    const end = category === "columns" ? vec(item.top, scale) : vec(item.end, scale);
    const axis = end.clone().sub(start);
    const length = axis.length();
    if (length <= 0) continue;
    axis.normalize();
    const width = item.width.value * scale;
    const depth = (category === "columns" ? item.depth.value : item.depth.value) * scale;
    const cover = layout.cover.value * scale + layout.barDiameter.value * scale / 2;
    const halfW = width / 2 - cover, halfD = depth / 2 - cover;
    const diameter = layout.barDiameter.value * scale;
    const spacing = layout.spacing.value * scale;
    if (halfW <= 0 || halfD <= 0 || spacing <= 0) continue;
    let u, v;
    if (category === "columns") {
      u = new THREE.Vector3(1, 0, 0);
      u.addScaledVector(axis, -u.dot(axis)).normalize();
      if (u.lengthSq() < 0.5) u.set(0, 0, 1);
      v = new THREE.Vector3().crossVectors(axis, u).normalize();
    } else {
      u = new THREE.Vector3(-axis.z, 0, axis.x).normalize();
      if (u.lengthSq() < 0.5) u.set(1, 0, 0);
      v = new THREE.Vector3().crossVectors(axis, u).normalize();
    }
    const count = Math.max(1, Math.floor((length - 2 * cover) / spacing) + 1);
    for (let n = 0; n < count; n++) {
      const center = start.clone().addScaledVector(axis, Math.min(cover + n * spacing, length - cover));
      const corners = [
        center.clone().addScaledVector(u, -halfW).addScaledVector(v, -halfD),
        center.clone().addScaledVector(u, halfW).addScaledVector(v, -halfD),
        center.clone().addScaledVector(u, halfW).addScaledVector(v, halfD),
        center.clone().addScaledVector(u, -halfW).addScaledVector(v, halfD)
      ];
      for (let side = 0; side < 4; side++) addCylinderBetween(group, elements, corners[side], corners[(side + 1) % 4], diameter, `${item.id}-stirrup-${li}-${n}-${side}`, {
        ownerId: item.id, ownerName: item.label || item.id, reinforcementType: layout.arrangement,
        diameter: layout.barDiameter.value, spacing: layout.spacing.value, cover: layout.cover.value,
        quantity: count, barMark: layout.barMark || null, stirrupIndex: n + 1, provenance: layout.provenance || null, layoutIndex: li
      }, MATERIALS);
    }
  }
}
function addDerivedLongitudinalBars(group, elements, item, layout, scale, category, layoutIndex, MATERIALS) {
  if (layout.arrangement !== "longitudinal" || layout.bars?.length ||
      !layout.barDiameter?.value || !layout.spacing?.value || !layout.cover?.value ||
      !item.width?.value || !item.depth?.value) return;
  const start = category === "columns" ? vec(item.base, scale) : vec(item.start, scale);
  const end = category === "columns" ? vec(item.top, scale) : vec(item.end, scale);
  const axis = end.clone().sub(start);
  const memberLength = axis.length();
  if (!(memberLength > 0)) return;
  axis.normalize();
  let u;
  if (category === "columns") {
    u = new THREE.Vector3(1, 0, 0);
    u.addScaledVector(axis, -u.dot(axis)).normalize();
    if (u.lengthSq() < 0.5) u.set(0, 0, 1);
  } else {
    u = new THREE.Vector3(-axis.z, 0, axis.x).normalize();
    if (u.lengthSq() < 0.5) u.set(1, 0, 0);
  }
  const v = new THREE.Vector3().crossVectors(axis, u).normalize();
  const diameter = layout.barDiameter.value * scale;
  const spacing = layout.spacing.value * scale;
  const cover = layout.cover.value * scale + diameter / 2;
  const halfW = item.width.value * scale / 2 - cover;
  const halfD = item.depth.value * scale / 2 - cover;
  if (halfW <= 0 || halfD <= 0 || memberLength <= cover * 2 || spacing <= 0) return;
  const corners = [[-halfW,-halfD],[halfW,-halfD],[halfW,halfD],[-halfW,halfD]];
  const positions = [];
  for (let side = 0; side < 4 && positions.length < 240; side++) {
    const a = corners[side], b = corners[(side + 1) % 4];
    const sideLength = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const segments = Math.max(1, Math.ceil(sideLength / spacing));
    for (let n = 0; n < segments && positions.length < 240; n++) {
      const t = n / segments;
      positions.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  positions.forEach(([offsetU, offsetV], index) => {
    const offset = u.clone().multiplyScalar(offsetU).addScaledVector(v, offsetV);
    const a = start.clone().addScaledVector(axis, cover).add(offset);
    const b = end.clone().addScaledVector(axis, -cover).add(offset);
    addCylinderBetween(group, elements, a, b, diameter, item.id + "-longitudinal-" + layoutIndex + "-" + index, {
      ownerId: item.id, ownerName: item.label || item.id, reinforcementType: "longitudinal",
      diameter: layout.barDiameter.value, spacing: layout.spacing.value, cover: layout.cover.value,
      barMark: layout.barMark || null, provenance: layout.provenance || null, layoutIndex
    }, MATERIALS);
  });
}

function addReinforcement(group, elements, item, scale, MATERIALS) {
  (item.reinforcement || []).forEach((layout, i) => (layout.bars || []).forEach((bar, j) =>
    addRod(group, elements, bar, scale, `${item.id}-rebar-${i}-${j}`, item, layout, i, MATERIALS)));
}
function addSlab(group, elements, slab, scale, levelElevation, MATERIALS) {
  const y = (slab.elevation?.value ?? levelElevation) * scale;
  const shape = new THREE.Shape();
  slab.outline.forEach((p, i) => i ? shape.lineTo(p.x * scale, p.z * scale) : shape.moveTo(p.x * scale, p.z * scale));
  shape.closePath();
  for (const opening of slab.openings || []) {
    const hole = new THREE.Path();
    opening.outline.forEach((p, i) => i ? hole.lineTo(p.x * scale, p.z * scale) : hole.moveTo(p.x * scale, p.z * scale));
    hole.closePath();
    shape.holes.push(hole);
  }
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: slab.thickness.value * scale, bevelEnabled: false });
  geometry.rotateX(Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, MATERIALS.slab);
  mesh.position.y = y;
  addMesh(group, elements, mesh, slab.id, "slabs", slab.label);
}
function polygonIntersections(outline, axis, fixed) {
  const values = [];
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    const aFixed = axis === "x" ? a.z : a.x;
    const bFixed = axis === "x" ? b.z : b.x;
    if ((aFixed <= fixed && bFixed > fixed) || (bFixed <= fixed && aFixed > fixed)) {
      const t = (fixed - aFixed) / (bFixed - aFixed);
      values.push(axis === "x" ? a.x + (b.x - a.x) * t : a.z + (b.z - a.z) * t);
    }
  }
  return values.sort((a, b) => a - b);
}

function addDerivedSlabReinforcement(group, elements, slab, layout, scale, topElevation, layoutIndex, MATERIALS) {
  if (!["mesh", "top", "bottom", "both_faces", "longitudinal", "transverse"].includes(layout.arrangement) || layout.bars?.length || !layout.barDiameter?.value || !layout.spacing?.value || !layout.cover?.value) return;
  const diameter = layout.barDiameter.value * scale;
  const spacing = layout.spacing.value * scale;
  const cover = layout.cover.value * scale + diameter / 2;
  if (!(diameter > 0 && spacing > 0) || slab.outline?.length < 3) return;
  const outline = slab.outline;
  const minX = Math.min(...outline.map(point => point.x)) * scale;
  const maxX = Math.max(...outline.map(point => point.x)) * scale;
  const minZ = Math.min(...outline.map(point => point.z)) * scale;
  const maxZ = Math.max(...outline.map(point => point.z)) * scale;
  const arrangement = layout.arrangement;
  const faces = arrangement === "top" ? ["top"] : arrangement === "bottom" ? ["bottom"] : ["longitudinal", "transverse"].includes(arrangement) ? ["top"] : ["top", "bottom"];
  const directions = arrangement === "longitudinal" ? ["x"] : arrangement === "transverse" ? ["z"] : ["x", "z"];
  const slabTop = topElevation * scale;
  const slabThickness = slab.thickness.value * scale;
  let generated = 0;
  for (const face of faces) {
    const y = face === "top" ? slabTop - cover : slabTop - slabThickness + cover;
    for (const axis of directions) {
      const fixedMin = axis === "x" ? minZ + cover : minX + cover;
      const fixedMax = axis === "x" ? maxZ - cover : maxX - cover;
      for (let fixed = fixedMin; fixed <= fixedMax + 1e-6 && generated < 1200; fixed += spacing) {
        const intersections = polygonIntersections(outline, axis, fixed / scale);
        for (let i = 0; i + 1 < intersections.length && generated < 1200; i += 2) {
          const startValue = intersections[i] * scale + cover;
          const endValue = intersections[i + 1] * scale - cover;
          if (endValue - startValue <= diameter * 2) continue;
          const a = axis === "x" ? new THREE.Vector3(startValue, y, fixed) : new THREE.Vector3(fixed, y, startValue);
          const b = axis === "x" ? new THREE.Vector3(endValue, y, fixed) : new THREE.Vector3(fixed, y, endValue);
          addCylinderBetween(group, elements, a, b, diameter, slab.id + "-derived-" + layoutIndex + "-" + face + "-" + axis + "-" + generated, {
            ownerId: slab.id, ownerName: slab.label || slab.id, reinforcementType: arrangement,
            diameter: layout.barDiameter.value, spacing: layout.spacing.value, cover: layout.cover.value,
            barMark: layout.barMark || null, provenance: layout.provenance || null, layoutIndex, face
          }, MATERIALS);
          generated++;
        }
      }
    }
  }
}

function addRoof(group, elements, roof, scale, MATERIALS) {
  const shape = new THREE.Shape();
  roof.outline.forEach((point, index) => index
    ? shape.lineTo(point.x * scale, point.z * scale)
    : shape.moveTo(point.x * scale, point.z * scale));
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape, 32);
  const xs = roof.outline.map(point => point.x * scale);
  const zs = roof.outline.map(point => point.z * scale);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const centerX = (minX + maxX) / 2, centerZ = (minZ + maxZ) / 2;
  const rise = roof.type === "flat" ? 0 : (roof.rise?.value || 0) * scale;
  const base = roof.eavesElevation.value * scale;
  const roofHeightAt = (x, z) => {
    let factor = 0;
    if (roof.type === "gable") {
      const span = roof.ridgeAxis === "x" ? maxZ - minZ : maxX - minX;
      const offset = roof.ridgeAxis === "x" ? Math.abs(z - centerZ) : Math.abs(x - centerX);
      factor = span > 0 ? Math.max(0, 1 - offset / (span / 2)) : 0;
    } else if (roof.type === "hip") {
      const nx = maxX > minX ? Math.abs((x - centerX) / ((maxX - minX) / 2)) : 0;
      const nz = maxZ > minZ ? Math.abs((z - centerZ) / ((maxZ - minZ) / 2)) : 0;
      factor = Math.max(0, 1 - Math.max(nx, nz));
    } else if (roof.type === "shed") {
      const t = roof.ridgeAxis === "x"
        ? (maxZ > minZ ? (z - minZ) / (maxZ - minZ) : 0)
        : (maxX > minX ? (x - minX) / (maxX - minX) : 0);
      factor = Math.max(0, Math.min(1, t));
    }
    return base + rise * factor;
  };
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), z = positions.getY(i);
    positions.setXYZ(i, x, roofHeightAt(x, z), z);
  }
  geometry.computeVertexNormals();
  addMesh(group, elements, new THREE.Mesh(geometry, MATERIALS.roof), roof.id, "roofs", roof.label || roof.type + " roof", {
    roofType: roof.type, ridgeAxis: roof.ridgeAxis || null, rise: roof.rise?.value ?? 0,
    thickness: roof.thickness?.value ?? null, provenance: roof.provenance
  });

  // A roof is a physical shell, not a zero-thickness coloured plane. Render
  // the documented thickness where available; otherwise use a clearly
  // display-only fascia depth without changing the engineering model data.
  const displayThickness = roof.thickness?.value > 0 ? roof.thickness.value * scale : 0.12 * scale;
  const underside = geometry.clone();
  const undersidePositions = underside.attributes.position;
  for (let i = 0; i < undersidePositions.count; i++) undersidePositions.setY(i, undersidePositions.getY(i) - displayThickness);
  underside.computeVertexNormals();
  addMesh(group, elements, new THREE.Mesh(underside, MATERIALS.roof), roof.id + "-underside", "roofs", "Roof soffit", {
    ownerId: roof.id, displayOnlyThickness: !(roof.thickness?.value > 0)
  });

  roof.outline.forEach((point, index) => {
    const next = roof.outline[(index + 1) % roof.outline.length];
    const ax = point.x * scale, az = point.z * scale;
    const bx = next.x * scale, bz = next.z * scale;
    const ay = roofHeightAt(ax, az), by = roofHeightAt(bx, bz);
    const edge = new THREE.BufferGeometry();
    edge.setAttribute("position", new THREE.Float32BufferAttribute([
      ax, ay, az, bx, by, bz,
      bx, by - displayThickness, bz, ax, ay - displayThickness, az
    ], 3));
    edge.setIndex([0, 1, 2, 0, 2, 3]);
    edge.computeVertexNormals();
    addMesh(group, elements, new THREE.Mesh(edge, MATERIALS.beam), roof.id + "-fascia-" + index, "roofs", "Roof fascia", { ownerId: roof.id });
  });
}

function createFromSpec(scene, model, MATERIALS) {
  const group = new THREE.Group(); group.name = `BuildLens: ${model.name}`; scene.add(group);
  const elements = [], s = UNIT_SCALE[model.units] || 1;
  const levels = new Map((model.levels || []).map(level => [level.id, level.elevation.value]));
  for (const c of model.structure.columns || []) {
    const a = vec(c.base, s), b = vec(c.top, s), d = b.clone().sub(a), length = d.length();
    if (!length) continue;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(length, c.width.value * s, c.depth.value * s), MATERIALS.concrete);
    mesh.position.copy(a).add(b).multiplyScalar(.5);
    mesh.quaternion.copy(orientedMemberQuaternion(d, new THREE.Vector3(1, 0, 0)));
    addMesh(group,elements,mesh,c.id,"columns",c.label); addReinforcement(group,elements,c,s,MATERIALS); (c.reinforcement || []).forEach((layout,index) => addDerivedLongitudinalBars(group,elements,c,layout,s,"columns",index,MATERIALS)); addDerivedStirrups(group,elements,c,s,"columns",MATERIALS);
  }
  for (const b of model.structure.beams || []) {
    const a=vec(b.start,s), z=vec(b.end,s), d=z.clone().sub(a), length=d.length(); if(!length) continue;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(length, b.depth.value * s, b.width.value * s), MATERIALS.beam);
    mesh.position.copy(a).add(z).multiplyScalar(.5);
    mesh.quaternion.copy(orientedMemberQuaternion(d, new THREE.Vector3(0, 1, 0)));
    addMesh(group,elements,mesh,b.id,"beams",b.label); addReinforcement(group,elements,b,s,MATERIALS); (b.reinforcement || []).forEach((layout,index) => addDerivedLongitudinalBars(group,elements,b,layout,s,"beams",index,MATERIALS)); addDerivedStirrups(group,elements,b,s,"beams",MATERIALS);
  }
  for (const slab of model.structure.slabs || []) {
    const elevation = slab.elevation?.value ?? (slab.levelId && levels.has(slab.levelId) ? levels.get(slab.levelId) : 0);
    addSlab(group,elements,slab,s,elevation,MATERIALS);
    addReinforcement(group,elements,slab,s,MATERIALS);
    (slab.reinforcement || []).forEach((layout, index) => addDerivedSlabReinforcement(group, elements, slab, layout, s, slab.elevation?.value ?? elevation, index, MATERIALS));
  }
  for (const roof of model.structure.roofs || []) addRoof(group, elements, roof, s, MATERIALS);
  for (const stair of model.structure.stairs || []) {
    const start = vec(stair.start, s), end = vec(stair.end, s);
    const run = new THREE.Vector3(end.x - start.x, 0, end.z - start.z);
    const runLength = run.length(), rise = end.y - start.y;
    if (runLength <= 0 || rise <= 0 || !Number.isInteger(stair.steps) || stair.steps < 1) continue;
    const direction = run.normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const widthAxis = new THREE.Vector3().crossVectors(up, direction).normalize();
    const tread = runLength / stair.steps;
    const riser = rise / stair.steps;
    const stairRotation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(widthAxis, up, direction));
    for (let step = 0; step < stair.steps; step++) {
      const center = start.clone().addScaledVector(direction, (step + 0.5) * tread);
      center.y = start.y + (step + 0.5) * riser;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(stair.width.value * s, riser, tread), MATERIALS.concrete);
      mesh.position.copy(center);
      mesh.quaternion.copy(stairRotation);
      addMesh(group, elements, mesh, `${stair.id}-step-${step + 1}`, "stairs", stair.label || stair.id, { stepNumber: step + 1, totalSteps: stair.steps });
    }
    addReinforcement(group, elements, stair, s, MATERIALS);
  }
  for (const w of model.structure.walls || []) {
    const a = vec(w.start, s), b = vec(w.end, s);
    const horizontal = new THREE.Vector3(b.x - a.x, 0, b.z - a.z);
    const length = horizontal.length();
    if (length <= 1e-8) continue;
    const direction = horizontal.normalize();
    const normal = new THREE.Vector3(-direction.z, 0, direction.x);
    const wallRotation = orientedMemberQuaternion(direction, new THREE.Vector3(0, 1, 0));
    const h = w.height.value * s, thickness = w.thickness.value * s;
    const baseYAt = distance => a.y + (b.y - a.y) * (distance / length);
    const openings = (w.openings || []).map(o => {
      const start = Math.max(0, o.positionFromStart.value * s);
      const end = Math.min(length, (o.positionFromStart.value + o.width.value) * s);
      const bottom = Math.max(0, Math.min(h, (o.sillHeight?.value || 0) * s));
      const top = Math.max(bottom, Math.min(h, bottom + o.height.value * s));
      return { id: o.id, kind: o.kind || "opening", start, end, bottom, top };
    }).filter(o => o.end - o.start > 1e-5 && o.top - o.bottom > 1e-5).sort((x, y) => x.start - y.start);
    const boundaries = [0, length, ...openings.flatMap(o => [o.start, o.end])]
      .sort((x, y) => x - y)
      .filter((value, index, values) => index === 0 || Math.abs(value - values[index - 1]) > 1e-6);
    const addWallPart = (id, from, to, bottom, top) => {
      if (to - from <= 1e-5 || top - bottom <= 1e-5) return;
      const geometry = createWallPrismGeometry(a, direction, normal, from, to, bottom, top, thickness, baseYAt);
      const mesh = new THREE.Mesh(geometry, MATERIALS.wall);
      addMesh(group, elements, mesh, id, "walls", w.label, { wallId: w.id });
    };
    for (let i = 0; i < boundaries.length - 1; i++) {
      const from = boundaries[i], to = boundaries[i + 1], mid = (from + to) / 2;
      const opening = openings.find(o => mid > o.start && mid < o.end);
      if (!opening) addWallPart(`${w.id}-segment-${i}`, from, to, 0, h);
      else {
        addWallPart(`${w.id}-sill-${i}`, from, to, 0, opening.bottom);
        addWallPart(`${w.id}-lintel-${i}`, from, to, opening.top, h);
      }
    }
    openings.forEach((opening, index) => {
      const width = opening.end - opening.start;
      const openingHeight = opening.top - opening.bottom;
      if (width <= 0 || openingHeight <= 0) return;
      const offsetFromStart = (opening.start + opening.end) / 2;
      const center = a.clone().addScaledVector(direction, offsetFromStart);
      center.y = baseYAt(offsetFromStart) + opening.bottom + openingHeight / 2;
      const frameWidth = Math.min(0.045 * s, width / 10, openingHeight / 10);
      const frameDepth = Math.max(0.025 * s, thickness * 0.18);
      const addFramePart = (id, along, vertical, positionAlong, positionY) => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(along, vertical, frameDepth), MATERIALS.frame);
        mesh.position.copy(a).addScaledVector(direction, positionAlong);
        mesh.position.y = baseYAt(positionAlong) + positionY;
        mesh.quaternion.copy(wallRotation);
        addMesh(group, elements, mesh, id, "openings", opening.kind === "door" ? "Door frame" : "Window frame", { ownerId: w.id, openingId: opening.id, openingKind: opening.kind });
      };
      const sill = opening.bottom, head = opening.top;
      addFramePart(`${w.id}-opening-${index}-left`, frameWidth, openingHeight, opening.start + frameWidth / 2, sill + openingHeight / 2);
      addFramePart(`${w.id}-opening-${index}-right`, frameWidth, openingHeight, opening.end - frameWidth / 2, sill + openingHeight / 2);
      addFramePart(`${w.id}-opening-${index}-head`, width, frameWidth, offsetFromStart, head - frameWidth / 2);
      if (sill > 0.08 * s) addFramePart(`${w.id}-opening-${index}-sill`, width, frameWidth, offsetFromStart, sill - frameWidth / 2);
      if (opening.kind === "window") {
        const glass = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.01 * s, width - 2 * frameWidth), Math.max(0.01 * s, openingHeight - 2 * frameWidth), Math.max(0.008 * s, frameDepth * 0.18)), MATERIALS.glazing);
        glass.position.copy(center); glass.quaternion.copy(wallRotation);
        addMesh(group, elements, glass, `${w.id}-opening-${index}-glass`, "openings", "Window glazing", { ownerId: w.id, openingId: opening.id, openingKind: "window" });
      } else if (opening.kind === "door") {
        const door = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.01 * s, width - frameWidth), Math.max(0.01 * s, openingHeight - frameWidth), Math.max(0.018 * s, frameDepth * 0.28)), MATERIALS.door);
        door.position.copy(center); door.quaternion.copy(wallRotation);
        addMesh(group, elements, door, `${w.id}-opening-${index}-door`, "openings", "Door leaf", { ownerId: w.id, openingId: opening.id, openingKind: "door" });
      }
    });
    addReinforcement(group, elements, w, s, MATERIALS);
  }
  for (const f of model.structure.foundations || []) {
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(f.width.value*s,f.depth.value*s,f.length.value*s),MATERIALS.foundation);
    mesh.position.copy(vec(f.center,s));
    addMesh(group,elements,mesh,f.id,"foundations",f.label); addReinforcement(group,elements,f,s,MATERIALS);
  }
  const bounds = new THREE.Box3().setFromObject(group);
  const boundsSize = bounds.isEmpty() ? new THREE.Vector3(10, 5, 10) : bounds.getSize(new THREE.Vector3());
  const boundsCenter = bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3());
  const extentX = Math.max(boundsSize.x * 0.65, 5);
  const extentZ = Math.max(boundsSize.z * 0.65, 5);
  const gridY = Math.min(0, bounds.min.y - 0.02);
  for (const gridLine of model.grids || []) {
    const p = gridLine.position * s;
    const points = gridLine.axis === "x"
      ? [new THREE.Vector3(p, gridY, boundsCenter.z - extentZ), new THREE.Vector3(p, gridY, boundsCenter.z + extentZ)]
      : [new THREE.Vector3(boundsCenter.x - extentX, gridY, p), new THREE.Vector3(boundsCenter.x + extentX, gridY, p)];
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: "#78838b", transparent: true, opacity: 0.72 })
    );
    addMesh(group, elements, line, gridLine.id, "grids", gridLine.label);
  }
  const connectivity = analyzeStructuralConnectivity(model);
  return { building: group, elements, connectivity };
}

// Landing-page demonstration geometry. Reinforcement is illustrative only,
// not a design or a substitute for project-specific bar schedules.
function createSample(scene, MATERIALS) {
  const group = new THREE.Group();
  group.name = "BuildLens illustrative sample";
  scene.add(group);
  const elements = [];
  const add = (id, size, pos, material, category) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...pos);
    addMesh(group, elements, mesh, id, category);
  };
  const addBar = (a, b, id, owner, type, diameter = 0.016) => {
    addCylinderBetween(
      group, elements, new THREE.Vector3(...a), new THREE.Vector3(...b),
      diameter, id,
      { ownerId: owner, ownerName: owner, reinforcementType: type, provenance: "illustrative demo geometry" },
      MATERIALS
    );
  };
  const xs = [-3, 0, 3], zs = [-2.5, 0, 2.5], ys = [0.18, 3.18, 6.18];

  ys.forEach((y, level) => {
    add("Sample slab " + level, [6.7, 0.16, 5.7], [0, y, 0], MATERIALS.slab, "slabs");

    // Two orthogonal layers of slab bars, placed just inside the top face.
    for (let z = -2.5; z <= 2.501; z += 0.35) {
      addBar([-3.1, y + 0.045, z], [3.1, y + 0.045, z],
        `sample-slab-${level}-x-${z.toFixed(2)}`, "Sample slab " + level, "slab-main");
    }
    for (let x = -3; x <= 3.001; x += 0.35) {
      addBar([x, y + 0.025, -2.6], [x, y + 0.025, 2.6],
        `sample-slab-${level}-z-${x.toFixed(2)}`, "Sample slab " + level, "slab-distribution");
    }

    if (level < 2) {
      xs.forEach(x => zs.forEach(z => {
        const owner = `Sample column ${level}-${x}-${z}`;
        const base = y + 0.12, top = ys[level + 1] - 0.12;
        add(owner, [0.24, 2.84, 0.24], [x, y + 1.5, z], MATERIALS.concrete, "columns");

        // Four longitudinal bars and rectangular ties.
        for (const dx of [-0.065, 0.065]) for (const dz of [-0.065, 0.065]) {
          addBar([x + dx, base, z + dz], [x + dx, top, z + dz],
            owner + "-main-" + dx + "-" + dz, owner, "column-longitudinal", 0.014);
        }
        for (let tieY = base + 0.12, tie = 0; tieY < top; tieY += 0.3, tie++) {
          const left = x - 0.075, right = x + 0.075, front = z - 0.075, back = z + 0.075;
          const corners = [[left,tieY,front],[right,tieY,front],[right,tieY,back],[left,tieY,back]];
          corners.forEach((point, side) => addBar(point, corners[(side + 1) % 4],
            owner + "-tie-" + tie + "-" + side, owner, "column-tie", 0.009));
        }
      }));

      // Beam longitudinal bars and regularly spaced illustrative links.
      zs.forEach(z => {
        const owner = `Sample beam X ${level}-${z}`;
        add(owner, [6, 0.22, 0.22], [0, ys[level + 1] - 0.19, z], MATERIALS.beam, "beams");
        for (const dz of [-0.065, 0.065]) for (const dy of [-0.055, 0.055]) {
          addBar([-2.85, ys[level + 1] - 0.19 + dy, z + dz],
            [2.85, ys[level + 1] - 0.19 + dy, z + dz],
            owner + "-main-" + dy + "-" + dz, owner, "beam-longitudinal", 0.014);
        }
        for (let x = -2.7, link = 0; x <= 2.701; x += 0.3, link++) {
          const y0 = ys[level + 1] - 0.19, z0 = z;
          const corners = [[x,y0-0.065,z0-0.065],[x,y0+0.065,z0-0.065],[x,y0+0.065,z0+0.065],[x,y0-0.065,z0+0.065]];
          corners.forEach((point, side) => addBar(point, corners[(side + 1) % 4],
            owner + "-link-" + link + "-" + side, owner, "beam-link", 0.009));
        }
      });
      xs.forEach(x => {
        const owner = `Sample beam Z ${level}-${x}`;
        add(owner, [0.22, 0.22, 5], [x, ys[level + 1] - 0.19, 0], MATERIALS.beam, "beams");
        for (const dx of [-0.065, 0.065]) for (const dy of [-0.055, 0.055]) {
          addBar([x + dx, ys[level + 1] - 0.19 + dy, -2.35],
            [x + dx, ys[level + 1] - 0.19 + dy, 2.35],
            owner + "-main-" + dy + "-" + dx, owner, "beam-longitudinal", 0.014);
        }
        for (let z = -2.2, link = 0; z <= 2.201; z += 0.3, link++) {
          const y0 = ys[level + 1] - 0.19, x0 = x;
          const corners = [[x0-0.065,y0-0.065,z],[x0+0.065,y0-0.065,z],[x0+0.065,y0+0.065,z],[x0-0.065,y0+0.065,z]];
          corners.forEach((point, side) => addBar(point, corners[(side + 1) % 4],
            owner + "-link-" + link + "-" + side, owner, "beam-link", 0.009));
        }
      });
    }
  });

  xs.forEach(x => zs.forEach(z =>
    add("Sample footing", [0.95, 0.35, 0.95], [x, -0.42, z], MATERIALS.foundation, "foundations")
  ));
  return { building: group, elements };
}
export function createBuildingModel(scene, modelSpec = null) {
  // Materials belong to this viewport instance. A chat preview can now be
  // unmounted without disposing materials used by the primary canvas.
  const materials = createMaterials();
  return modelSpec ? createFromSpec(scene, modelSpec, materials) : createSample(scene, materials);
}
