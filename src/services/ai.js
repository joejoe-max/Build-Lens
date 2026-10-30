export async function askBuildLens({ message, history = [], attachments = [], onDelta = () => {} }) {
  const response = await fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ message, history, attachments })
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "The AI request failed.");
  }
  if (!response.body) throw new Error("Your browser could not read the response stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let finished = false;
  while (!finished) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";
    for (const eventBlock of events) {
      let eventName = "message";
      const dataLines = [];
      for (const line of eventBlock.split("\n")) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (!dataLines.length) continue;
      let payload;
      try { payload = JSON.parse(dataLines.join("\n")); } catch { continue; }
      if (eventName === "delta" && typeof payload.text === "string") {
        fullText += payload.text;
        onDelta(fullText);
      } else if (eventName === "error") {
        throw new Error(payload.message || "The AI stream failed.");
      } else if (eventName === "done") {
        finished = true;
        break;
      }
    }
  }
  if (!fullText.trim()) throw new Error("Meta AI returned an empty response.");
  return fullText;
}