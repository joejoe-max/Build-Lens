export async function askBuildLens({ message, history = [], attachments = [], currentModel = null, onDelta = () => {}, onActions = () => {} }) {
  const response = await fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ message, history, attachments, currentModel })
  });

  const contentType = response.headers.get("content-type") || "";
  const raw = await response.text();
  let payload = null;
  if (contentType.includes("application/json")) {
    try { payload = raw ? JSON.parse(raw) : null; }
    catch { throw new Error("The BuildLens API returned invalid JSON."); }
  } else {
    const preview = raw.slice(0, 180).replace(/\s+/g, " ");
    throw new Error("Expected a JSON response from /api/ai but received " +
      (contentType || "an unknown content type") +
      ". This usually means the request reached the frontend fallback instead of the Vercel function. Response: " + preview);
  }

  if (!response.ok) throw new Error(payload?.error || "The AI request failed (HTTP " + response.status + ").");
  if (typeof payload?.answer !== "string" || !payload.answer.trim()) {
    throw new Error(payload?.error || "The AI endpoint returned JSON without an answer field.");
  }

  onActions({
    actions: Array.isArray(payload.actions) ? payload.actions : [],
    model: payload.model ?? currentModel
  });
  onDelta(payload.answer);
  return payload.answer;
}
