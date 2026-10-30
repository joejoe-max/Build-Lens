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
function addReinforcement(group, elements, item, scale) {
  (item.reinforcement || []).forEach((layout, i) => (layout.bars || []).forEach((bar, j) => addRod(group, elements, bar, scale, `${item.id}-rebar-${i}-${j}`)));
}
function addSlab(group, elements, slab, scale, levelElevation) {
  const y = (slab.elevation?.value ?? levelElevation) * scale;
  const shape = new THREE.Shape();
  slab.outline.forEach((p, i) => i ? shape.lineTo(p.x * scale, p.z * scale) : shape.moveTo(p.x * scale, p.z * scale));
  shape.closePath();
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
    addMesh(group,elements,mesh,c.id,"columns",c.label); addReinforcement(group,elements,c,s);
  }
  for (const b of model.structure.beams || []) {
    const a=vec(b.start,s), z=vec(b.end,s), d=z.clone().sub(a), length=d.length(); if(!length) continue;
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(length,b.depth.value*s,b.width.value*s),MATERIALS.beam);
    mesh.position.copy(a).add(z).multiplyScalar(.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1,0,0),d.normalize());
    addMesh(group,elements,mesh,b.id,"beams",b.label); addReinforcement(group,elements,b,s);
  }
  for (const slab of model.structure.slabs || []) {
    const elevation=slab.levelId && levels.has(slab.levelId) ? levels.get(slab.levelId) : (levels.values().next().value ?? 0);
    addSlab(group,elements,slab,s,elevation); addReinforcement(group,elements,slab,s);
  }
  for (const w of model.structure.walls || []) {
    const a=vec(w.start,s), b=vec(w.end,s), d=b.clone().sub(a), length=d.length(); if(!length) continue;
    const h=w.height.value*s, mesh=new THREE.Mesh(new THREE.BoxGeometry(length,h,w.thickness.value*s),MATERIALS.wall);
    mesh.position.copy(a).add(b).multiplyScalar(.5); mesh.position.y+=h/2;
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1,0,0),d.normalize());
    addMesh(group,elements,mesh,w.id,"walls",w.label); addReinforcement(group,elements,w,s);
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
