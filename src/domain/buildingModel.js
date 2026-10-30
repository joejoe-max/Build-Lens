/**
 * BuildLens canonical building model contract.
 *
 * This is the shared boundary between document interpretation, validated
 * engineering data, model-generation tools, and the Three.js renderer.
 * All lengths are expressed in the model's declared unit.
 */

export const MODEL_SCHEMA_VERSION = "1.0.0";

const provenance = {
  type: "object",
  additionalProperties: false,
  required: ["status"],
  properties: {
    status: {
      type: "string",
      enum: ["specified", "calculated", "inferred", "assumed", "missing", "unverified"],
    },
    source: { type: "string" },
    sourcePage: { type: "integer", minimum: 1 },
    calculation: { type: "string" },
    note: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
};

const point2 = {
  type: "object",
  additionalProperties: false,
  required: ["x", "z"],
  properties: { x: { type: "number" }, z: { type: "number" } },
};

const point3 = {
  type: "object",
  additionalProperties: false,
  required: ["x", "y", "z"],
  properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } },
};

const dimension = {
  type: "object",
  additionalProperties: false,
  required: ["value", "provenance"],
  properties: {
    value: { type: "number", exclusiveMinimum: 0 },
    provenance,
  },
};

const signedMeasurement = {
  type: "object",
  additionalProperties: false,
  required: ["value", "provenance"],
  properties: { value: { type: "number" }, provenance },
};

const reinforcement = {
  type: "object",
  additionalProperties: false,
  properties: {
    arrangement: { type: "string", enum: ["longitudinal", "transverse", "top", "bottom", "both_faces", "closed_stirrups", "links", "mesh", "custom"] },
    barDiameter: dimension,
    quantity: { type: "integer", minimum: 1 },
    spacing: dimension,
    cover: dimension,
    grade: { type: "string" },
    bars: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "start", "end", "diameter", "provenance"],
        properties: {
          id: { type: "string", minLength: 1 },
          start: point3,
          end: point3,
          diameter: dimension,
          provenance,
        },
      },
    },
    notes: { type: "string" },
    provenance,
  },
};

const memberBase = {
  id: { type: "string", minLength: 1 },
  label: { type: "string" },
  material: { type: "string" },
  levelId: { type: "string" },
  provenance,
  reinforcement: { type: "array", items: reinforcement },
};

const structuralSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    columns: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["id", "base", "top", "width", "depth", "provenance"],
        properties: {
          ...memberBase, base: point3, top: point3, width: dimension, depth: dimension,
          gridRefs: { type: "object", additionalProperties: false, properties: { x: { type: "string" }, z: { type: "string" } } },
        },
      },
    },
    beams: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["id", "start", "end", "width", "depth", "provenance"],
        properties: {
          ...memberBase, start: point3, end: point3, width: dimension, depth: dimension,
          startSupportId: { type: "string" }, endSupportId: { type: "string" },
        },
      },
    },
    slabs: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["id", "outline", "thickness", "provenance"],
        properties: {
          ...memberBase,
          outline: { type: "array", minItems: 3, items: point2 },
          elevation: dimension,
          thickness: dimension,
        },
      },
    },
    walls: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["id", "start", "end", "height", "thickness", "provenance"],
        properties: {
          ...memberBase, start: point3, end: point3, height: dimension, thickness: dimension,
          openings: { type: "array", items: { type: "object", required: ["id", "width", "height"], properties: { id: { type: "string" }, width: dimension, height: dimension, sillHeight: dimension } } },
        },
      },
    },
    foundations: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["id", "type", "center", "width", "length", "depth", "provenance"],
        properties: {
          ...memberBase,
          type: { type: "string", enum: ["isolated", "strip", "combined", "raft", "pile_cap", "pile", "other"] },
          center: point3, width: dimension, length: dimension, depth: dimension,
          topElevation: signedMeasurement,
          supportedElementIds: { type: "array", items: { type: "string" } },
          pileCount: { type: "integer", minimum: 1 },
        },
      },
    },
  },
};

export const BUILDING_MODEL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "id", "name", "units", "levels", "grids", "structure", "metadata"],
  properties: {
    schemaVersion: { type: "string", const: MODEL_SCHEMA_VERSION },
    id: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1 },
    units: { type: "string", enum: ["m", "mm", "cm", "ft"] },
    metadata: {
      type: "object", additionalProperties: false,
      required: ["createdFrom"],
      properties: {
        createdFrom: { type: "array", items: { type: "string" } },
        projectDescription: { type: "string" },
        designCode: { type: "string" },
        concreteGrade: { type: "string" },
        reinforcementGrade: { type: "string" },
        generalNotes: { type: "array", items: { type: "string" } },
      },
    },
    overallDimensions: {
      type: "object", additionalProperties: false,
      properties: { x: dimension, y: dimension, z: dimension },
    },
    levels: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["id", "name", "elevation", "provenance"],
        properties: {
          id: { type: "string", minLength: 1 }, name: { type: "string" },
          elevation: signedMeasurement, usage: { type: "string" }, provenance,
        },
      },
    },
    grids: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["id", "axis", "label", "position", "provenance"],
        properties: {
          id: { type: "string", minLength: 1 },
          axis: { type: "string", enum: ["x", "z"] },
          label: { type: "string" },
          position: { type: "number" },
          provenance,
        },
      },
    },
    structure: structuralSchema,
  },
};

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const isFiniteNumber = value => typeof value === "number" && Number.isFinite(value);

function checkPoint(point, dimensions, path, errors) {
  if (!isObject(point)) {
    errors.push(`${path} must be an object`);
    return;
  }
  for (const key of dimensions) {
    if (!isFiniteNumber(point[key])) errors.push(`${path}.${key} must be a finite number`);
  }
}

function checkProvenance(value, path, errors) {
  if (!isObject(value) || !["specified", "calculated", "inferred", "assumed", "missing", "unverified"].includes(value.status)) {
    errors.push(`${path} must include a valid provenance.status`);
    return;
  }
  if (value.confidence !== undefined && (!isFiniteNumber(value.confidence) || value.confidence < 0 || value.confidence > 1)) {
    errors.push(`${path}.confidence must be between 0 and 1`);
  }
}

function checkSignedMeasurement(value, path, errors) {
  if (!isObject(value) || !isFiniteNumber(value.value)) {
    errors.push(`${path}.value must be a finite number`);
    return;
  }
  checkProvenance(value.provenance, `${path}.provenance`, errors);
}

function checkDimension(value, path, errors) {
  if (!isObject(value) || !isFiniteNumber(value.value) || value.value <= 0) {
    errors.push(`${path}.value must be a positive finite number`);
    return;
  }
  checkProvenance(value.provenance, `${path}.provenance`, errors);
}

/**
 * Runtime guard for data arriving from AI tool calls or persisted project data.
 * It intentionally performs structural validation, not engineering design checks.
 */
export function validateBuildingModel(model) {
  const errors = [];
  if (!isObject(model)) return { valid: false, errors: ["Model must be an object"] };

  for (const key of ["schemaVersion", "id", "name", "units"]) {
    if (typeof model[key] !== "string" || !model[key]) errors.push(`${key} is required`);
  }
  if (model.schemaVersion !== MODEL_SCHEMA_VERSION) errors.push(`schemaVersion must be ${MODEL_SCHEMA_VERSION}`);
  if (!["m", "mm", "cm", "ft"].includes(model.units)) errors.push("units must be m, mm, cm, or ft");

  if (!Array.isArray(model.levels) || model.levels.length === 0) errors.push("At least one level is required");
  else model.levels.forEach((level, i) => {
    const path = `levels[${i}]`;
    if (!isObject(level) || !level.id || !level.name) errors.push(`${path} requires id and name`);
    else {
      checkSignedMeasurement(level.elevation, `${path}.elevation`, errors);
      checkProvenance(level.provenance, `${path}.provenance`, errors);
    }
  });

  if (!Array.isArray(model.grids)) errors.push("grids must be an array");
  else model.grids.forEach((grid, i) => {
    if (!isObject(grid) || !grid.id || !["x", "z"].includes(grid.axis) || typeof grid.label !== "string" || !isFiniteNumber(grid.position)) {
      errors.push(`grids[${i}] has invalid id, axis, label, or position`);
    } else checkProvenance(grid.provenance, `grids[${i}].provenance`, errors);
  });

  if (!isObject(model.metadata) || !Array.isArray(model.metadata.createdFrom)) errors.push("metadata.createdFrom must be an array");
  if (!isObject(model.structure)) errors.push("structure must be an object");
  else {
    for (const category of ["columns", "beams", "slabs", "walls", "foundations"]) {
      const items = model.structure[category] ?? [];
      if (!Array.isArray(items)) {
        errors.push(`structure.${category} must be an array`);
        continue;
      }
      const ids = new Set();
      items.forEach((item, i) => {
        const path = `structure.${category}[${i}]`;
        if (!isObject(item) || typeof item.id !== "string" || !item.id.trim()) {
          errors.push(`${path}.id is required`);
          return;
        }
        if (ids.has(item.id)) errors.push(`${path}.id duplicates another ${category} id`);
        ids.add(item.id);
        checkProvenance(item.provenance, `${path}.provenance`, errors);

        if (category === "columns") {
          checkPoint(item.base, ["x", "y", "z"], `${path}.base`, errors);
          checkPoint(item.top, ["x", "y", "z"], `${path}.top`, errors);
          checkDimension(item.width, `${path}.width`, errors);
          checkDimension(item.depth, `${path}.depth`, errors);
        } else if (category === "beams") {
          checkPoint(item.start, ["x", "y", "z"], `${path}.start`, errors);
          checkPoint(item.end, ["x", "y", "z"], `${path}.end`, errors);
          checkDimension(item.width, `${path}.width`, errors);
          checkDimension(item.depth, `${path}.depth`, errors);
        } else if (category === "slabs") {
          if (!Array.isArray(item.outline) || item.outline.length < 3) errors.push(`${path}.outline needs at least three plan points`);
          else item.outline.forEach((point, j) => checkPoint(point, ["x", "z"], `${path}.outline[${j}]`, errors));
          checkDimension(item.thickness, `${path}.thickness`, errors);
          if (item.elevation) checkSignedMeasurement(item.elevation, `${path}.elevation`, errors);
        } else if (category === "walls") {
          checkPoint(item.start, ["x", "y", "z"], `${path}.start`, errors);
          checkPoint(item.end, ["x", "y", "z"], `${path}.end`, errors);
          checkDimension(item.height, `${path}.height`, errors);
          checkDimension(item.thickness, `${path}.thickness`, errors);
        } else if (category === "foundations") {
          checkPoint(item.center, ["x", "y", "z"], `${path}.center`, errors);
          for (const key of ["width", "length", "depth"]) checkDimension(item[key], `${path}.${key}`, errors);
        }

        if (item.reinforcement !== undefined) {
          if (!Array.isArray(item.reinforcement)) errors.push(`${path}.reinforcement must be an array`);
          else item.reinforcement.forEach((layout, j) => {
            const rp = `${path}.reinforcement[${j}]`;
            if (!isObject(layout)) errors.push(`${rp} must be an object`);
            else {
              for (const key of ["barDiameter", "spacing", "cover"]) if (layout[key]) checkDimension(layout[key], `${rp}.${key}`, errors);
              if (layout.quantity !== undefined && (!Number.isInteger(layout.quantity) || layout.quantity < 1)) errors.push(`${rp}.quantity must be a positive integer`);
              if (layout.bars !== undefined) {
                if (!Array.isArray(layout.bars)) errors.push(`${rp}.bars must be an array`);
                else layout.bars.forEach((bar, k) => {
                  const bp = `${rp}.bars[${k}]`;
                  if (!isObject(bar) || typeof bar.id !== "string" || !bar.id.trim()) errors.push(`${bp}.id is required`);
                  else {
                    checkPoint(bar.start, ["x", "y", "z"], `${bp}.start`, errors);
                    checkPoint(bar.end, ["x", "y", "z"], `${bp}.end`, errors);
                    checkDimension(bar.diameter, `${bp}.diameter`, errors);
                    checkProvenance(bar.provenance, `${bp}.provenance`, errors);
                  }
                });
              }
              if (layout.provenance) checkProvenance(layout.provenance, `${rp}.provenance`, errors);
            }
          });
        }
      });
    }
  }

  // Cross-reference checks: optional references are validated when supplied.
  if (isObject(model.structure)) {
    const elements = Object.values(model.structure).flatMap(items => Array.isArray(items) ? items : []);
    const byId = new Map(elements.map(item => [item.id, item]));
    const grids = new Map((model.grids || []).map(grid => [grid.id, grid]));
    (model.structure.columns || []).forEach((column, i) => {
      const refs = column.gridRefs;
      if (!refs) return;
      for (const axis of ["x", "z"]) {
        if (!refs[axis]) continue;
        const grid = grids.get(refs[axis]);
        if (!grid || grid.axis !== axis) errors.push(`structure.columns[${i}].gridRefs.${axis} must reference an existing ${axis}-axis grid`);
        else {
          const coordinate = axis === "x" ? column.base?.x : column.base?.z;
          if (isFiniteNumber(coordinate) && Math.abs(coordinate - grid.position) > 0.001) {
            errors.push(`structure.columns[${i}] does not align with grid ${grid.label} on axis ${axis}`);
          }
        }
      }
    });
    (model.structure.beams || []).forEach((beam, i) => {
      for (const [endName, refName] of [["start", "startSupportId"], ["end", "endSupportId"]]) {
        const supportId = beam[refName];
        if (!supportId) continue;
        const support = byId.get(supportId);
        if (!support) {
          errors.push(`structure.beams[${i}].${refName} references an unknown element`);
          continue;
        }
        const point = beam[endName];
        const candidates = support.base && support.top ? [support.base, support.top] : support.center ? [support.center] : [];
        if (candidates.length && !candidates.some(candidate =>
          Math.hypot(candidate.x - point.x, candidate.y - point.y, candidate.z - point.z) <= 0.01
        )) errors.push(`structure.beams[${i}].${endName} does not meet support ${supportId}`);
      }
    });
    (model.structure.foundations || []).forEach((foundation, i) => {
      for (const id of foundation.supportedElementIds || []) {
        const supported = byId.get(id);
        if (!supported) errors.push(`structure.foundations[${i}] references unknown supported element ${id}`);
        else if (supported.base && foundation.center && isObject(foundation.width) && isObject(foundation.length) &&
          isFiniteNumber(foundation.width.value) && isFiniteNumber(foundation.length.value) &&
          Math.hypot(supported.base.x - foundation.center.x, supported.base.z - foundation.center.z) >
          Math.max(foundation.width.value, foundation.length.value) / 2 + 0.01) {
          errors.push(`structure.foundations[${i}] is not beneath supported element ${id}`);
        }
      }
    });
  }

  return { valid: errors.length === 0, errors };
}

export function analyzeStructuralConnectivity(model) {
  if (!isObject(model) || !isObject(model.structure)) return { connections: [], warnings: [] };
  const { columns = [], beams = [], foundations = [] } = model.structure;
  const tolerance = ({ m: 0.01, cm: 1, mm: 10, ft: 0.03 })[model.units] || 0.01;
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const connections = [];
  const warnings = [];
  const supports = [...columns, ...beams];
  for (const beam of beams) {
    for (const end of ["start", "end"]) {
      const point = beam[end];
      const explicitId = beam[end === "start" ? "startSupportId" : "endSupportId"];
      const candidates = supports.filter(item => item.id !== beam.id).flatMap(item => {
        const points = item.base && item.top ? [{ point: item.base, end: "base" }, { point: item.top, end: "top" }]
          : item.start && item.end ? [{ point: item.start, end: "start" }, { point: item.end, end: "end" }] : [];
        return points.map(candidate => ({ elementId: item.id, point: candidate.point, end: candidate.end, distance: distance(point, candidate.point) }));
      }).sort((a, b) => a.distance - b.distance);
      const match = explicitId ? candidates.find(item => item.elementId === explicitId && item.distance <= tolerance) : candidates[0];
      if (match && match.distance <= tolerance) connections.push({ beamId: beam.id, beamEnd: end, supportId: match.elementId, supportEnd: match.end, distance: match.distance, status: explicitId ? "referenced" : "coordinate_match" });
      else warnings.push({ code: "unconnected_beam_end", elementId: beam.id, endpoint: end, message: `Beam ${beam.id} ${end} does not meet a modeled column or beam endpoint within ${tolerance} ${model.units}.` });
    }
  }
  for (const column of columns) {
    const foundation = foundations.find(item =>
      (item.supportedElementIds || []).includes(column.id) ||
      (Math.abs(item.center.x - column.base.x) <= item.width.value / 2 + tolerance &&
       Math.abs(item.center.z - column.base.z) <= item.length.value / 2 + tolerance &&
       Math.abs((item.center.y + item.depth.value / 2) - column.base.y) <= tolerance * 2)
    );
    if (foundation) connections.push({ columnId: column.id, foundationId: foundation.id, status: "foundation_support" });
    else warnings.push({ code: "column_without_foundation", elementId: column.id, message: `No matching foundation is modeled beneath column ${column.id}.` });
  }
  return { connections, warnings };
}

export function createEmptyBuildingModel({ id = "building-1", name = "Untitled building", units = "m" } = {}) {
  return {
    schemaVersion: MODEL_SCHEMA_VERSION,
    id,
    name,
    units,
    metadata: { createdFrom: [], generalNotes: [] },
    overallDimensions: {},
    levels: [{
      id: "level-0",
      name: "Ground level",
      elevation: { value: 0, provenance: { status: "assumed", note: "Placeholder only; replace with the drawing datum." } },
      provenance: { status: "assumed", note: "Placeholder level so a new project has a valid starting structure." },
    }],
    grids: [],
    structure: { columns: [], beams: [], slabs: [], walls: [], foundations: [] },
  };
}
