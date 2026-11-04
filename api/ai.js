import { BUILDING_MODEL_SCHEMA, validateBuildingModel } from "../src/domain/buildingModel.js";
import { detectDrawingConflicts } from "../src/domain/drawingCoordination.js";

const SYSTEM_PROMPT = `You are BuildLens, an AI building reconstruction and engineering assistant.
Your primary job is to interpret the user's actual uploaded engineering documents and reconstruct the building they describe. Do not replace this with a generic sample building or a text-only description.
DOCUMENT INTERPRETATION WORKFLOW:
1. Inspect EVERY supplied project source on every request, including documents uploaded earlier in this workspace. The application resends the active project's saved document contents with each request; do not claim an earlier document is unavailable if it appears in the supplied attachment context. Use the filename and page number as source references. If the attachment context is genuinely absent or truncated, identify the missing filename rather than guessing.
2. For a new project, use add_reconstruction_chunk to send the complete canonical model in bounded sections so large drawings cannot truncate the JSON. Send core first (including observations), then columns, beams, slabs, walls, stairs, foundations and roofs, using [] for unsupported categories, then call finalize. Each section's data must be a valid JSON string. Never send the whole building in one oversized tool argument. Separate specified, calculated, inferred and unverified values.
3. Cross-check plans against sections, elevations, schedules and calculations. Prefer dimension strings and schedules over estimating from visual scale. If dimensions conflict, record both and flag the conflict; do not silently choose one.
4. Establish a coordinate convention and datum. Use x/z for plan coordinates and y for vertical elevations. Convert all values consistently into the model's declared units. State the coordinate origin and any orientation convention in model metadata/generalNotes.
5. Build a complete coordinated building, not just a skeletal frame. Establish all floor levels and floor-to-floor heights first. For a drawing set explicitly identified as G+1, two-storey or multi-storey, model a separate floor plate at each documented occupied floor elevation. Give every slab an explicit elevation or a correct levelId; a ground-floor slab at 0.000 m is valid and must not be omitted, and the upper floor slab must be at its own documented elevation rather than sharing the ground-floor elevation. Do not confuse foundation, ground floor, first floor and roof/eaves levels: only occupied floor plates count as storeys. Before finalizing, compare resolved slab elevations and ensure the upper-floor walls are located above the ground-floor slab. If the source does not support a second floor plate, report that evidence gap instead of fabricating one. Columns must be continuous vertical members from their documented base/support level to their documented top/support level; never model a full-storey column as a short stub at a beam joint. Their base.y and top.y must match the relevant level elevations and their x/z coordinates must match the column setting-out plan/grid. If a column schedule gives size, use it; do not shrink it to fit a symbol. Beams must span between the actual support centre-lines at the correct storey elevation, with section width/depth from schedules. Slabs must cover their actual floor plates and include openings. Read architectural plans/elevations as well as structural drawings: model the external envelope, every clearly dimensioned internal/partition wall, retaining walls, parapets and roof outline; do not leave walls empty merely because the structural framing sheets are more detailed. Walls should be continuous between the correct floor/roof levels and use documented thickness/height. Model doors and windows as explicit wall openings with kind=door or kind=window, opening width, height, position along wall and sill height. A window must have a nonzero sill; a door normally starts at floor level unless the drawing says otherwise. Model roof geometry, roof edges and stairs when supported by the drawings. Use member schedules to populate cross-sections. Use foundation plans/sections for below-ground geometry. Search every architectural plan, stair detail, section and elevation specifically for the staircase, including labels such as Stair UP/DN, stairwell dimensions, floor-to-floor rise, landings, arrows, riser/tread notes and stair schedules. If the plan/section provides a dimensioned flight run and width plus the documented floor-to-floor rise, derive the flight step count from the stated riser/tread schedule or clearly documented riser count, and populate stairs with start/end, width, thickness and steps. Model each flight separately where there are intermediate landings. Do not leave stairs empty merely because the stair schedule is on a different page; cross-reference all pages. If the drawings only label a stair but provide no defensible run, width or rise, leave geometry empty and record exactly which stair dimensions are missing. Preserve slab openings as polygon outlines and wall openings with position-from-start, width, height and sill height when stated. Where the drawing explicitly identifies grid references, store column.gridRefs.x and column.gridRefs.z using the matching grid IDs and ensure the coordinates agree with those grid positions. Where beam supports are identifiable, store startSupportId and endSupportId referencing actual column/beam IDs and make beam endpoint coordinates meet those support points. Where a foundation supports one or more columns, store supportedElementIds. Do not invent a support relationship simply because two objects appear visually close; use coordinate matches only as diagnostic candidates, not as confirmed design connections.
6. Read reinforcement callouts carefully: bar diameter, count, spacing, layers/faces, anchorage and cover. Preserve each documented reinforcement layout on its owning beam, column, slab, stair or foundation using arrangement, barDiameter, quantity, spacing, cover, grade, notes and provenance. Only create individual bars with explicit start/end coordinates when their positions can be derived from documented geometry and arrangement. For closed stirrups/links, the renderer may derive loops only when the member cross-section, member axis, bar diameter, spacing and cover are all documented. For slab mesh layouts, the renderer may derive orthogonal top/bottom bars from the slab outline only when arrangement, bar diameter, spacing and cover are all documented; choose top, bottom, both_faces or mesh to match the drawing. Otherwise preserve metadata without drawing guessed bars. Preserve barMark identifiers wherever shown; explicitly record missing bar marks as missing_information observations tied to the affected member. Never invent bar placement, hooks, anchorage or lap lengths.
7. For a new project, send core and each of the seven geometry categories through add_reconstruction_chunk, then finalize. Include columns, beams, slabs, walls, stairs, foundations and roofs, using empty arrays for unsupported categories. For an existing project, use update_building_model when revising the model. Never fill unknown dimensions with guesses.
8. Cross-check architectural drawings against structural drawings for column positions, grid alignment, wall locations, openings, floor levels, slab edges and roof outlines. When values conflict, record an explicit conflict observation tied to the affected element ID and both source pages; never silently select one drawing. Flag columns offset from supplied grid lines for review. Record missing reinforcement bar marks as missing-information observations, preserving the affected member ID so the workspace can highlight it.\n9. Explain what was successfully reconstructed, what remains missing, any drawing conflicts and which source pages support key dimensions.
INTERPRETATION RULES:
- Distinguish specified, calculated, inferred, assumed, missing and unverified values. Use source page and calculation notes for every engineering value.
- A 3D building output must represent the architectural building and its structural system. Do not submit a model consisting only of columns/beams/rebar when architectural plans, elevations or sections are supplied. Include all supportable walls, retaining walls, floor slabs, openings, roof and stairs. The structural-only view is a separate inspection mode, not the default building model.
- Before finalizing, perform a geometric sanity pass: compare every column height against adjacent floor elevations; compare beam endpoints against column/support locations; compare slab outlines against wall/grid boundaries; ensure wall elevations reach the correct floor/roof levels; verify roof outline and eaves/ridge elevations. A column shorter than a normal floor-to-floor height must be checked against the source; never silently accept a stub as a complete storey column. If the source cannot establish a missing coordinate or dimension, omit that uncertain member or mark it unverified and explain the gap, rather than inventing it.
- Never infer a dimension from image scale unless a reliable printed scale and image calibration are both available; if doing so, mark it inferred and explain the method.
- Do not treat a line weight, hatch, symbol or unclear callout as certain without corroborating evidence.
- If source pages are missing, cropped, blurry or unreadable, say exactly which information could not be read.
- Never invent engineering dimensions, reinforcement, loads, material strengths, design-code checks or calculation results.
- Do not certify structural safety. Distinguish drawing interpretation from verified engineering design.
- When presenting calculations, preserve every mathematical operator and unit. Never write adjacent numbers where a multiplication sign is intended. Use readable Markdown equations, for example: "1.35 × 5.75 + 1.5 × 2.00 = 10.7625 kN/m²". Use × for multiplication, / for division, parentheses for grouping, and Unicode superscripts (², ³) where useful.
- Present each material calculation with: **Purpose**, **Source inputs**, **Formula**, **Substitution**, **Result**, **Status**, and **Limitations**. Keep units attached to values and show conversions.
- Status labels must be precise: "Arithmetic checked" means only the arithmetic was independently recomputed; "Preliminary" means simplified assumptions were used; "Not checked" means no valid design check was completed; "Inconsistent" means source values conflict. Never label a structural member safe, adequate or code-compliant solely because an approximate hand calculation was performed.
- Separate source-specified values from assumptions. State the assumed support condition, load path, tributary width, effective depth, material factors and design code whenever they materially affect a result. If any are unknown, identify the result as illustrative/preliminary.
- For foundation recommendations, do not select a foundation type or size as "best" without geotechnical data, column actions, groundwater information, settlement assessment and applicable code checks. Give conditional options and list the missing evidence.
MODEL AND TOOL BEHAVIOUR:
Use add_reconstruction_chunk for a newly interpreted building. Return core, each geometry category and finalize in order. Use update_building_model when revising an existing model. Use set_model_visibility for display requests and inspect_model_element for element details. A successful model tool call updates project model data; the application handles Three.js rendering. Do not claim a viewport update unless confirmed.
Keep the answer practical. Summarize extracted evidence, model contents, uncertainties and next required information.`;

export const config = { maxDuration: 300 };

const provenance = {
  type: "object",
  additionalProperties: false,
  required: ["status"],
  properties: {
    status: { type: "string", enum: ["specified", "calculated", "inferred", "assumed", "missing", "unverified"] },
    source: { type: "string" },
    sourcePage: { type: "integer", minimum: 1 },
    calculation: { type: "string" },
    note: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 }
  }
};

const reconstructionTool = {
  type: "function",
  function: {
    name: "reconstruct_building",
    description: "MANDATORY for every first-time 3D reconstruction. Return one complete canonical BuildLens model as a JSON-encoded string in model, plus source observations as a separate JSON-encoded array in observations. Include every supported architectural and structural category. Every dimension must include provenance; coordinates use x/y/z. Do not invent geometry or dimensions. The canonical schema is supplied in the developer instructions.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["model", "observations"],
      properties: {
        model: { type: "string", minLength: 2, maxLength: 900000, description: "JSON-encoded canonical model object conforming to the schema in the function description." },
        observations: { type: "string", minLength: 2, maxLength: 250000, description: "JSON-encoded array of source observations. Use [] when none can be extracted." }
      }
    }
  }
};

const reconstructionChunkTool = {
  type: "function",
  function: {
    name: "add_reconstruction_chunk",
    description: "Build a large reconstruction in bounded JSON-string sections to prevent truncation. Call core first, then columns, beams, slabs, walls, stairs, foundations and roofs, then finalize. Each data argument must be valid JSON text. core is an object containing schemaVersion, id, name, units, levels, grids, metadata, optional overallDimensions, and observations (array). Each category is a JSON array. Use [] when a category is unsupported. Never omit a category. Do not send prose inside data.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["section", "data"],
      properties: {
        section: { type: "string", enum: ["core", "columns", "beams", "slabs", "walls", "stairs", "foundations", "roofs", "finalize"] },
        data: { type: "string", minLength: 2, maxLength: 120000, description: "A valid JSON-encoded object or array for this section. For finalize use {}." }
      }
    }
  }
};

const tools = [
  {
    type: "function",
    function: {
      name: "record_drawing_observations",
      description: "Record evidence extracted from uploaded drawings, schedules, sections and calculations before generating the 3D model. Include exact source filename, page and discipline (architectural or structural) for each observation. Record only values actually supported by the source. Use a separate observation for each important dimension, location, level, reinforcement callout or conflict. When the drawing discipline is clear, set discipline to architectural or structural so matching element/property values can be cross-checked automatically.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["observations"],
        properties: {
          observations: {
            type: "array",
            minItems: 1,
            maxItems: 250,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["sourceFile", "sourcePage", "category", "property", "value", "unit", "provenance", "description"],
              properties: {
                sourceFile: { type: "string", minLength: 1 },
                sourcePage: { type: "integer", minimum: 1 },
                discipline: { type: "string", enum: ["architectural", "structural", "general"] },
                category: { type: "string", enum: ["grid", "level", "column", "beam", "slab", "wall", "foundation", "reinforcement", "material", "load", "calculation", "general", "conflict", "missing_information"] },
                elementId: { type: "string" },
                property: { type: "string", minLength: 1 },
                value: { type: ["string", "number", "boolean"] },
                unit: { type: "string" },
                provenance: { type: "string", enum: ["specified", "calculated", "inferred", "assumed", "unverified", "missing"] },
                confidence: { type: "number", minimum: 0, maximum: 1 },
                description: { type: "string", minLength: 1 },
                sourceExcerpt: { type: "string" }
              }
            }
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "render_building_model",
      description: "Create the initial complete structured building model from the uploaded drawings and calculations. Call this when the user asks to generate or reconstruct the building in 3D. Include all supported foundations, columns, beams, slabs, walls, stairs, roofs, grids, levels and reinforcement. Do not invent missing data.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["model"],
        properties: { model: { type: "string", minLength: 2, maxLength: 900000, description: "The complete building model as a JSON-encoded string. Follow the application building-model schema described in the system instructions." } }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "update_building_model",
      description: "Replace the current structured building model with a revised complete model after a user asks for a design/model change or after interpreting additional documents. Preserve existing verified data unless the user explicitly changes it.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["model", "reason"],
        properties: {
          model: { type: "string", minLength: 2, maxLength: 900000, description: "The complete revised building model as a JSON-encoded string. Follow the application building-model schema described in the system instructions." },
          reason: { type: "string", minLength: 1 }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "set_model_opacity",
      description: "Set the opacity of a structural category in the active 3D workspace. Use when the user asks to make the structural frame more or less visible. Opacity is between 0.05 (very transparent) and 1 (fully opaque).",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["category", "opacity"],
        properties: {
          category: { type: "string", enum: ["columns", "beams", "slabs", "walls", "stairs", "foundations", "roofs", "reinforcement", "all"] },
          opacity: { type: "number", minimum: 0.05, maximum: 1 }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "set_model_visibility",
      description: "Show or hide one structural category or selected elements in the 3D viewport. Use for requests such as show only reinforcement, hide slabs, or isolate columns.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["category", "visible"],
        properties: {
          category: { type: "string", enum: ["foundations", "columns", "beams", "slabs", "walls", "stairs", "reinforcement", "grids", "all"] },
          visible: { type: "boolean" },
          elementIds: { type: "array", items: { type: "string" } }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "generate_reinforcement_layout",
      description: "Add a reinforcement layout to an existing beam, column, slab, wall, stair or foundation. Use only reinforcement details stated in the drawings or derived by an explicitly described calculation. Do not invent bar sizes, spacing, quantities or cover. Include provenance for every supplied value.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["elementId", "arrangement", "barDiameter", "provenance"],
        properties: {
          elementId: { type: "string", minLength: 1 },
          arrangement: { type: "string", enum: ["longitudinal", "transverse", "top", "bottom", "both_faces", "closed_stirrups", "links", "mesh", "custom"] },
          barMark: { type: "string" },
          barDiameter: { type: "object", additionalProperties: false, required: ["value", "provenance"], properties: { value: { type: "number", exclusiveMinimum: 0 }, provenance } },
          quantity: { type: "integer", minimum: 1 },
          spacing: { type: "object", additionalProperties: false, required: ["value", "provenance"], properties: { value: { type: "number", exclusiveMinimum: 0 }, provenance } },
          cover: { type: "object", additionalProperties: false, required: ["value", "provenance"], properties: { value: { type: "number", exclusiveMinimum: 0 }, provenance } },
          grade: { type: "string" },
          notes: { type: "string" },
          bars: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "start", "end", "diameter", "provenance"],
              properties: {
                id: { type: "string", minLength: 1 },
                start: { type: "object", additionalProperties: false, required: ["x", "y", "z"], properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } } },
                end: { type: "object", additionalProperties: false, required: ["x", "y", "z"], properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } } },
                diameter: { type: "object", additionalProperties: false, required: ["value", "provenance"], properties: { value: { type: "number", exclusiveMinimum: 0 }, provenance } },
                provenance
              }
            }
          },
          provenance
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "update_element_dimensions",
      description: "Update dimensions on one existing structural element when the user supplies corrected information or a verified calculation. Each changed dimension must include its value and provenance. Never change dimensions based on unsupported guesses.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["elementId", "dimensions"],
        properties: {
          elementId: { type: "string", minLength: 1 },
          dimensions: {
            type: "object",
            additionalProperties: false,
            properties: {
              width: { type: "object", required: ["value", "provenance"], properties: { value: { type: "number", exclusiveMinimum: 0 }, provenance } },
              depth: { type: "object", required: ["value", "provenance"], properties: { value: { type: "number", exclusiveMinimum: 0 }, provenance } },
              height: { type: "object", required: ["value", "provenance"], properties: { value: { type: "number", exclusiveMinimum: 0 }, provenance } },
              thickness: { type: "object", required: ["value", "provenance"], properties: { value: { type: "number", exclusiveMinimum: 0 }, provenance } },
              length: { type: "object", required: ["value", "provenance"], properties: { value: { type: "number", exclusiveMinimum: 0 }, provenance } }
            }
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "inspect_model_element",
      description: "Retrieve the stored dimensions, location, material and reinforcement information for a specific model element. Use when the user asks to inspect or explain a beam, column, slab, wall or foundation.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["elementId"],
        properties: { elementId: { type: "string", minLength: 1 } }
      }
    }
  }
];

// Preserve native structured arguments whenever the schema is within the provider's
// nesting limit. Only unusually deep schemas use the JSON-string adapter.
function schemaDepth(value) {
  if (!value || typeof value !== "object") return 0;
  return 1 + Math.max(0, ...Object.values(value).map(schemaDepth));
}
for (const tool of tools) {
  if (schemaDepth(tool.function.parameters) <= 9) continue;
  const original = tool.function.parameters;
  tool.function.description += "\n\nPass one argument named payload: a JSON-encoded string containing the complete arguments object. Payload shape: " + JSON.stringify(original);
  tool.function.parameters = {
    type: "object",
    additionalProperties: false,
    required: ["payload"],
    properties: {
      payload: { type: "string", minLength: 2, maxLength: 900000, description: "JSON-encoded string containing the function arguments described above." }
    }
  };
}

function countModelCategories(model) {
  const categories = ["columns", "beams", "slabs", "walls", "stairs", "foundations", "roofs"];
  return Object.fromEntries(categories.map(category => [category, Array.isArray(model?.structure?.[category]) ? model.structure[category].length : 0]));
}
function buildReconstructionAudit(rawModel, normalized, rejected, validation) {
  const submitted = countModelCategories(rawModel), retained = countModelCategories(normalized);
  const missingArchitectural = ["walls", "slabs", "roofs"].filter(category => retained[category] === 0);
  const levels = Array.isArray(normalized?.levels) ? normalized.levels : [];
  const levelElevations = new Map(levels.map(level => [level.id, level.elevation?.value]));
  const slabs = normalized?.structure?.slabs || [];
  const floorSlabElevations = slabs.map(slab => ({
    id: slab.id,
    elevation: Number.isFinite(slab.elevation?.value) ? slab.elevation.value
      : Number.isFinite(levelElevations.get(slab.levelId)) ? levelElevations.get(slab.levelId) : null,
    levelId: slab.levelId || null
  }));
  const distinctFloorSlabElevations = [...new Set(floorSlabElevations
    .map(item => item.elevation).filter(Number.isFinite).map(value => Number(value.toFixed(4))))].sort((a, b) => a - b);
  const storeyGeometryWarnings = [];
  const levelNames = levels.map(level => String(level.name || "").toLowerCase());
  const appearsMultiStorey = /first|upper|second|level 1|floor 1|1st|roof level/.test(levelNames.join(" "));
  if (appearsMultiStorey && distinctFloorSlabElevations.length < 2) {
    storeyGeometryWarnings.push("The source model appears to describe more than one occupied level, but the floor slabs do not resolve to two distinct elevations. Check slab.elevation and levelId before rendering.");
  }
  if (slabs.length > 1 && distinctFloorSlabElevations.length < 2) {
    storeyGeometryWarnings.push("Multiple slab records share one resolved elevation; they may overlap instead of forming separate floors.");
  }
  const points = [];
  const visit = value => {
    if (!value || typeof value !== "object") return;
    if (["x", "y", "z"].every(key => Number.isFinite(value[key]))) points.push(value);
    else Object.values(value).forEach(visit);
  };
  visit(normalized?.structure);
  const coordinateRanges = {};
  for (const axis of ["x", "y", "z"]) {
    const values = points.map(point => point[axis]);
    if (values.length) coordinateRanges[axis] = { min: Math.min(...values), max: Math.max(...values) };
  }
  return {
    submitted, retained, levels: levels.length, rejectedCount: rejected.length,
    rejected: rejected.slice(0, 40), missingArchitectural,
    floorSlabElevations, distinctFloorSlabElevations, storeyGeometryWarnings,
    wallOpenings: (normalized?.structure?.walls || []).reduce((sum, wall) => sum + (wall.openings?.length || 0), 0),
    slabOpenings: (normalized?.structure?.slabs || []).reduce((sum, slab) => sum + (slab.openings?.length || 0), 0),
    units: normalized?.units || null, coordinateRanges, validationErrors: (validation?.errors || []).slice(0, 30)
  };
}

function normalizeReconstructionModel(input) {
  const model = JSON.parse(JSON.stringify(input));
  const provenance = { status: "unverified", note: "Value supplied by the model without explicit provenance; verify against source drawings." };
  const measurementKeys = new Set(["width", "depth", "height", "thickness", "length", "spacing", "cover", "barDiameter", "diameter", "elevation", "eavesElevation", "rise", "positionFromStart", "sillHeight"]);
  const walk = value => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (measurementKeys.has(key) && typeof child === "number" && Number.isFinite(child)) {
        value[key] = { value: child, provenance: { ...provenance } };
      } else if (measurementKeys.has(key) && child && typeof child === "object" && Number.isFinite(child.value) && !child.provenance) {
        child.provenance = { ...provenance };
      } else walk(child);
    }
  };
  walk(model);
  model.schemaVersion = model.schemaVersion || "1.0.0";
  model.id = model.id || "reconstructed-building";
  model.name = model.name || "Reconstructed building";
  model.units = ["m", "mm", "cm", "ft"].includes(model.units) ? model.units : "m";
  model.metadata = model.metadata && typeof model.metadata === "object" ? model.metadata : {};
  model.metadata.createdFrom = Array.isArray(model.metadata.createdFrom) ? model.metadata.createdFrom : [];
  model.levels = Array.isArray(model.levels) && model.levels.length ? model.levels : [{
    id: "level-0", name: "Ground level",
    elevation: { value: 0, provenance: { status: "assumed", note: "Placeholder datum; confirm from drawings." } },
    provenance: { status: "assumed", note: "Placeholder level; confirm from drawings." }
  }];
  model.grids = Array.isArray(model.grids) ? model.grids : [];
  model.structure = model.structure && typeof model.structure === "object" ? model.structure : {};
  const categories = ["columns", "beams", "slabs", "walls", "stairs", "foundations", "roofs"];
  for (const category of categories) if (!Array.isArray(model.structure[category])) model.structure[category] = [];
  const ensureProvenance = item => {
    if (item && typeof item === "object" && !item.provenance) item.provenance = { ...provenance };
  };
  model.levels.forEach(ensureProvenance);
  model.grids.forEach(ensureProvenance);
  for (const category of categories) model.structure[category].forEach(ensureProvenance);
  const rejected = [];
  const gridIds = new Map(model.grids.map(grid => [grid.id, grid.axis]));
  const gridReferenceWarnings = [];
  for (const column of model.structure.columns) {
    if (!column?.gridRefs) continue;
    const refs = { ...column.gridRefs };
    for (const axis of ["x", "z"]) {
      if (refs[axis] && gridIds.get(refs[axis]) !== axis) {
        gridReferenceWarnings.push({ category: "columns", id: column.id, reason: `Ignored invalid optional ${axis}-grid reference "${refs[axis]}"; retained column coordinates.` });
        delete refs[axis];
      }
    }
    if (Object.keys(refs).length) column.gridRefs = refs;
    else delete column.gridRefs;
  }
  for (const category of categories) {
    const accepted = [];
    const seenIds = new Set();
    const items = model.structure[category];
    for (const item of items) {
      if (!item?.id || seenIds.has(item.id)) {
        rejected.push({ category, id: item?.id || null, reason: seenIds.has(item?.id) ? "duplicate_id" : "missing_id" });
        continue;
      }
      const candidate = { ...model, structure: { ...model.structure, [category]: [item] } };
      const result = validateBuildingModel(candidate);
      const ownErrors = result.errors.filter(error => error.includes("structure." + category + "[0]"));
      if (ownErrors.length) rejected.push({ category, id: item.id, reason: ownErrors.slice(0, 4).join("; ") });
      else { accepted.push(item); seenIds.add(item.id); }
    }
    model.structure[category] = accepted;
  }
  return { model, rejected: [...gridReferenceWarnings, ...rejected] };
}

function getText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(part => part?.text || "").join("");
  return "";
}

function findElement(model, elementId) {
  if (!model || !elementId) return null;
  for (const [category, elements] of Object.entries(model.structure || {})) {
    if (!Array.isArray(elements)) continue;
    const found = elements.find(item => item.id === elementId);
    if (found) return { category, ...found };
  }
  return model.levels?.find(item => item.id === elementId)
    || model.grids?.find(item => item.id === elementId)
    || null;
}

function executeTool(name, args, state) {
  if (name === "add_reconstruction_chunk") {
    const categories = ["columns", "beams", "slabs", "walls", "stairs", "foundations", "roofs"];
    if (!args || typeof args.section !== "string" || typeof args.data !== "string") {
      return { ok: false, error: "A chunk requires section and JSON-string data." };
    }
    let data;
    try { data = JSON.parse(args.data); }
    catch { return { ok: false, error: "This section is truncated or invalid JSON. Retry it as smaller chunks." }; }
    if (args.section === "core") {
      if (state.reconstructionDraft) return { ok: false, error: "Core already received. Continue with the remaining categories." };
      if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false, error: "Core must be a JSON object." };
      state.reconstructionDraft = {
        schemaVersion: data.schemaVersion || "1.0.0",
        id: data.id || "reconstructed-building",
        name: data.name || "Reconstructed building",
        units: data.units || "m",
        levels: data.levels,
        grids: data.grids || [],
        structure: Object.fromEntries(categories.map(category => [category, []])),
        metadata: data.metadata || { createdFrom: [] },
        ...(data.overallDimensions ? { overallDimensions: data.overallDimensions } : {})
      };
      state.reconstructionObservations = Array.isArray(data.observations) ? data.observations : [];
      state.reconstructionSections = new Set(["core"]);
      return { ok: true, section: "core", next: "columns" };
    }
    if (!state.reconstructionDraft) return { ok: false, error: "Send core before member categories." };
    if (categories.includes(args.section)) {
      if (!Array.isArray(data)) return { ok: false, error: args.section + " must be a JSON array." };
      const existing = state.reconstructionDraft.structure[args.section];
      const ids = new Set(existing.map(item => item?.id).filter(Boolean));
      const accepted = data.filter(item => {
        if (!item || typeof item !== "object" || !item.id || ids.has(item.id)) return false;
        ids.add(item.id); return true;
      });
      state.reconstructionDraft.structure[args.section] = existing.concat(accepted);
      state.reconstructionSections.add(args.section);
      return { ok: true, section: args.section, accepted: accepted.length, total: state.reconstructionDraft.structure[args.section].length };
    }
    if (args.section === "finalize") {
      const missing = categories.filter(category => !state.reconstructionSections.has(category));
      if (missing.length) return { ok: false, error: "Send remaining categories first: " + missing.join(", ") + ". Use [] when none are present." };
      const result = executeTool("reconstruct_building", {
        model: JSON.stringify(state.reconstructionDraft),
        observations: JSON.stringify(state.reconstructionObservations || [])
      }, state);
      if (result.ok) state.reconstructionDraft = null;
      return result;
    }
    return { ok: false, error: "Unknown reconstruction section." };
  }
  if (name === "reconstruct_building") {
    if (typeof args?.model !== "string" || typeof args?.observations !== "string") {
      return { ok: false, error: "Return model and observations as separate JSON-encoded string arguments." };
    }
    let proposedModel, observations;
    try { proposedModel = JSON.parse(args.model); } catch { return { ok: false, error: "The model JSON is invalid or truncated. Return the complete model JSON without prose or truncation." }; }
    try { observations = JSON.parse(args.observations); } catch { return { ok: false, error: "The observations JSON is invalid. Return a JSON array, or []." }; }
    if (!proposedModel || typeof proposedModel !== "object" || Array.isArray(proposedModel) || !Array.isArray(observations)) {
      return { ok: false, error: "Return a model object and an observations array." };
    }
    const normalized = normalizeReconstructionModel(proposedModel);
    const validation = validateBuildingModel(normalized.model);
    const audit = buildReconstructionAudit(proposedModel, normalized.model, normalized.rejected, validation);
    state.reconstructionAudit = audit;
    console.info("BuildLens reconstruction audit", JSON.stringify({
      rawModelJsonCharacters: args.model.length, submitted: audit.submitted, retained: audit.retained,
      levels: audit.levels, rejectedCount: audit.rejectedCount, missingArchitectural: audit.missingArchitectural,
      wallOpenings: audit.wallOpenings, slabOpenings: audit.slabOpenings, units: audit.units,
      coordinateRanges: audit.coordinateRanges, validationErrors: audit.validationErrors
    }));
    if (!validation.valid) {
      return { ok: false, error: "The reconstruction still has model-level validation errors after valid members were retained.", validationErrors: validation.errors.slice(0, 40), rejectedMembers: normalized.rejected, audit };
    }
    if (observations.length) {
      const categories = ["grid", "level", "column", "beam", "slab", "wall", "foundation", "reinforcement", "material", "load", "calculation", "general", "conflict", "missing_information"];
      const provenanceValues = ["specified", "calculated", "inferred", "assumed", "unverified", "missing"];
      const validObservations = observations.filter(item =>
        item && typeof item.sourceFile === "string" && item.sourceFile.trim() &&
        Number.isInteger(item.sourcePage) && item.sourcePage > 0 &&
        categories.includes(item.category) && typeof item.property === "string" && item.property.trim() &&
        ["string", "number", "boolean"].includes(typeof item.value) &&
        typeof item.unit === "string" && provenanceValues.includes(item.provenance) &&
        typeof item.description === "string" && item.description.trim() &&
        (item.discipline === undefined || ["architectural", "structural", "general"].includes(item.discipline))
      );
      if (validObservations.length) {
        const evidence = executeTool("record_drawing_observations", { observations: validObservations.slice(0, 250) }, state);
        if (!evidence.ok) return evidence;
      }
      if (validObservations.length < observations.length) {
        state.toolErrors.push({ tool: "record_drawing_observations", error: (observations.length - validObservations.length) + " incomplete observations were skipped; valid model geometry was retained." });
      }
    }
    const rendered = executeTool("render_building_model", { model: normalized.model }, state);
    if (!rendered.ok) return rendered;
    const geometryCount = Object.entries(normalized.model.structure).reduce((sum, [key, value]) =>
      sum + (["columns", "beams", "slabs", "walls", "stairs", "foundations", "roofs"].includes(key) && Array.isArray(value) ? value.length : 0), 0);
    return { ok: true, modelId: rendered.modelId, elementCounts: rendered.elementCounts, observationsRecorded: state.findings.length, geometryCount, rejectedMembers: normalized.rejected, partial: normalized.rejected.length > 0, audit };
  }
  if (args && typeof args.payload === "string") {
    try { args = JSON.parse(args.payload); }
    catch { return { ok: false, error: "The tool payload was not valid JSON. Retry with a valid JSON-encoded payload string." }; }
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return { ok: false, error: "Tool arguments must be a JSON object." };
  }

  if (name === "record_drawing_observations") {
    if (!Array.isArray(args.observations) || !args.observations.length || args.observations.length > 250) {
      return { ok: false, error: "Provide between 1 and 250 drawing observations." };
    }
    const allowedCategories = ["grid", "level", "column", "beam", "slab", "wall", "foundation", "reinforcement", "material", "load", "calculation", "general", "conflict", "missing_information"];
    const allowedProvenance = ["specified", "calculated", "inferred", "assumed", "unverified", "missing"];
    const clean = [];
    for (const item of args.observations) {
      if (!item || typeof item.sourceFile !== "string" || !item.sourceFile.trim() ||
        !Number.isInteger(item.sourcePage) || item.sourcePage < 1 ||
        !allowedCategories.includes(item.category) || (item.discipline !== undefined && !["architectural", "structural", "general"].includes(item.discipline)) || typeof item.property !== "string" || !item.property.trim() ||
        !["string", "number", "boolean"].includes(typeof item.value) ||
        typeof item.unit !== "string" || !allowedProvenance.includes(item.provenance) ||
        typeof item.description !== "string" || !item.description.trim() ||
        (item.confidence !== undefined && (!Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1))) {
        return { ok: false, error: "An observation is missing a valid source, page, category, property, value, unit, provenance or description." };
      }
      clean.push({
        sourceFile: item.sourceFile.slice(0, 180), sourcePage: item.sourcePage,
        category: item.category, ...(item.discipline ? { discipline: item.discipline } : {}), ...(item.elementId ? { elementId: String(item.elementId).slice(0, 100) } : {}),
        property: item.property.slice(0, 120), value: item.value, unit: item.unit.slice(0, 40),
        provenance: item.provenance, ...(item.confidence !== undefined ? { confidence: item.confidence } : {}),
        description: item.description.slice(0, 600), ...(item.sourceExcerpt ? { sourceExcerpt: String(item.sourceExcerpt).slice(0, 500) } : {})
      });
    }
    const conflictFindings = detectDrawingConflicts([...state.findings, ...clean]).filter(conflict =>
      !state.findings.some(item => item.category === "conflict" && item.elementId === conflict.elementId &&
        item.property.toLowerCase() === conflict.property.toLowerCase() &&
        item.description.includes(conflict.sourceFile)));
    state.findings.push(...clean, ...conflictFindings);
    state.findings = state.findings.slice(-500);
    state.actions.push({ type: "document.observations.add", observations: [...clean, ...conflictFindings] });
    return { ok: true, recorded: clean.length, conflictsDetected: conflictFindings.length, totalObservations: state.findings.length };
  }

  if (name === "render_building_model" || name === "update_building_model") {
    let proposedModel = args.model;
    if (typeof proposedModel === "string") {
      try { proposedModel = JSON.parse(proposedModel); }
      catch { return { ok: false, error: "The model argument was not valid JSON. Return the complete model as a JSON-encoded string." }; }
    }
    const result = validateBuildingModel(proposedModel);
    if (!result.valid) return { ok: false, error: "The proposed building model failed validation.", validationErrors: result.errors.slice(0, 30) };
    state.model = proposedModel;
    state.actions.push({ type: "model.replace", model: proposedModel, reason: name === "render_building_model" ? "Initial model generated from project information." : args.reason });
    return { ok: true, modelId: proposedModel.id, elementCounts: Object.fromEntries(Object.entries(proposedModel.structure).map(([key, value]) => [key, Array.isArray(value) ? value.length : 0])), message: "The model passed structural data validation and is ready for the 3D renderer." };
  }

  if (name === "set_model_opacity") {
    const allowed = ["columns", "beams", "slabs", "walls", "stairs", "foundations", "roofs", "reinforcement", "all"];
    if (!allowed.includes(args.category) || !Number.isFinite(args.opacity) || args.opacity < 0.05 || args.opacity > 1) {
      return { ok: false, error: "Opacity must be between 0.05 and 1 for a supported model category." };
    }
    const action = { type: "model.opacity", category: args.category, opacity: args.opacity };
    state.actions.push(action);
    return { ok: true, action };
  }

  if (name === "set_model_visibility") {
    const allowed = ["foundations", "columns", "beams", "slabs", "walls", "stairs", "roofs", "reinforcement", "grids", "all"];
    if (!allowed.includes(args.category) || typeof args.visible !== "boolean") return { ok: false, error: "Invalid visibility arguments." };
    const action = { type: "model.visibility", category: args.category, visible: args.visible };
    if (args.elementIds !== undefined) {
      if (!Array.isArray(args.elementIds) || args.elementIds.some(id => typeof id !== "string")) return { ok: false, error: "elementIds must be an array of strings." };
      action.elementIds = args.elementIds.slice(0, 500);
    }
    state.actions.push(action);
    return { ok: true, action };
  }

  if (name === "generate_reinforcement_layout") {
    if (!state.model) return { ok: false, error: "Generate the building model before adding reinforcement." };
    const allowed = ["longitudinal", "transverse", "top", "bottom", "both_faces", "closed_stirrups", "links", "mesh", "custom"];
    if (typeof args.elementId !== "string" || !allowed.includes(args.arrangement)) return { ok: false, error: "Invalid reinforcement target or arrangement." };
    const provenanceValue = args.provenance;
    if (!provenanceValue || !["specified", "calculated", "inferred", "assumed", "missing", "unverified"].includes(provenanceValue.status)) return { ok: false, error: "Reinforcement provenance is required." };
    const barDiameter = args.barDiameter;
    if (!barDiameter || !Number.isFinite(barDiameter.value) || barDiameter.value <= 0 || !barDiameter.provenance || !["specified", "calculated", "inferred", "assumed", "missing", "unverified"].includes(barDiameter.provenance.status)) return { ok: false, error: "A positive bar diameter and its provenance are required." };
    for (const key of ["spacing", "cover"]) {
      if (args[key] && (!Number.isFinite(args[key].value) || args[key].value <= 0 || !args[key].provenance || !["specified", "calculated", "inferred", "assumed", "missing", "unverified"].includes(args[key].provenance.status))) return { ok: false, error: key + " must be positive and include provenance." };
    }
    if (args.quantity !== undefined && (!Number.isInteger(args.quantity) || args.quantity < 1)) return { ok: false, error: "quantity must be a positive integer." };
    if (args.bars !== undefined) {
      if (!Array.isArray(args.bars) || args.bars.length > 1000) return { ok: false, error: "bars must be an array containing at most 1000 explicit bar definitions." };
      for (const bar of args.bars) {
        const validPoint = point => point && ["x", "y", "z"].every(key => Number.isFinite(point[key]));
        if (!bar || typeof bar.id !== "string" || !bar.id.trim() || !validPoint(bar.start) || !validPoint(bar.end) ||
          !Number.isFinite(bar.diameter?.value) || bar.diameter.value <= 0 ||
          !["specified", "calculated", "inferred", "assumed", "missing", "unverified"].includes(bar.provenance?.status) ||
          !["specified", "calculated", "inferred", "assumed", "missing", "unverified"].includes(bar.diameter.provenance?.status)) {
          return { ok: false, error: "Each reinforcement bar needs an ID, finite start/end coordinates, a positive diameter and provenance." };
        }
      }
    }
    let target = null;
    for (const [category, elements] of Object.entries(state.model.structure || {})) {
      if (Array.isArray(elements)) {
        const found = elements.find(item => item.id === args.elementId);
        if (found) { target = found; break; }
      }
    }
    if (!target) return { ok: false, error: "The target structural element was not found." };
    target.reinforcement = Array.isArray(target.reinforcement) ? target.reinforcement : [];
    const layout = {
      arrangement: args.arrangement,
      ...(args.barMark ? { barMark: args.barMark } : {}),
      barDiameter,
      ...(args.quantity !== undefined ? { quantity: args.quantity } : {}),
      ...(args.spacing ? { spacing: args.spacing } : {}),
      ...(args.cover ? { cover: args.cover } : {}),
      ...(args.grade ? { grade: args.grade } : {}),
      ...(args.notes ? { notes: args.notes } : {}),
      ...(args.bars ? { bars: args.bars } : {}),
      provenance: provenanceValue
    };
    target.reinforcement.push(layout);
    const validation = validateBuildingModel(state.model);
    if (!validation.valid) {
      target.reinforcement.pop();
      return { ok: false, error: "The reinforcement layout failed model validation.", validationErrors: validation.errors.slice(0, 20) };
    }
    state.actions.push({ type: "model.reinforcement.add", elementId: args.elementId, layout });
    return { ok: true, elementId: args.elementId, reinforcementLayouts: target.reinforcement.length };
  }

  if (name === "update_element_dimensions") {
    if (!state.model) return { ok: false, error: "Generate the building model before updating dimensions." };
    if (!args.dimensions || typeof args.dimensions !== "object" || Array.isArray(args.dimensions)) return { ok: false, error: "dimensions must be an object." };
    const allowedKeys = ["width", "depth", "height", "thickness", "length"];
    const entries = Object.entries(args.dimensions);
    if (!entries.length || entries.some(([key, value]) => !allowedKeys.includes(key) || !value || !Number.isFinite(value.value) || value.value <= 0 || !value.provenance || !["specified", "calculated", "inferred", "assumed", "missing", "unverified"].includes(value.provenance.status))) return { ok: false, error: "Every updated dimension must be positive and include valid provenance." };
    let target = null;
    for (const elements of Object.values(state.model.structure || {})) {
      if (Array.isArray(elements)) {
        const found = elements.find(item => item.id === args.elementId);
        if (found) { target = found; break; }
      }
    }
    if (!target) return { ok: false, error: "The target structural element was not found." };
    const before = {};
    for (const [key, value] of entries) {
      if (!(key in target)) return { ok: false, error: "Dimension " + key + " does not apply to this element." };
      before[key] = target[key];
      target[key] = value;
    }
    const validation = validateBuildingModel(state.model);
    if (!validation.valid) {
      Object.assign(target, before);
      return { ok: false, error: "The dimension update failed model validation.", validationErrors: validation.errors.slice(0, 20) };
    }
    state.actions.push({ type: "model.element.update", elementId: args.elementId, dimensions: args.dimensions });
    return { ok: true, elementId: args.elementId, updatedDimensions: Object.keys(args.dimensions) };
  }

  if (name === "inspect_model_element") {
    const element = findElement(state.model, args.elementId);
    if (!element) return { ok: false, error: "No model element with that ID was found. Check the ID or generate the building model first." };
    return { ok: true, element };
  }

  return { ok: false, error: "Unknown tool." };
}

async function callMeta({ apiKey, messages, useTools = true, toolsToUse = tools, timeoutMs = 45000, stream = false, onDelta = () => {}, maxCompletionTokens = 4096 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  try {
    const response = await fetch("https://api.meta.ai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json", Accept: stream ? "text/event-stream" : "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: "muse-spark-1.3", stream, messages,
        ...(useTools && toolsToUse.length ? { tools: toolsToUse, tool_choice: "auto", parallel_tool_calls: false } : {}),
        max_completion_tokens: maxCompletionTokens, reasoning_effort: "low"
      })
    });
    let payload;
    const upstreamType = (response.headers.get("content-type") || "").toLowerCase();
    if (stream && response.ok && upstreamType.includes("text/event-stream")) {
      if (!response.body) throw new Error("Meta AI opened a stream without a response body.");
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let buffer = "", answer = "", finishReason = null, usage = null;
      const toolCalls = new Map();
      const consume = frame => {
        for (const line of frame.split(/\r?\n/)) {
          if (!line.startsWith("data:")) continue;
          const raw = line.slice(5).trim();
          if (!raw || raw === "[DONE]") continue;
          let event; try { event = JSON.parse(raw); } catch { continue; }
          if (event.usage) usage = event.usage;
          const choice = event.choices?.[0]; if (!choice) continue;
          if (choice.finish_reason) finishReason = choice.finish_reason;
          const delta = choice.delta || {};
          if (typeof delta.content === "string" && delta.content) { answer += delta.content; onDelta(delta.content); }
          for (const fragment of delta.tool_calls || []) {
            const index = Number.isInteger(fragment.index) ? fragment.index : 0;
            const call = toolCalls.get(index) || { id: "", type: "function", function: { name: "", arguments: "" } };
            if (fragment.id) call.id = fragment.id;
            if (fragment.type) call.type = fragment.type;
            if (fragment.function?.name) call.function.name += fragment.function.name;
            if (fragment.function?.arguments) call.function.arguments += fragment.function.arguments;
            toolCalls.set(index, call);
          }
        }
      };
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split(/\r?\n\r?\n/); buffer = frames.pop() || "";
          frames.forEach(consume);
        }
        buffer += decoder.decode(); if (buffer.trim()) consume(buffer);
      } finally { reader.releaseLock?.(); }
      payload = {
        choices: [{
          message: {
            role: "assistant", content: answer || null,
            ...(toolCalls.size ? { tool_calls: [...toolCalls.entries()].sort((a, b) => a[0] - b[0]).map(([, call]) => call) } : {})
          },
          finish_reason: finishReason || (toolCalls.size ? "tool_calls" : "stop")
        }],
        ...(usage ? { usage } : {})
      };
    } else {
      // The provider may return JSON even when streaming was requested.
      // Parse based on the actual response content type; never decode JSON
      // as SSE and silently discard the assistant's answer.
      const raw = await response.text();
      try { payload = raw ? JSON.parse(raw) : null; }
      catch { throw new Error("Meta AI returned neither a valid SSE stream nor readable JSON (content-type: " + (upstreamType || "missing") + ")."); }
    }
    if (!response.ok) {
      const providerMessage = payload?.error?.message || payload?.message;
      console.error("Meta API request failed:", response.status, String(providerMessage || "").slice(0, 400));
      const error = new Error(response.status === 401 || response.status === 403 ? "Meta API authentication failed. Check META_API_KEY in Vercel." : "Meta AI request failed (HTTP " + response.status + "). " + (providerMessage || "Please try again."));
      error.status = response.status >= 500 ? 502 : response.status; throw error;
    }
    return payload;
  } catch (error) {
    if (error?.name === "AbortError") { const timeout = new Error("Meta AI took too long to interpret the drawings. The request was stopped before Vercel's execution limit; no model was reported as complete."); timeout.status = 504; throw timeout; }
    throw error;
  } finally { clearTimeout(timer); }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const body = req.body || {};
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const history = Array.isArray(body.history) ? body.history.slice(-8) : [];
  const attachments = Array.isArray(body.attachments) ? body.attachments.slice(0, 12) : [];

  if (!message) return res.status(400).json({ error: "Enter a message first." });
  if (message.length > 6000) return res.status(413).json({ error: "Message is too long." });
  if (history.some(item => !item || !["user", "assistant"].includes(item.role) || typeof item.content !== "string")) {
    return res.status(400).json({ error: "Conversation format is invalid." });
  }

  let attachmentText = "";
  const imageParts = [];
  const MAX_IMAGES = 10;
  const MAX_DOCUMENT_TEXT = 240000;
  for (const [index, item] of attachments.entries()) {
    if (!item || typeof item.name !== "string" || typeof item.type !== "string") continue;
    if (item.kind === "text" && typeof item.content === "string") {
      const remaining = Math.max(0, MAX_DOCUMENT_TEXT - attachmentText.length);
      const content = item.content.slice(0, Math.min(120000, remaining));
      attachmentText += "\n\n[Project document " + (index + 1) + ": " + item.name + "]\n" + content;
    }
    if (item.kind === "image" && typeof item.dataUrl === "string" &&
      /^data:image\/(jpeg|png|webp);base64,/.test(item.dataUrl) && item.dataUrl.length <= 400000 &&
      imageParts.length < MAX_IMAGES) {
      imageParts.push({ type: "image_url", image_url: { url: item.dataUrl, detail: "high" } });
    }
    if (Array.isArray(item.pageImages) && imageParts.length < MAX_IMAGES) {
      for (const page of item.pageImages) {
        if (imageParts.length >= MAX_IMAGES) break;
        if (typeof page?.dataUrl === "string" &&
          /^data:image\/(jpeg|png|webp);base64,/.test(page.dataUrl) && page.dataUrl.length <= 300000) {
          attachmentText += "\n[Visual sheet supplied from " + item.name + ", page " + (Number.isInteger(page.pageNumber) ? page.pageNumber : "unknown") + "]";
          imageParts.push({ type: "image_url", image_url: { url: page.dataUrl, detail: "high" } });
        }
      }
    }
  }
  if (attachmentText.length > MAX_DOCUMENT_TEXT) attachmentText = attachmentText.slice(0, MAX_DOCUMENT_TEXT) + "\n[Document text truncated after the shared evidence budget.]";

  const apiKey = process.env.META_API_KEY;
  if (!apiKey) return res.status(503).json({ error: "Meta Model API is not configured. Add META_API_KEY in Vercel environment variables." });

  let currentModel = body.currentModel ?? null;
  if (currentModel) {
    const validation = validateBuildingModel(currentModel);
    if (!validation.valid) return res.status(400).json({ error: "The current project model is invalid.", details: validation.errors.slice(0, 20) });
  }

  const state = { model: currentModel, actions: [], findings: [], toolErrors: [], reconstructionDraft: null, reconstructionObservations: [], reconstructionSections: null, reconstructionAudit: null };
  const modelContext = currentModel
    ? "\n\nCurrent validated project model (preserve its existing verified data unless instructed otherwise):\n" + JSON.stringify(currentModel).slice(0, 50000)
    : "\n\nNo building model has been generated for this project yet.";
  const wantsReconstruction = /\b(?:generate|create|build|reconstruct|render|produce|make|fix|correct|redesign)\b[\s\S]{0,70}\b(?:3d|model|building|structure|house)\b|\b3d\s+(?:model|reconstruction|building|render)\b|\bmodel\s+(?:this|these|the|from|of)\b/i.test(message);
  const wantsModelOperation = /\b(?:show|hide|isolate|inspect|measure|update|change|modify|revise|resize|fix|correct|reinforce|reinforcement|rebar|opacity|transparent|visible|visibility|display|add|remove|delete)\b/i.test(message);
  const chatInstructions = "You are BuildLens, an engineering document assistant. Answer the user's actual question using supplied project evidence. Never invent dimensions, reinforcement, loads, material strengths or code checks. Distinguish documented facts from assumptions and uncertainty. Do not certify structural safety. Be concise and explain what source evidence is missing when relevant.";
  const developerInstructions = wantsReconstruction || (currentModel && wantsModelOperation)
    ? SYSTEM_PROMPT + "\n\nCANONICAL BUILDING MODEL JSON SCHEMA (follow exactly; do not use bare numeric dimensions):\n" + JSON.stringify(BUILDING_MODEL_SCHEMA) + modelContext
    : chatInstructions + (currentModel ? "\n\nThe project has a validated 3D model available in the workspace. Do not claim to change it unless a model tool action succeeds." : "");
  const messages = [
    { role: "developer", content: developerInstructions },
    ...history.map(({ role, content }) => ({ role, content: content.slice(0, 8000) })),
    { role: "user", content: imageParts.length ? [{ type: "text", text: message + attachmentText }, ...imageParts] : message + attachmentText }
  ];

  // Keep one HTTP response open while the bounded Meta/tool sequence runs.
  // Meta itself remains non-streaming in this first safe iteration.
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("X-BuildLens-Protocol", "sse-v1");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  let responseClosed = false;
  const sendEvent = (event, data) => {
    if (!responseClosed && !res.destroyed) res.write("event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n");
  };
  const heartbeat = setInterval(() => {
    if (!responseClosed && !res.destroyed) res.write(": keep-alive\n\n");
  }, 12000);
  const closeStream = () => {
    if (responseClosed) return;
    responseClosed = true;
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  };
  res.on("close", () => {
    if (!res.writableEnded) responseClosed = true;
    clearInterval(heartbeat);
  });
  sendEvent("status", { message: "Reading the supplied project documents." });

  try {
    let payload = null;
    let finalAnswer = "";
    let modelResponseText = "";
    let completed = false;
    const startedAt = Date.now();
    const deadline = startedAt + 285000;
    // Normal chat does not need a tool round trip. A first reconstruction
    // uses one complete-model tool call instead of eight sequential chunks.
    const requestTools = wantsReconstruction && !currentModel ? [reconstructionChunkTool]
      : currentModel && (wantsModelOperation || wantsReconstruction) ? tools : [];
    const maxTurns = wantsReconstruction && !currentModel ? 12 : 1;

    for (let turn = 0; turn < maxTurns; turn++) {
      const remainingMs = deadline - Date.now();
      if (remainingMs < 1500) break;
      sendEvent('status', { message: currentModel ? 'Interpreting your instruction and preparing the model update.' : 'Interpreting drawings and preparing the building reconstruction.' });
      const requestStartedAt = Date.now();
      payload = await callMeta({
        apiKey, messages, useTools: requestTools.length > 0, toolsToUse: requestTools,
        stream: true, onDelta: chunk => sendEvent("delta", { text: chunk }),
        maxCompletionTokens: wantsReconstruction ? 12288 : 4096,
        timeoutMs: remainingMs - 500
      });
      const choice = payload?.choices?.[0];
      const assistantMessage = choice?.message || {};
      const assistantText = getText(assistantMessage.content);
      if (assistantText.trim()) modelResponseText = assistantText;
      const toolCalls = Array.isArray(assistantMessage.tool_calls) ? assistantMessage.tool_calls : [];
      console.info("BuildLens AI completion", {
        turn: turn + 1,
        elapsedMs: Date.now() - requestStartedAt,
        finishReason: choice?.finish_reason || null,
        toolCallCount: toolCalls.length,
        hasModel: Boolean(state.model),
        usage: payload?.usage || null
      });

      if (choice?.finish_reason !== "tool_calls" && toolCalls.length === 0) {
        const plainText = getText(assistantMessage.content) || getText(assistantMessage.refusal) || getText(choice?.text);
        if (currentModel || !wantsReconstruction) {
          modelResponseText = plainText;
          finalAnswer = plainText;
          completed = Boolean(plainText.trim());
          break;
        }

        console.error("BuildLens reconstruction returned no tool call", JSON.stringify({
          finish_reason: choice?.finish_reason || null,
          hasText: Boolean(plainText),
          usage: payload?.usage || null
        }));
        if (turn + 1 < maxTurns) {
          messages.push({ role: "assistant", content: plainText || "I did not return a reconstruction chunk." });
          messages.push({ role: "user", content: "Retry the reconstruction using add_reconstruction_chunk. Send the next missing section as valid JSON text. Keep each section below the tool size limit and do not send the entire building in one argument." });
          continue;
        }
        sendEvent("error", { error: "Meta AI did not invoke the reconstruction function after two bounded attempts. No project model was generated." });
        closeStream();
        return;
      }

      sendEvent('status', { message: 'Applying and validating the AI reconstruction instructions.' });

      // Replay the complete assistant tool-call message before tool results.
      messages.push({
        role: "assistant",
        content: assistantMessage.content || "",
        tool_calls: toolCalls.map(call => ({
          id: call.id,
          type: "function",
          function: { name: call.function?.name, arguments: call.function?.arguments || "{}" }
        }))
      });

      for (const call of toolCalls) {
        let result;
        try {
          const args = JSON.parse(call.function?.arguments || "{}");
          result = executeTool(call.function?.name, args, state);
        } catch {
          result = { ok: false, error: "Tool arguments were not valid JSON. Please retry with valid structured arguments." };
        }
        if (!result?.ok) {
          state.toolErrors.push({
            tool: call.function?.name || "unknown",
            error: result?.error || "Tool execution failed.",
            details: result?.validationErrors || []
          });
          state.toolErrors = state.toolErrors.slice(-12);
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
        if (call.function?.name === "add_reconstruction_chunk" && result?.ok && result.section !== "finalize") {
          const required = ["core", "columns", "beams", "slabs", "walls", "stairs", "foundations", "roofs"];
          const missing = required.filter(section => !state.reconstructionSections?.has(section));
          messages.push({ role: "user", content: missing.length
            ? "Continue now with section " + missing[0] + ". Send it as a JSON string. If it contains many members, split it into multiple smaller calls. Do not skip any section; use [] only if no supported members exist."
            : "All seven categories are received. Call add_reconstruction_chunk with section=finalize and data='{}'." });
        }
      }

      if (state.actions.length) sendEvent('model', { actions: state.actions, model: state.model, findings: state.findings });

      if (!currentModel && state.model && state.actions.some(action => action.type === "model.replace")) {
        const counts = Object.fromEntries(Object.entries(state.model.structure || {}).map(([key, value]) => [key, Array.isArray(value) ? value.length : 0]));
        const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
        const geometryCount = ["columns", "beams", "slabs", "walls", "stairs", "foundations", "roofs"]
          .reduce((sum, key) => sum + (counts[key] || 0), 0);
        const detail = Object.entries(counts).filter(([, count]) => count).map(([category, count]) => count + " " + category).join(", ");
        if (validateBuildingModel(state.model).valid) {
          const audit = state.reconstructionAudit;
          if (audit) {
            const submitted = Object.entries(audit.submitted).map(([key, value]) => key + ": " + value).join(", ");
            const retained = Object.entries(audit.retained).map(([key, value]) => key + ": " + value).join(", ");
            const missing = audit.missingArchitectural.length ? audit.missingArchitectural.join(", ") : "none";
            const rejected = audit.rejectedCount ? audit.rejected.slice(0, 8).map(item => item.category + "/" + (item.id || "unknown") + ": " + item.reason).join("; ") : "none";
            finalAnswer = "Reconstruction diagnostic (pre-render):\n- AI submitted: " + submitted + "\n- Renderer will receive: " + retained + "\n- Levels: " + audit.levels + " · Units: " + audit.units + "\n- Wall openings: " + audit.wallOpenings + " · Slab openings: " + audit.slabOpenings + "\n- Floor slab elevations: " + JSON.stringify(audit.floorSlabElevations) + "\n- Storey geometry warnings: " + (audit.storeyGeometryWarnings.length ? audit.storeyGeometryWarnings.join("; ") : "none") + "\n- Architectural categories with no geometry: " + missing + "\n- Rejected elements: " + rejected + "\n- Coordinate ranges: " + JSON.stringify(audit.coordinateRanges) + "\n\nThis confirms what reached the renderer, not whether the drawing interpretation is geometrically correct.";
          } else finalAnswer = "The building model passed data validation, but the reconstruction audit was not available.";
          completed = true;
          break;
        }
      }
      if (!currentModel && !state.model && state.actions.some(action => ["model.visibility", "model.opacity"].includes(action.type))) {
        completed = true;
        break;
      }
    }

    const hasSuccessfulWorkspaceAction = state.actions.some(action =>
      ["model.replace", "model.visibility", "model.opacity", "model.reinforcement.add", "model.element.update"].includes(action.type));
    if (wantsReconstruction && !currentModel && (!state.model || !state.actions.some(action => action.type === "model.replace")) &&
        !state.actions.some(action => ["model.visibility", "model.opacity"].includes(action.type))) {
      const errors = state.toolErrors.map(item => item.tool + ": " + item.error).join("; ");
      console.error("BuildLens reconstruction incomplete", JSON.stringify({
        elapsedMs: Date.now() - startedAt,
        toolErrors: state.toolErrors.length,
        actionTypes: state.actions.map(action => action.type),
        hasModel: Boolean(state.model)
      }));
      sendEvent("error", { error: errors
        ? "The drawing was received, but model validation failed: " + errors + ". No 3D model was generated."
        : "The drawing was received, but BuildLens could not complete the reconstruction within the request. No validated model was reported as generated." });
      closeStream();
      return;
    }

    if (hasSuccessfulWorkspaceAction || modelResponseText) {
      if (!finalAnswer.trim() && state.model) {
        const counts = Object.fromEntries(Object.entries(state.model.structure || {}).map(([key, value]) => [key, Array.isArray(value) ? value.length : 0]));
        const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
        const detail = Object.entries(counts).filter(([, count]) => count).map(([category, count]) => count + " " + category).join(", ");
        const rejected = state.toolErrors.length;
        finalAnswer = (currentModel ? "The project model update was applied." : "The building model was generated and passed data validation.") +
          " Retained " + total + " structural elements" + (detail ? " (" + detail + ")" : "") + "." +
          (state.findings.length ? " Recorded " + state.findings.length + " source observations." : "") +
          (rejected ? " Some unsupported or invalid members were omitted for review." : "") +
          " Values not established by the supplied drawings remain unverified.";
      }
      if (!finalAnswer.trim() && modelResponseText.trim()) finalAnswer = modelResponseText.trim();
      if (!finalAnswer.trim()) {
        const actions = state.actions.map(action => action.type === "model.visibility"
          ? (action.visible ? "Showed " : "Hid ") + action.category
          : action.type === "model.opacity" ? "Changed " + action.category + " opacity"
          : action.type).join("; ");
        finalAnswer = actions ? "Applied the requested workspace change: " + actions + "." : "The requested model operation was completed.";
      }
      completed = true;
    }

    if (!completed && currentModel && !finalAnswer.trim()) {
      finalAnswer = "I could not confirm completion of the requested model operation. The existing model remains unchanged unless a successful operation was reported.";
    }

    if (!finalAnswer.trim() && state.actions.length && (currentModel || state.model)) {
      finalAnswer = "The validated model operation was returned to the workspace.";
    }
    if (!finalAnswer.trim()) {
      console.error("Meta API returned an empty answer:", JSON.stringify({
        finish_reason: payload?.choices?.[0]?.finish_reason || null,
        tool_call_count: state.actions.length,
        usage: payload?.usage || null
      }));
      sendEvent("error", { error: "Meta AI returned no user-facing answer. Please try again." });
      closeStream();
      return;
    }

    sendEvent("done", { answer: finalAnswer, actions: state.actions, model: state.model, findings: state.findings });
    closeStream();
    return;
  } catch (error) {
    console.error("BuildLens Meta request failed:", JSON.stringify({
      name: error?.name || "Error",
      status: error?.status || 502,
      message: String(error?.message || "Unknown error").slice(0, 500)
    }));
    sendEvent("error", { error: error.message || "Could not reach Meta AI. Check the connection and try again." });
    closeStream();
    return;
  }
}
