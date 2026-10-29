const SYSTEM_PROMPT = `You are BuildLens, an engineering-document interpretation assistant.
Help engineers inspect the information they provide, organize stated facts, identify conflicts, and list missing information.
Separate information into: specified (directly supported by supplied documents), inferred (interpreted from evidence), assumed (provisional and must be confirmed), and unverified.
Never invent dimensions, reinforcement, loads, bending moments, material strengths, design-code checks, or calculation results and present them as facts.
If information is missing, continue helping with what is available and clearly label any illustrative assumption.
Do not certify structural safety or assert a component will fail without sufficient inputs and a valid engineering calculation. Describe concerns as preliminary and state what must be verified by a qualified engineer.
For this prototype, you cannot actually inspect uploaded file bytes unless their extracted text is included in the request. Be explicit about that limitation.
Keep responses practical and concise.`;

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  // Basic request validation. Production abuse prevention requires a durable
  // rate limiter and, for public use, user/session controls.
  const body = req.body || {};
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const history = Array.isArray(body.history) ? body.history.slice(-8) : [];

  if (!message) return res.status(400).json({ error: "Enter a message first." });
  if (message.length > 6000) return res.status(413).json({ error: "Message is too long. Keep it under 6,000 characters." });
  if (history.some(item => !item || !["user", "assistant"].includes(item.role) || typeof item.content !== "string")) {
    return res.status(400).json({ error: "Conversation format is invalid." });
  }

  const apiKey = process.env.MODEL_API_KEY;
  if (!apiKey) return res.status(503).json({ error: "Meta Model API is not configured yet. Add MODEL_API_KEY in your Vercel environment variables." });

  try {
    const upstream = await fetch("https://api.meta.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "muse-spark-1.3",
        messages: [
          { role: "developer", content: SYSTEM_PROMPT },
          ...history.map(({ role, content }) => ({ role, content })),
          { role: "user", content: message }
        ],
        temperature: 0.2,
        max_tokens: 900
      })
    });

    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      // Do not return upstream headers, request details, or secret values.
      console.error("Meta Model API request failed:", upstream.status);
      return res.status(upstream.status >= 500 ? 502 : upstream.status).json({
        error: upstream.status === 401 || upstream.status === 403
          ? "Meta API authentication failed. Check the server-side key."
          : "Meta AI could not complete that request. Please try again."
      });
    }

    const reply = payload?.choices?.[0]?.message?.content;
    if (typeof reply !== "string" || !reply.trim()) {
      return res.status(502).json({ error: "Meta AI returned an empty response." });
    }
    return res.status(200).json({ reply: reply.trim() });
  } catch (error) {
    console.error("BuildLens AI proxy error:", error?.name || "Error");
    return res.status(502).json({ error: "Could not reach Meta AI. Check your connection and try again." });
  }
}