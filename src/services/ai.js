function readableError(value) {
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object") {
    if (typeof value.message === "string" && value.message.trim()) return value.message;
    if (typeof value.error === "string" && value.error.trim()) return value.error;
    if (value.error && typeof value.error === "object") return readableError(value.error);
    if (Array.isArray(value.details) && value.details.length) return value.details.map(item => typeof item === "string" ? item : item?.message || JSON.stringify(item)).join("; ");
    try { return JSON.stringify(value); } catch {}
  }
  return "The AI request failed.";
}

export async function askBuildLens({ message, history = [], attachments = [], currentModel = null, onDelta = () => {}, onActions = () => {}, onStatus = () => {} }) {
  const response = await fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "text/event-stream" },
    body: JSON.stringify({ message, history, attachments, currentModel })
  });
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok && contentType.includes("application/json")) {
    let payload = null;
    try { payload = await response.json(); } catch {}
    throw new Error(readableError(payload?.error || payload?.details) || "The AI request failed (HTTP " + response.status + ").");
  }
  if (!contentType.includes("text/event-stream") || !response.body) {
    const raw = await response.text();
    throw new Error("Expected a streaming response from /api/ai but received " + (contentType || "an unknown content type") + ". Response: " + raw.slice(0, 180).replace(/\s+/g, " "));
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", answer = "", completed = false, streamError = null, modelEventReceived = false;
  const handleEvent = frame => {
    let event = "message";
    const data = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trim());
    }
    if (!data.length) return;
    let payload;
    try { payload = JSON.parse(data.join("\n")); } catch { return; }
    if (event === "status") onStatus(payload.message || "BuildLens is working…");
    if (event === "delta" && typeof payload.text === "string") { answer += payload.text; onDelta(answer); }
    if (event === "model") { modelEventReceived = true; onActions({ actions: Array.isArray(payload.actions) ? payload.actions : [], model: payload.model ?? currentModel, findings: Array.isArray(payload.findings) ? payload.findings : [] }); }
    if (event === "error") streamError = new Error(readableError(payload.error));
    if (event === "done") {
      completed = true;
      if (!answer && typeof payload.answer === "string") { answer = payload.answer; onDelta(answer); }
      if (!modelEventReceived && !payload.model && payload.actions?.length) onActions({ actions: payload.actions, model: currentModel, findings: payload.findings || [] });
    }
  };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() || "";
    for (const frame of frames) handleEvent(frame);
  }
  buffer += decoder.decode();
  if (buffer.trim()) handleEvent(buffer);
  if (streamError) throw streamError;
  if (!completed) throw new Error("The connection closed before BuildLens confirmed completion. Any model already received remains in the workspace.");
  if (!answer.trim()) throw new Error("BuildLens finished without a readable explanation.");
  return answer;
}
