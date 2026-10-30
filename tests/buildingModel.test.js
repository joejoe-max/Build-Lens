import test from "node:test";
import assert from "node:assert/strict";
import {
  createEmptyBuildingModel,
  validateBuildingModel,
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
