import { BUILDING_MODEL_SCHEMA, validateBuildingModel } from "../src/domain/buildingModel.js";

const SYSTEM_PROMPT = `You are BuildLens, an AI building reconstruction and engineering assistant.
Your purpose is to interpret uploaded building drawings, structural plans, schedules and calculations, then use the available tools to build and update a structured 3D building model.
Do not merely describe a model when the user asks you to generate or modify one: call the appropriate model tool.
Use render_building_model for a newly interpreted complete building. Use update_building_model when revising an existing model. Use set_model_visibility for display requests and inspect_model_element to retrieve details.
Only include dimensions, positions and reinforcement supported by the supplied documents or transparent calculations. Never invent engineering dimensions, reinforcement, loads, material strengths, design-code checks or calculation results.
Every engineering value must carry provenance: specified, calculated, inferred, assumed, missing or unverified. If critical information is unavailable, leave it out or mark it missing/unverified and explain what is needed. Do not silently convert assumptions into specified values.
All coordinates and dimensions must use the model's declared units. Coordinates use x/z for plan and y for vertical.
A successful model tool call updates the project's model data. The Three.js renderer will consume that structured model. Do not claim that the 3D viewport has already updated unless the application confirms it.
Do not certify structural safety. Distinguish drawing interpretation from verified engineering design. Use Markdown when useful and keep answers practical.`;

export const config = { maxDuration: 60 };

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

const tools = [
  {
    type: "function",
    function: {
      name: "render_building_model",
      description: "Create the initial complete structured building model from the uploaded drawings and calculations. Call this when the user asks to generate or reconstruct the building in 3D. Include all supported foundations, columns, beams, slabs, walls, grids, levels and reinforcement. Do not invent missing data.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["model"],
        properties: { model: BUILDING_MODEL_SCHEMA }
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
          model: BUILDING_MODEL_SCHEMA,
          reason: { type: "string", minLength: 1 }
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
          category: { type: "string", enum: ["foundations", "columns", "beams", "slabs", "walls", "reinforcement", "grids", "all"] },
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
      description: "Add a reinforcement layout to an existing beam, column, slab, wall or foundation. Use only reinforcement details stated in the drawings or derived by an explicitly described calculation. Do not invent bar sizes, spacing, quantities or cover. Include provenance for every supplied value.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["elementId", "arrangement", "barDiameter", "provenance"],
        properties: {
          elementId: { type: "string", minLength: 1 },
          arrangement: { type: "string", enum: ["longitudinal", "transverse", "top", "bottom", "both_faces", "closed_stirrups", "links", "mesh", "custom"] },
          barDiameter: { type: "object", additionalProperties: false, required: ["value", "provenance"], properties: { value: { type: "number", exclusiveMinimum: 0 }, provenance } },
          quantity: { type: "integer", minimum: 1 },
          spacing: { type: "object", additionalProperties: false, required: ["value", "provenance"], properties: { value: { type: "number", exclusiveMinimum: 0 }, provenance } },
          cover: { type: "object", additionalProperties: false, required: ["value", "provenance"], properties: { value: { type: "number", exclusiveMinimum: 0 }, provenance } },
          grade: { type: "string" },
          notes: { type: "string" },
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
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return { ok: false, error: "Tool arguments must be a JSON object." };
  }

  if (name === "render_building_model" || name === "update_building_model") {
    const result = validateBuildingModel(args.model);
    if (!result.valid) return { ok: false, error: "The proposed building model failed validation.", validationErrors: result.errors.slice(0, 30) };
    state.model = args.model;
    state.actions.push({ type: "model.replace", model: args.model, reason: name === "render_building_model" ? "Initial model generated from project information." : args.reason });
    return { ok: true, modelId: args.model.id, elementCounts: Object.fromEntries(Object.entries(args.model.structure).map(([key, value]) => [key, Array.isArray(value) ? value.length : 0])), message: "The model passed structural data validation and is ready for the 3D renderer." };
  }

  if (name === "set_model_visibility") {
    const allowed = ["foundations", "columns", "beams", "slabs", "walls", "reinforcement", "grids", "all"];
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
      barDiameter,
      ...(args.quantity !== undefined ? { quantity: args.quantity } : {}),
      ...(args.spacing ? { spacing: args.spacing } : {}),
      ...(args.cover ? { cover: args.cover } : {}),
      ...(args.grade ? { grade: args.grade } : {}),
      ...(args.notes ? { notes: args.notes } : {}),
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

async function callMeta({ apiKey, messages, useTools = true }) {
  const response = await fetch("https://api.meta.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      model: "muse-spark-1.3",
      stream: false,
      messages,
      ...(useTools ? { tools, tool_choice: "auto" } : {}),
      max_completion_tokens: 8192,
      reasoning_effort: "low"
    })
  });

  const raw = await response.text();
  let payload;
  try { payload = raw ? JSON.parse(raw) : null; }
  catch { throw new Error("Meta AI returned an unreadable response."); }

  if (!response.ok) {
    const providerMessage = payload?.error?.message || payload?.message;
    console.error("Meta API request failed:", response.status, String(providerMessage || "").slice(0, 400));
    const error = new Error(response.status === 401 || response.status === 403
      ? "Meta API authentication failed. Check META_API_KEY in Vercel."
      : "Meta AI request failed (HTTP " + response.status + "). " + (providerMessage || "Please try again."));
    error.status = response.status >= 500 ? 502 : response.status;
    throw error;
  }
  return payload;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const body = req.body || {};
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const history = Array.isArray(body.history) ? body.history.slice(-20) : [];
  const attachments = Array.isArray(body.attachments) ? body.attachments.slice(0, 8) : [];

  if (!message) return res.status(400).json({ error: "Enter a message first." });
  if (message.length > 6000) return res.status(413).json({ error: "Message is too long." });
  if (history.some(item => !item || !["user", "assistant"].includes(item.role) || typeof item.content !== "string")) {
    return res.status(400).json({ error: "Conversation format is invalid." });
  }

  let attachmentText = "";
  const imageParts = [];
  for (const item of attachments) {
    if (!item || typeof item.name !== "string" || typeof item.type !== "string") continue;
    if (item.kind === "text" && typeof item.content === "string") {
      attachmentText += "\n\n[Attached document: " + item.name + "]\n" + item.content.slice(0, 45000);
    } else if (item.kind === "image" && typeof item.dataUrl === "string" &&
      /^data:image\/(jpeg|png|webp);base64,/.test(item.dataUrl) && item.dataUrl.length <= 1500000) {
      imageParts.push({ type: "image_url", image_url: { url: item.dataUrl, detail: "high" } });
    }
    if (Array.isArray(item.pageImages)) {
      for (const page of item.pageImages.slice(0, 2)) {
        if (typeof page?.dataUrl === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(page.dataUrl) && page.dataUrl.length <= 850000) {
          imageParts.push({ type: "image_url", image_url: { url: page.dataUrl, detail: "high" } });
        }
      }
    }
  }
  if (attachmentText.length > 60000) attachmentText = attachmentText.slice(0, 60000) + "\n[Document text truncated.]";
  if (imageParts.length > 3) imageParts.length = 3;

  const apiKey = process.env.META_API_KEY;
  if (!apiKey) return res.status(503).json({ error: "Meta Model API is not configured. Add META_API_KEY in Vercel environment variables." });

  let currentModel = body.currentModel ?? null;
  if (currentModel) {
    const validation = validateBuildingModel(currentModel);
    if (!validation.valid) return res.status(400).json({ error: "The current project model is invalid.", details: validation.errors.slice(0, 20) });
  }

  const state = { model: currentModel, actions: [] };
  const modelContext = currentModel
    ? "\n\nCurrent validated project model (preserve its existing verified data unless instructed otherwise):\n" + JSON.stringify(currentModel).slice(0, 50000)
    : "\n\nNo building model has been generated for this project yet.";
  const messages = [
    { role: "developer", content: SYSTEM_PROMPT + modelContext },
    ...history.map(({ role, content }) => ({ role, content: content.slice(0, 12000) })),
    { role: "user", content: imageParts.length ? [{ type: "text", text: message + attachmentText }, ...imageParts] : message + attachmentText }
  ];

  try {
    let payload = null;
    let finalAnswer = "";
    let completed = false;

    // Bounded tool loop: Meta may request multiple tools in one turn or across turns.
    for (let turn = 0; turn < 5; turn++) {
      payload = await callMeta({ apiKey, messages });
      const choice = payload?.choices?.[0];
      const assistantMessage = choice?.message || {};
      const toolCalls = Array.isArray(assistantMessage.tool_calls) ? assistantMessage.tool_calls : [];

      if (choice?.finish_reason !== "tool_calls" && toolCalls.length === 0) {
        finalAnswer = getText(assistantMessage.content) || getText(assistantMessage.refusal) || getText(choice?.text);
        completed = true;
        break;
      }

      // The full assistant tool-call message must be replayed before tool results.
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
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      }
    }

    if (!completed) {
      finalAnswer = "I processed the available model commands, but the tool-call sequence reached its safety limit. Please tell me what you want to do next.";
    }

    if (!finalAnswer.trim() && state.actions.length) {
      finalAnswer = "I've prepared the requested model operation. The structured model data has been validated and returned to the workspace.";
    }
    if (!finalAnswer.trim()) {
      console.error("Meta API returned an empty answer:", JSON.stringify({
        finish_reason: payload?.choices?.[0]?.finish_reason || null,
        tool_call_count: state.actions.length,
        usage: payload?.usage || null
      }));
      return res.status(502).json({ error: "Meta AI returned no user-facing answer. Please try again." });
    }

    return res.status(200).json({
      answer: finalAnswer,
      actions: state.actions,
      model: state.model
    });
  } catch (error) {
    console.error("BuildLens Meta request failed:", error?.name || "Error");
    return res.status(error.status || 502).json({ error: error.message || "Could not reach Meta AI. Check the connection and try again." });
  }
}
