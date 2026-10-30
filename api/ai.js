const SYSTEM_PROMPT = `You are BuildLens, an engineering-document interpretation assistant.
Help engineers inspect supplied project documents and images, organize stated facts, identify conflicts, and list missing information.
Separate information into: specified (directly supported by supplied documents), inferred (interpreted from evidence), assumed (provisional and must be confirmed), and unverified.
When a user attaches a drawing, photo, PDF, or text document, inspect the content actually included in the request. Refer to page numbers or visible labels where possible. If an image is unclear, say so.
Never invent dimensions, reinforcement, loads, bending moments, material strengths, design-code checks, or calculation results and present them as facts.
If information is missing, continue helping with what is available and clearly label any illustrative assumption.
Do not certify structural safety or assert a component will fail without sufficient inputs and a valid engineering calculation. Describe concerns as preliminary and state what must be verified by a qualified engineer.
Keep responses practical and concise.`;

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const body = req.body || {};
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const history = Array.isArray(body.history) ? body.history.slice(-8) : [];
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
      /^data:image\/(jpeg|png|webp);base64,/.test(item.dataUrl) &&
      item.dataUrl.length <= 1500000) {
      imageParts.push({ type: "image_url", image_url: { url: item.dataUrl, detail: "high" } });
    }
  }
  if (attachmentText.length > 60000) attachmentText = attachmentText.slice(0, 60000) + "\n[Document text truncated.]";
  if (imageParts.length > 4) return res.status(400).json({ error: "Attach no more than four pictures per message." });

  const apiKey = process.env.META_API_KEY;
  if (!apiKey) return res.status(503).json({ error: "Meta Model API is not configured. Add META_API_KEY in Vercel environment variables." });

  try {
    const userContent = [{ type: "text", text: message + attachmentText }];
    userContent.push(...imageParts);
    const upstream = await fetch("https://api.meta.ai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "muse-spark-1.3",
        messages: [
          { role: "developer", content: SYSTEM_PROMPT },
          ...history.map(({ role, content }) => ({ role, content })),
          { role: "user", content: imageParts.length ? userContent : message + attachmentText }
        ],
        temperature: 0.2,
        max_tokens: 1200
      })
    });
    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      console.error("Meta Model API request failed:", upstream.status);
      return res.status(upstream.status >= 500 ? 502 : upstream.status).json({
        error: upstream.status === 401 || upstream.status === 403
          ? "Meta API authentication failed. Check META_API_KEY in Vercel."
          : "Meta AI could not complete that request. Please try again."
      });
    }
    const reply = payload?.choices?.[0]?.message?.content;
    if (typeof reply !== "string" || !reply.trim()) return res.status(502).json({ error: "Meta AI returned an empty response." });
    return res.status(200).json({ reply: reply.trim() });
  } catch (error) {
    console.error("BuildLens AI proxy error:", error?.name || "Error");
    return res.status(502).json({ error: "Could not reach Meta AI. Check your connection and try again." });
  }
}