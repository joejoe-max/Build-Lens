const SYSTEM_PROMPT = `You are BuildLens, a helpful engineering and building assistant.
Answer the user's actual question directly and naturally. Do not force every response into categories such as specified, inferred, assumed, or unverified.
Only discuss drawing interpretation, missing drawing information, assumptions, or document limitations when the user has actually supplied a drawing, image, document, or relevant project data, or when those limitations genuinely matter to the question.
If no project file has been supplied, answer general questions normally.
When reviewing supplied documents, distinguish facts visible in the source from interpretation and uncertainty. Refer to page numbers or visible labels where possible.
Never invent dimensions, reinforcement, loads, material strengths, design-code checks, or calculation results.
Do not certify structural safety without sufficient inputs and valid calculations. State when qualified engineering verification is needed.
Use Markdown where it improves readability. Keep answers practical and proportionate.`;

export const config = { maxDuration: 60 };

function getText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(part => part?.text || "").join("");
  return "";
}

function extractAnswer(payload) {
  return getText(payload?.choices?.[0]?.message?.content)
    || getText(payload?.output_text)
    || getText(payload?.response);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const body = req.body || {};
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const history = Array.isArray(body.history) ? body.history.slice(-10) : [];
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
  }
  if (attachmentText.length > 60000) attachmentText = attachmentText.slice(0, 60000) + "\n[Document text truncated.]";
  if (imageParts.length > 4) return res.status(400).json({ error: "Attach no more than four pictures per message." });

  const apiKey = process.env.META_API_KEY;
  if (!apiKey) return res.status(503).json({ error: "Meta Model API is not configured. Add META_API_KEY in Vercel environment variables." });

  const messages = [
    { role: "developer", content: SYSTEM_PROMPT },
    ...history.map(({ role, content }) => ({ role, content })),
    { role: "user", content: imageParts.length ? [{ type: "text", text: message + attachmentText }, ...imageParts] : message + attachmentText }
  ];

  try {
    // Use a normal request/response on Vercel Functions. No SSE is opened or parsed
    // between the browser and this serverless endpoint.
    const upstream = await fetch("https://api.meta.ai/v1/chat/completions", {
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
        // Muse Spark is a reasoning model. Reasoning and the final answer share
        // the completion budget; a small max_tokens value can leave content empty.
        max_completion_tokens: 8192,
        reasoning_effort: "low"
      })
    });

    const raw = await upstream.text();
    let payload;
    try { payload = raw ? JSON.parse(raw) : null; }
    catch {
      console.error("Meta API returned non-JSON content. HTTP:", upstream.status, "Content-Type:", upstream.headers.get("content-type"));
      return res.status(502).json({ error: "Meta AI returned an unreadable response. Check the model endpoint and API configuration." });
    }

    if (!upstream.ok) {
      const providerMessage = payload?.error?.message || payload?.message;
      console.error("Meta API request failed:", upstream.status, String(providerMessage || "").slice(0, 400));
      return res.status(upstream.status >= 500 ? 502 : upstream.status).json({
        error: upstream.status === 401 || upstream.status === 403
          ? "Meta API authentication failed. Check META_API_KEY in Vercel."
          : "Meta AI request failed (HTTP " + upstream.status + "). " + (providerMessage || "Please try again.")
      });
    }

    const choice = payload?.choices?.[0];
    const answer = extractAnswer(payload) || getText(choice?.message?.refusal) || getText(choice?.text);
    if (!answer.trim()) {
      // Log only response metadata, never prompts, document text, or model reasoning.
      console.error("Meta API returned an empty user-facing answer:", JSON.stringify({
        finish_reason: choice?.finish_reason || null,
        message_keys: Object.keys(choice?.message || {}),
        has_reasoning_content: Boolean(choice?.message?.reasoning_content || choice?.message?.reasoning),
        reasoning_characters: String(choice?.message?.reasoning_content || choice?.message?.reasoning || "").length,
        tool_call_count: Array.isArray(choice?.message?.tool_calls) ? choice.message.tool_calls.length : 0,
        usage: payload?.usage || null,
        model: payload?.model || null
      }));
      const finish = choice?.finish_reason;
      const detail = finish === "length"
        ? "The model used its output-token budget on reasoning before producing the final answer. The output budget has been increased; please try again."
        : finish === "tool_calls"
          ? "The model returned a tool call instead of a text answer, but BuildLens has no tool handler configured for this request."
          : "The provider returned no user-facing text. Please try again; diagnostic metadata has been recorded.";
      return res.status(502).json({ error: detail });
    }

    return res.status(200).json({ answer });
  } catch (error) {
    console.error("BuildLens Meta request failed:", error?.name || "Error");
    return res.status(502).json({ error: "Could not reach Meta AI. Check the connection and try again." });
  }
}