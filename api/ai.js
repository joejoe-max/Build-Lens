const SYSTEM_PROMPT = `You are BuildLens, a helpful engineering and building assistant.
Answer the user's actual question directly and naturally. Do not force every response into categories such as specified, inferred, assumed, or unverified.
Only discuss drawing interpretation, missing drawing information, assumptions, or document limitations when the user has actually supplied a drawing, image, document, or relevant project data, or when those limitations genuinely matter to the question.
If no project file has been supplied, answer general questions normally.
When reviewing supplied documents, distinguish facts visible in the source from interpretation and uncertainty. Refer to page numbers or visible labels where possible.
Never invent dimensions, reinforcement, loads, material strengths, design-code checks, or calculation results.
Do not certify structural safety without sufficient inputs and valid calculations. State when qualified engineering verification is needed.
Use Markdown where it improves readability. Keep answers practical and proportionate.`;

export const config = { maxDuration: 60 };

function contentText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(part => part?.text || "").join("");
  return "";
}

function emitPacket(packet, send, state) {
  const choice = packet?.choices?.[0];
  const delta = contentText(choice?.delta?.content);
  const complete = !state.sentAny ? contentText(choice?.message?.content) : "";
  const text = delta || complete;
  if (text) {
    send("delta", { text });
    state.sentAny = true;
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
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
  const send = (event, data) => {
    if (!res.writableEnded) res.write("event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n");
  };

  try {
    const requestModel = stream => fetch("https://api.meta.ai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json", Accept: stream ? "text/event-stream" : "application/json" },
      body: JSON.stringify({ model: "muse-spark-1.3", stream, messages, temperature: 0.2, max_tokens: 1800 })
    });

    let upstream = await requestModel(true);
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      console.error("Meta API streaming request failed:", upstream.status, detail.slice(0, 400));
      // Some model gateways reject streaming outright. Retry as a normal completion.
      upstream = await requestModel(false);
      if (!upstream.ok) {
        const fallbackDetail = await upstream.text().catch(() => "");
        console.error("Meta API non-stream request failed:", upstream.status, fallbackDetail.slice(0, 400));
        return res.status(upstream.status >= 500 ? 502 : upstream.status).json({
          error: upstream.status === 401 || upstream.status === 403
            ? "Meta API authentication failed. Check META_API_KEY in Vercel."
            : "Meta AI request failed (HTTP " + upstream.status + "). Please try again."
        });
      }
    }

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    const state = { sentAny: false };
    const type = upstream.headers.get("content-type") || "";

    if (type.includes("application/json")) {
      emitPacket(await upstream.json(), send, state);
    } else if (upstream.body) {
      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || "";
          for (const raw of lines) {
            const line = raw.trim();
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            try { emitPacket(JSON.parse(data), send, state); } catch { /* Ignore malformed stream frames. */ }
          }
        }
        buffer += decoder.decode();
        const last = buffer.trim();
        if (last.startsWith("data:")) {
          const data = last.slice(5).trim();
          if (data && data !== "[DONE]") {
            try { emitPacket(JSON.parse(data), send, state); } catch { /* Ignore incomplete final frame. */ }
          }
        }
      } finally {
        reader.releaseLock();
      }
    }

    if (!state.sentAny) {
      // Retry without streaming when the provider accepted the request but returned no deltas.
      const fallback = await requestModel(false);
      if (fallback.ok) emitPacket(await fallback.json(), send, state);
      else {
        const detail = await fallback.text().catch(() => "");
        console.error("Meta fallback response failed:", fallback.status, detail.slice(0, 400));
      }
    }
    if (!state.sentAny) send("error", { message: "Meta AI returned an empty response. The model did not provide a readable answer. Please try again." });
    send("done", {});
    res.end();
  } catch (error) {
    console.error("BuildLens Meta request error:", error?.name || "Error");
    if (res.headersSent) {
      send("error", { message: "The connection to Meta AI was interrupted. Please try again." });
      res.end();
    } else {
      return res.status(502).json({ error: "Could not reach Meta AI. Check your connection and try again." });
    }
  }
}