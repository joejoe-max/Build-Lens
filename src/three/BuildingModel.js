import * as THREE from "three";
import { analyzeStructuralConnectivity } from "../domain/buildingModel.js";

const MATERIALS = {
  concrete: new THREE.MeshStandardMaterial({ color: "#a9b0b5", roughness: 0.82 }),
  slab: new THREE.MeshStandardMaterial({ color: "#737d85", roughness: 0.9, side: THREE.DoubleSide }),
  beam: new THREE.MeshStandardMaterial({ color: "#c5cbd0", roughness: 0.76 }),
  wall: new THREE.MeshStandardMaterial({ color: "#89939a", roughness: 0.88, transparent: true, opacity: 0.82 }),
  foundation: new THREE.MeshStandardMaterial({ color: "#69747c", roughness: 0.92 }),
  rebar: new THREE.MeshStandardMaterial({ color: "#c18b58", metalness: 0.62, roughness: 0.38 })
};
const UNIT_SCALE = { m: 1, mm: 0.001, cm: 0.01, ft: 0.3048 };
const vec = (p, s) => new THREE.Vector3(p.x * s, p.y * s, p.z * s);

function addMesh(group, elements, mesh, id, category, label) {
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.userData = { id, name: label || id, category };
  group.add(mesh); elements.push(mesh); return mesh;
}
function addRod(group, elements, bar, scale, fallbackId) {
  const a = vec(bar.start, scale), b = vec(bar.end, scale);
  const direction = b.clone().sub(a), length = direction.length();
  const diameter = bar.diameter?.value;
  if (!Number.isFinite(length) || length <= 0 || !Number.isFinite(diameter) || diameter <= 0) return;
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(diameter * scale / 2, diameter * scale / 2, length, 10), MATERIALS.rebar);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  addMesh(group, elements, mesh, bar.id || fallbackId, "reinforcement");
}
function addCylinderBetween(group, elements, a, b, diameter, id) {
  const direction = b.clone().sub(a), length = direction.length();
  if (length <= 0) return;
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(diameter / 2, diameter / 2, length, 8), MATERIALS.rebar);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  addMesh(group, elements, mesh, id, "reinforcement");
}
function addDerivedStirrups(group, elements, item, scale, category) {
  const layouts = item.reinforcement || [];
  for (let li = 0; li < layouts.length; li++) {
    const layout = layouts[li];
    if (!["closed_stirrups", "links"].includes(layout.arrangement) ||
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
      for (let side = 0; side < 4; side++) addCylinderBetween(group, elements, corners[side], corners[(side + 1) % 4], diameter, `${item.id}-stirrup-${li}-${n}-${side}`);
    }
  }
}
function addReinforcement(group, elements, item, scale) {
  (item.reinforcement || []).forEach((layout, i) => (layout.bars || []).forEach((bar, j) => addRod(group, elements, bar, scale, `${item.id}-rebar-${i}-${j}`)));
}
function addSlab(group, elements, slab, scale, levelElevation) {
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
function createFromSpec(scene, model) {
  const group = new THREE.Group(); group.name = `BuildLens: ${model.name}`; scene.add(group);
  const elements = [], s = UNIT_SCALE[model.units] || 1;
  const levels = new Map((model.levels || []).map(level => [level.id, level.elevation.value]));
  for (const c of model.structure.columns || []) {
    const a = vec(c.base, s), b = vec(c.top, s), d = b.clone().sub(a), length = d.length();
    if (!length) continue;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(c.width.value*s, length, c.depth.value*s), MATERIALS.concrete);
    mesh.position.copy(a).add(b).multiplyScalar(.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), d.normalize());
    addMesh(group,elements,mesh,c.id,"columns",c.label); addReinforcement(group,elements,c,s); addDerivedStirrups(group,elements,c,s,"columns");
  }
  for (const b of model.structure.beams || []) {
    const a=vec(b.start,s), z=vec(b.end,s), d=z.clone().sub(a), length=d.length(); if(!length) continue;
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(length,b.depth.value*s,b.width.value*s),MATERIALS.beam);
    mesh.position.copy(a).add(z).multiplyScalar(.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1,0,0),d.normalize());
    addMesh(group,elements,mesh,b.id,"beams",b.label); addReinforcement(group,elements,b,s); addDerivedStirrups(group,elements,b,s,"beams");
  }
  for (const slab of model.structure.slabs || []) {
    const elevation=slab.levelId && levels.has(slab.levelId) ? levels.get(slab.levelId) : (levels.values().next().value ?? 0);
    addSlab(group,elements,slab,s,elevation); addReinforcement(group,elements,slab,s);
  }
  for (const stair of model.structure.stairs || []) {
    const start = vec(stair.start, s), end = vec(stair.end, s);
    const run = new THREE.Vector3(end.x - start.x, 0, end.z - start.z);
    const runLength = run.length(), rise = end.y - start.y;
    if (runLength <= 0 || rise <= 0 || !Number.isInteger(stair.steps) || stair.steps < 1) continue;
    const direction = run.normalize();
    const widthAxis = new THREE.Vector3(-direction.z, 0, direction.x);
    const tread = runLength / stair.steps;
    for (let step = 0; step < stair.steps; step++) {
      const top = rise * (step + 1) / stair.steps;
      const center = start.clone().addScaledVector(direction, (step + 0.5) * tread);
      center.y += top / 2;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(stair.width.value * s, top, tread), MATERIALS.concrete);
      mesh.position.copy(center);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
      addMesh(group, elements, mesh, `${stair.id}-step-${step + 1}`, "stairs", stair.label || stair.id);
    }
    addReinforcement(group, elements, stair, s);
  }
  for (const w of model.structure.walls || []) {
    const a=vec(w.start,s), b=vec(w.end,s), d=b.clone().sub(a), length=d.length(); if(!length) continue;
    const h=w.height.value*s, thickness=w.thickness.value*s, direction=d.clone().normalize();
    const openings=(w.openings||[]).map(o=>({start:o.positionFromStart.value*s,end:(o.positionFromStart.value+o.width.value)*s,bottom:(o.sillHeight?.value||0)*s,top:((o.sillHeight?.value||0)+o.height.value)*s})).sort((x,y)=>x.start-y.start);
    const boundaries=[0,length,...openings.flatMap(o=>[o.start,o.end])].filter(v=>v>=0&&v<=length).sort((x,y)=>x-y).filter((v,i,a)=>i===0||Math.abs(v-a[i-1])>1e-6);
    const addWallPart=(id,from,to,bottom,top)=>{
      if(to-from<=1e-5||top-bottom<=1e-5)return;
      const mesh=new THREE.Mesh(new THREE.BoxGeometry(to-from,top-bottom,thickness),MATERIALS.wall);
      mesh.position.copy(a).addScaledVector(direction,(from+to)/2);mesh.position.y+=bottom+(top-bottom)/2;
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1,0,0),direction);
      addMesh(group,elements,mesh,id,"walls",w.label);
    };
    for(let i=0;i<boundaries.length-1;i++){
      const from=boundaries[i],to=boundaries[i+1],mid=(from+to)/2;
      const opening=openings.find(o=>mid>o.start&&mid<o.end);
      if(!opening)addWallPart(`${w.id}-segment-${i}`,from,to,0,h);
      else {addWallPart(`${w.id}-sill-${i}`,from,to,0,opening.bottom);addWallPart(`${w.id}-lintel-${i}`,from,to,opening.top,h);}
    }
    addReinforcement(group,elements,w,s);
  }
  for (const f of model.structure.foundations || []) {
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(f.width.value*s,f.depth.value*s,f.length.value*s),MATERIALS.foundation);
    mesh.position.copy(vec(f.center,s));
    addMesh(group,elements,mesh,f.id,"foundations",f.label); addReinforcement(group,elements,f,s);
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

// Placeholder only: shown until a validated project-specific model is supplied.
function createSample(scene) {
  const group=new THREE.Group(); scene.add(group); const elements=[];
  const add=(id,size,pos,material,category)=>{const mesh=new THREE.Mesh(new THREE.BoxGeometry(...size),material);mesh.position.set(...pos);addMesh(group,elements,mesh,id,category);};
  const xs=[-3,0,3],zs=[-2.5,0,2.5],ys=[.18,3.18,6.18];
  ys.forEach((y,i)=>{add("Sample slab "+i,[6.7,.16,5.7],[0,y,0],MATERIALS.slab,"slabs");if(i<2){xs.forEach(x=>zs.forEach(z=>add("Sample column",[.24,2.84,.24],[x,y+1.5,z],MATERIALS.concrete,"columns")));zs.forEach(z=>add("Sample beam",[6,.22,.22],[0,ys[i+1]-.19,z],MATERIALS.beam,"beams"));xs.forEach(x=>add("Sample beam",[.22,.22,5],[x,ys[i+1]-.19,0],MATERIALS.beam,"beams"));}});
  xs.forEach(x=>zs.forEach(z=>add("Sample footing",[.95,.35,.95],[x,-.42,z],MATERIALS.foundation,"foundations")));
  return {building:group,elements};
}
export function createBuildingModel(scene, modelSpec = null) {
  return modelSpec ? createFromSpec(scene, modelSpec) : createSample(scene);
}
