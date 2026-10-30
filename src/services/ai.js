export async function askBuildLens({ message, history = [], attachments = [], onDelta = () => {} }) {
  const response = await fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream, application/json" },
    body: JSON.stringify({ message, history, attachments })
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "The AI request failed.");
  }
  if (!response.body) throw new Error("The AI response was empty.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let streamError = "";
  const handleEvent = block => {
    let eventName = "message";
    const dataLines = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (!dataLines.length) return;
    let payload;
    try { payload = JSON.parse(dataLines.join("\n")); } catch { return; }
    if (eventName === "delta" && typeof payload.text === "string") {
      fullText += payload.text;
      onDelta(fullText);
    } else if (eventName === "error") {
      streamError = payload.message || "The AI response stream failed.";
    }
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() || "";
      events.forEach(handleEvent);
    }
    buffer += decoder.decode();
    if (buffer.trim()) handleEvent(buffer);
  } finally {
    reader.releaseLock();
  }
  if (!fullText.trim()) throw new Error(streamError || "Meta AI returned an empty response. Please try again.");
  return fullText;
}