const SYSTEM_PROMPT = `You are BuildLens, a helpful engineering and building assistant.
Answer the user's actual question directly and naturally. Do not force every response into categories such as specified, inferred, assumed, or unverified.
Only discuss drawing interpretation, missing drawing information, assumptions, or document limitations when the user has actually supplied a drawing, image, document, or relevant project data, or when those limitations genuinely matter to the question.
If no project file has been supplied, do not tell the user that a drawing is missing unless they ask you to analyse a drawing or a task clearly depends on one. Answer general questions normally.
When reviewing supplied documents, distinguish facts visible in the source from interpretation and uncertainty in plain language. Refer to page numbers or visible labels where possible.
Never invent dimensions, reinforcement, loads, bending moments, material strengths, design-code checks, or calculation results and present them as facts.
Do not certify structural safety or assert a component will fail without sufficient inputs and valid calculations. State when qualified engineering verification is needed.
Use Markdown where it improves readability: headings, lists, tables, inline code and LaTeX-style equations when appropriate. Keep answers practical and proportionate to the question.`;

export const config = { maxDuration: 60 };

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
      attachmentText += `\n\n[Attached document: ${item.name}]\n${item.content.slice(0, 45000)}`;
    } else if (item.kind === "image" && typeof item.dataUrl === "string" &&
      /^data:image\/(jpeg|png|webp);base64,/.test(item.dataUrl) && item.dataUrl.length <= 1500000) {
      imageParts.push({ type: "image_url", image_url: { url: item.dataUrl, detail: "high" } });
    }
  }
  if (attachmentText.length > 60000) attachmentText = attachmentText.slice(0, 60000) + "\n[Document text truncated.]";
  if (imageParts.length > 4) return res.status(400).json({ error: "Attach no more than four pictures per message." });

  const apiKey = process.env.META_API_KEY;
  if (!apiKey) return res.status(503).json({ error: "Meta Model API is not configured. Add META_API_KEY in Vercel environment variables." });

  try {
    const userContent = [{ type: "text", text: message + attachmentText }, ...imageParts];
    const upstream = await fetch("https://api.meta.ai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({
        model: "muse-spark-1.3",
        stream: true,
        messages: [
          { role: "developer", content: SYSTEM_PROMPT },
          ...history.map(({ role, content }) => ({ role, content })),
          { role: "user", content: imageParts.length ? userContent : message + attachmentText }
        ],
        temperature: 0.2,
        max_tokens: 1800
      })
    });
    if (!upstream.ok) {
      const errorBody = await upstream.text().catch(() => "");
      console.error("Meta API error:", upstream.status, errorBody.slice(0, 500));
      return res.status(upstream.status >= 500 ? 502 : upstream.status).json({
        error: upstream.status === 401 || upstream.status === 403
          ? "Meta API authentication failed. Check META_API_KEY in Vercel."
          : `Meta AI request failed (HTTP ${upstream.status}). Please try again.`
      });
    }
    if (!upstream.body) return res.status(502).json({ error: "Meta AI did not return a readable response stream." });

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let sentAny = false;
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith("data:")) continue;
          const raw = line.slice(5).trim();
          if (!raw || raw === "[DONE]") continue;
          let packet;
          try { packet = JSON.parse(raw); } catch { continue; }
          const delta = packet?.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta) {
            send("delta", { text: delta });
            sentAny = true;
          } else if (Array.isArray(delta)) {
            const text = delta.map(part => part?.text || "").join("");
            if (text) { send("delta", { text }); sentAny = true; }
          }
          const finish = packet?.choices?.[0]?.finish_reason;
          if (finish) send("status", { finish });
        }
      }
    } finally {
      if (!res.writableEnded) {
        if (!sentAny) send("error", { message: "Meta AI ended the stream without returning any text. Check whether streaming is supported for this model." });
        send("done", {});
        res.end();
      }
      reader.releaseLock();
    }
  } catch (error) {
    console.error("BuildLens Meta streaming error:", error?.name || "Error");
    if (res.headersSent) {
      res.write(`event: error\ndata: ${JSON.stringify({ message: "The connection to Meta AI was interrupted. Please try again." })}\n\n`);
      res.end();
    } else {
      return res.status(502).json({ error: "Could not reach Meta AI. Check your connection and try again." });
    }
  }
}