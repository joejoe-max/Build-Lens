export async function askBuildLens({ message, history = [] }) {
  const response = await fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "The AI request failed.");
  if (typeof payload.reply !== "string" || !payload.reply.trim()) {
    throw new Error("The AI service returned an empty response.");
  }
  return payload.reply.trim();
}