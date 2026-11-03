import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createBuildingModel } from "../src/three/BuildingModel.js";
import { detectDrawingConflicts } from "../src/domain/drawingCoordination.js";
import {
  createEmptyBuildingModel,
  validateBuildingModel,
  analyzeStructuralConnectivity,
} from "../src/domain/buildingModel.js";

test("empty project model satisfies the canonical contract", () => {
  const model = createEmptyBuildingModel();
  assert.deepEqual(validateBuildingModel(model), { valid: true, errors: [] });
});

test("level elevations may be zero or negative", () => {
  const model = createEmptyBuildingModel();
  model.levels[0].elevation.value = 0;
  assert.equal(validateBuildingModel(model).valid, true);
  model.levels[0].elevation.value = -2.4;
  assert.equal(validateBuildingModel(model).valid, true);
});

test("rejects a beam with missing dimensions and invalid provenance", () => {
  const model = createEmptyBuildingModel();
  model.structure.beams.push({
    id: "B1",
    start: { x: 0, y: 3, z: 0 },
    end: { x: 4, y: 3, z: 0 },
    width: { value: 0, provenance: { status: "specified" } },
    depth: { value: 0.3, provenance: { status: "unknown" } },
    provenance: { status: "specified" },
  });
  const result = validateBuildingModel(model);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.includes("width.value")));
  assert.ok(result.errors.some(error => error.includes("depth.provenance")));
});

test("rejects duplicate IDs within a structural category", () => {
  const model = createEmptyBuildingModel();
  const column = {
    id: "C1",
    base: { x: 0, y: 0, z: 0 },
    top: { x: 0, y: 3, z: 0 },
    width: { value: 0.3, provenance: { status: "specified" } },
    depth: { value: 0.3, provenance: { status: "specified" } },
    provenance: { status: "specified" },
  };
  model.structure.columns.push(column, { ...column });
  const result = validateBuildingModel(model);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.includes("duplicates")));
});

test("rejects non-finite coordinates", () => {
  const model = createEmptyBuildingModel();
  model.grids.push({
    id: "grid-x-a",
    axis: "x",
    label: "A",
    position: Number.NaN,
    provenance: { status: "specified" },
  });
  assert.equal(validateBuildingModel(model).valid, false);
});

test("validates pitched roof geometry and required rise metadata", () => {
  const model = createEmptyBuildingModel();
  const provenance = { status: "specified" };
  model.structure.roofs.push({
    id: "R1",
    type: "gable",
    outline: [{ x: 0, z: 0 }, { x: 8, z: 0 }, { x: 8, z: 6 }, { x: 0, z: 6 }],
    eavesElevation: { value: 6, provenance },
    rise: { value: 2, provenance },
    ridgeAxis: "x",
    provenance
  });
  assert.equal(validateBuildingModel(model).valid, true);
  delete model.structure.roofs[0].rise;
  assert.equal(validateBuildingModel(model).valid, false);
});

test("flags columns offset from supplied grids and reinforcement without a bar mark", () => {
  const model = createEmptyBuildingModel();
  const provenance = { status: "specified" };
  model.grids = [
    { id: "GX1", axis: "x", label: "1", position: 0, provenance },
    { id: "GZ1", axis: "z", label: "A", position: 0, provenance }
  ];
  model.structure.columns.push({
    id: "C1",
    base: { x: 0.5, y: 0, z: 0.5 },
    top: { x: 0.5, y: 3, z: 0.5 },
    width: { value: 0.3, provenance },
    depth: { value: 0.3, provenance },
    provenance,
    reinforcement: [{
      arrangement: "longitudinal",
      barDiameter: { value: 0.016, provenance },
      spacing: { value: 0.15, provenance },
      cover: { value: 0.04, provenance },
      provenance
    }]
  });
  model.structure.columns.push({
    id: "C2",
    base: { x: 0.52, y: 0, z: 0.52 },
    top: { x: 0.52, y: 3, z: 0.52 },
    width: { value: 0.3, provenance },
    depth: { value: 0.3, provenance },
    provenance
  });
  assert.equal(validateBuildingModel(model).valid, true);
  const warnings = analyzeStructuralConnectivity(model).warnings;
  assert.ok(warnings.some(warning => warning.code === "off_grid_column" && warning.elementId === "C1"));
  assert.ok(warnings.some(warning => warning.code === "missing_bar_mark" && warning.elementId === "C1"));
  assert.ok(warnings.some(warning => warning.code === "overlapping_columns" && warning.elementId === "C1"));
});

test("renderer creates roof meshes and derives slab reinforcement from documented layout", () => {
  const model = createEmptyBuildingModel();
  const provenance = { status: "specified" };
  model.structure.roofs.push({
    id: "R-TEST",
    type: "gable",
    outline: [{ x: 0, z: 0 }, { x: 8, z: 0 }, { x: 8, z: 6 }, { x: 0, z: 6 }],
    eavesElevation: { value: 6, provenance },
    rise: { value: 2, provenance },
    ridgeAxis: "x",
    provenance
  });
  model.structure.beams.push({
    id: "B-TEST",
    start: { x: 0, y: 4, z: 0 },
    end: { x: 4, y: 4, z: 0 },
    width: { value: 0.3, provenance },
    depth: { value: 0.5, provenance },
    provenance,
    reinforcement: [{
      arrangement: "longitudinal",
      barDiameter: { value: 0.016, provenance },
      spacing: { value: 0.15, provenance },
      cover: { value: 0.04, provenance },
      barMark: "B1",
      provenance
    }]
  });
  model.structure.slabs.push({
    id: "S-TEST",
    outline: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }, { x: 0, z: 4 }],
    elevation: { value: 3, provenance },
    thickness: { value: 0.15, provenance },
    provenance,
    reinforcement: [{
      arrangement: "mesh",
      barDiameter: { value: 0.012, provenance },
      spacing: { value: 0.2, provenance },
      cover: { value: 0.025, provenance },
      barMark: "A1",
      provenance
    }]
  });
  const scene = new THREE.Scene();
  const result = createBuildingModel(scene, model);
  assert.ok(result.elements.some(element => element.userData.category === "roofs" && element.userData.id === "R-TEST"));
  assert.ok(result.elements.filter(element => element.userData.category === "reinforcement").length > 0);
  assert.ok(result.elements.some(element => element.userData.ownerId === "B-TEST" && element.userData.reinforcementType === "longitudinal"));
  scene.traverse(object => {
    object.geometry?.dispose?.();
    if (Array.isArray(object.material)) object.material.forEach(material => material.dispose());
    else object.material?.dispose?.();
  });
});

test("detects architectural versus structural dimensions that disagree", () => {
  const observations = [
    { sourceFile: "Architectural A101.pdf", sourcePage: 2, discipline: "architectural", category: "column", elementId: "C1", property: "width", value: 0.3, unit: "m", provenance: "specified", description: "Architectural column width" },
    { sourceFile: "Structural S201.pdf", sourcePage: 4, discipline: "structural", category: "column", elementId: "C1", property: "width", value: 350, unit: "mm", provenance: "specified", description: "Structural column width" }
  ];
  const conflicts = detectDrawingConflicts(observations);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].elementId, "C1");
  assert.equal(conflicts[0].category, "conflict");
});

test("does not flag matching architectural and structural dimensions", () => {
  const observations = [
    { sourceFile: "A101.pdf", sourcePage: 1, discipline: "architectural", category: "column", elementId: "C2", property: "width", value: 300, unit: "mm" },
    { sourceFile: "S201.pdf", sourcePage: 2, discipline: "structural", category: "column", elementId: "C2", property: "width", value: 0.3, unit: "m" }
  ];
  assert.equal(detectDrawingConflicts(observations).length, 0);
});
