import * as THREE from "three";

// Demonstration geometry only. This function does not read or interpret drawings.
export function createBuildingModel(scene) {
  const building = new THREE.Group();
  scene.add(building);
  const materials = {
    concrete: new THREE.MeshStandardMaterial({ color: "#a9b0b5", roughness: 0.82, metalness: 0.04 }),
    // Opaque slabs prevent overlapping surfaces and colours showing through during rotation.
    slab: new THREE.MeshStandardMaterial({ color: "#737d85", roughness: 0.9, metalness: 0, transparent: false, opacity: 1, depthWrite: true }),
    beam: new THREE.MeshStandardMaterial({ color: "#d2d7db", roughness: 0.7 }),
    rebar: new THREE.MeshStandardMaterial({ color: "#c18b58", metalness: 0.62, roughness: 0.38 }),
    ground: new THREE.MeshStandardMaterial({ color: "#282d31", roughness: 1 }),
    foundation: new THREE.MeshStandardMaterial({ color: "#69747c", roughness: 0.92 })
  };
  const elements = [];
  const addBox = (name, size, pos, material, category = "structure") => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...pos);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { name, category };
    building.add(mesh);
    elements.push(mesh);
    return mesh;
  };

  addBox("Ground plane", [16, 0.08, 13], [0, -0.18, 0], materials.ground, "ground");
  const xs = [-3, 0, 3];
  const zs = [-2.5, 0, 2.5];
  const floors = [0.18, 3.18, 6.18];
  floors.forEach((y, floorIndex) => {
    addBox(`Floor slab ${floorIndex + 1}`, [6.7, 0.16, 5.7], [0, y, 0], materials.slab, "slab");
    if (floorIndex < floors.length - 1) {
      // Fit each column segment between slab faces rather than through the slabs.
      const floorSpacing = floors[floorIndex + 1] - y;
      const columnHeight = floorSpacing - 0.16;
      const columnCenterY = y + floorSpacing / 2;
      xs.forEach((x, xi) => zs.forEach((z, zi) => {
        addBox(`Column ${floorIndex + 1}-${xi + 1}${zi + 1}`, [0.24, columnHeight, 0.24], [x, columnCenterY, z], materials.concrete, "column");
      }));
      // Beam tops meet the underside of the next slab; opaque surfaces avoid colour bleed.
      const beamCenterY = floors[floorIndex + 1] - 0.08 - 0.11;
      zs.forEach((z, i) => addBox(`Beam X-${floorIndex + 1}-${i + 1}`, [6, 0.22, 0.22], [0, beamCenterY, z], materials.beam, "beam"));
      xs.forEach((x, i) => addBox(`Beam Z-${floorIndex + 1}-${i + 1}`, [0.22, 0.22, 5], [x, beamCenterY, 0], materials.beam, "beam"));
    }
  });
  xs.forEach((x, xi) => zs.forEach((z, zi) => {
    addBox(`Illustrative footing ${xi + 1}-${zi + 1}`, [0.95, 0.35, 0.95], [x, -0.42, z], materials.foundation, "foundation");
  }));
  for (let i = 0; i < 5; i++) {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 5.2, 8), materials.rebar);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(-2.7 + i * 1.35, 0.34, 0);
    bar.userData = { name: "Illustrative slab reinforcement", category: "rebar" };
    building.add(bar);
    elements.push(bar);
  }
  return { building, elements };
}