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
