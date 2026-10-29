import { useEffect, useMemo, useState } from "react";
import { Box, Building2, Check, ChevronDown, CircleAlert, FileUp, Layers3, MessageSquare, RotateCcw, Send, ShieldAlert, SlidersHorizontal, Sparkles, X } from "lucide-react";
import BuildingViewport from "./three/BuildingViewport.jsx";

const initialFiles = [
  { id: "sample-plan", name: "Sample-building-plan.pdf", kind: "DEMO", status: "Sample only" },
  { id: "sample-struct", name: "Structural-layout.pdf", kind: "DEMO", status: "Sample only" }
];
const starterMessages = [
  { role: "assistant", content: "BuildLens is ready. This workspace currently shows an illustrative sample building, not a model reconstructed from your drawings. Upload project documents to begin organizing the available information." }
];

export default function App() {
  const [view, setView] = useState("building");
  const [files, setFiles] = useState(initialFiles);
  const [messages, setMessages] = useState(starterMessages);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [mobilePanel, setMobilePanel] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const [projectName, setProjectName] = useState("Untitled project");
  const [editingName, setEditingName] = useState(false);
  const [notice, setNotice] = useState("");
  const [assumptionsOpen, setAssumptionsOpen] = useState(true);

  const views = useMemo(() => [
    { id: "building", label: "Building", icon: Building2 },
    { id: "structure", label: "Structure", icon: Layers3 },
    { id: "foundation", label: "Foundation", icon: Box },
    { id: "rebar", label: "Reinforcement", icon: SlidersHorizontal }
  ], []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("buildlens-workspace-v1");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed.messages) && parsed.messages.length) setMessages(parsed.messages);
        if (Array.isArray(parsed.files) && parsed.files.length) setFiles(parsed.files);
        if (typeof parsed.projectName === "string") setProjectName(parsed.projectName);
      }
    } catch { /* Ignore invalid local workspace data. */ }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("buildlens-workspace-v1", JSON.stringify({ messages: messages.slice(-30), files, projectName }));
    } catch {
      setNotice("Local storage is full. Export or remove some workspace data.");
    }
  }, [messages, files, projectName]);

  const addFiles = event => {
    const selected = Array.from(event.target.files || []);
    if (!selected.length) return;
    const allowed = selected.filter(file => file.size <= 15 * 1024 * 1024);
    const rejected = selected.length - allowed.length;
    const added = allowed.map(file => ({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
      name: file.name,
      kind: file.name.split(".").pop().toUpperCase(),
      status: "Uploaded locally",
      size: file.size
    }));
    setFiles(current => [...current.filter(file => !file.id.startsWith("sample-")), ...added]);
    setNotice(rejected ? `${rejected} file(s) exceeded the 15 MB limit and were skipped.` : "Files listed in this session. This prototype does not yet extract drawing content.");
    event.target.value = "";
  };

  const sendMessage = async event => {
    event?.preventDefault();
    const message = input.trim();
    if (!message || busy) return;
    const nextMessages = [...messages, { role: "user", content: message }];
    setMessages(nextMessages);
    setInput("");
    setBusy(true);
    setMobilePanel(true);
    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          history: nextMessages.slice(-8).slice(0, -1).map(({ role, content }) => ({ role, content }))
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "The AI request failed.");
      setMessages(current => [...current, { role: "assistant", content: payload.reply }]);
    } catch (error) {
      setMessages(current => [...current, {
        role: "assistant",
        content: `I couldn't reach the AI service: ${error.message}. Check that the app is deployed with MODEL_API_KEY configured, or try again later.`
      }]);
    } finally {
      setBusy(false);
    }
  };

  const exportWorkspace = () => {
    const blob = new Blob([JSON.stringify({ app: "BuildLens", exportedAt: new Date().toISOString(), projectName, files, messages }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "buildlens-workspace.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const clearWorkspace = () => {
    if (!window.confirm("Clear this workspace's chat and uploaded-file list? This cannot be undone.")) return;
    setMessages(starterMessages);
    setFiles([]);
    setNotice("Workspace cleared.");
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="BuildLens home">
          <span className="brand-mark"><Layers3 size={19} strokeWidth={2.2} /></span>
          <span>BuildLens</span>
          <span className="brand-tag">WORKSPACE</span>
        </a>
        <div className="project-title">
          {editingName ? <input autoFocus value={projectName} onChange={e => setProjectName(e.target.value)} onBlur={() => setEditingName(false)} onKeyDown={e => e.key === "Enter" && setEditingName(false)} aria-label="Project name" /> : <button className="project-name" onClick={() => setEditingName(true)} title="Rename project">{projectName}<ChevronDown size={14} /></button>}
          <span className="unsaved-dot" /> <span className="saved-label">Local workspace</span>
        </div>
        <div className="top-actions">
          <button className="quiet-button export-button" onClick={exportWorkspace}>Export workspace</button>
          <button className="icon-button mobile-chat-trigger" onClick={() => setMobilePanel(v => !v)} aria-label="Toggle engineering assistant"><MessageSquare size={18} /></button>
          <span className="prototype-pill">PROTOTYPE</span>
        </div>
      </header>

      <div className="workspace">
        <aside className="left-rail">
          <button className="rail-item active" title="Model workspace"><Layers3 size={18} /><span>Model</span></button>
          <button className="rail-item" title="Project documents" onClick={() => document.getElementById("file-input")?.click()}><FileUp size={18} /><span>Files</span></button>
          <div className="rail-bottom"><span className="status-light" /><span>Workspace ready</span></div>
        </aside>

        <section className="model-column">
          <div className="model-toolbar">
            <div className="toolbar-left">
              <span className="section-kicker">3D VIEWPORT</span>
              <span className="toolbar-divider" />
              <span className="model-caption">Illustrative sample · not to scale</span>
            </div>
            <div className="toolbar-right">
              <button className={showLabels ? "tool-button selected" : "tool-button"} onClick={() => setShowLabels(v => !v)}><SlidersHorizontal size={15} /><span>Display</span></button>
              <button className="tool-button" onClick={() => document.querySelector(".viewport-canvas")?.dispatchEvent(new CustomEvent("buildlens-reset"))} title="Reset camera"><RotateCcw size={15} /><span>Reset view</span></button>
            </div>
          </div>

          <div className="viewport-wrap">
            <BuildingViewport view={view} showLabels={showLabels} />
            <div className="viewport-badge"><span className="live-dot" /> CONCEPT MODEL <span className="badge-divider">/</span> DEMO DATA</div>
            <div className="viewport-instructions"><span>DRAG TO ORBIT</span><i /> <span>SCROLL OR PINCH TO ZOOM</span></div>
            <div className="orientation-cube" aria-label="View orientation"><span className="cube-top">Y</span><span className="cube-front">Z</span><span className="cube-side">X</span></div>
          </div>

          <div className="view-tabs" role="tablist" aria-label="Model views">
            {views.map(({ id, label, icon: Icon }) => <button key={id} role="tab" aria-selected={view === id} className={view === id ? "view-tab active" : "view-tab"} onClick={() => setView(id)}><Icon size={16} /><span>{label}</span></button>)}
          </div>

          <section className="details-section">
            <div className="details-heading"><div><span className="section-kicker">MODEL STATUS</span><h2>Information & assumptions</h2></div><button className="icon-button" onClick={() => setAssumptionsOpen(v => !v)} aria-label="Toggle information panel"><ChevronDown size={17} className={assumptionsOpen ? "" : "rotated"} /></button></div>
            {assumptionsOpen && <>
              <div className="status-notice"><CircleAlert size={17} /><div><strong>Demo geometry only</strong><p>This 3D structure is procedurally generated for the prototype. It has not been derived from uploaded engineering drawings or verified calculations.</p></div></div>
              <div className="assumption-grid">
                <div className="assumption-item"><span className="status-chip specified">Specified</span><strong>None yet</strong><p>No project drawings have been interpreted.</p></div>
                <div className="assumption-item"><span className="status-chip inferred">Inferred</span><strong>None yet</strong><p>No geometry has been inferred from source files.</p></div>
                <div className="assumption-item"><span className="status-chip assumed">Assumed</span><strong>Sample frame</strong><p>Floor count, grid and member sizes are illustrative placeholders.</p></div>
              </div>
            </>}
          </section>
        </section>

        <aside className={mobilePanel ? "right-panel mobile-open" : "right-panel"}>
          <div className="panel-heading"><div className="panel-heading-icon"><Sparkles size={16} /></div><div><h2>Engineering assistant</h2><p>Document interpretation & review</p></div><button className="icon-button close-mobile" onClick={() => setMobilePanel(false)} aria-label="Close assistant"><X size={18} /></button></div>
          <div className="assistant-scope"><ShieldAlert size={15} /><span>Preliminary review only. Not a substitute for engineering verification.</span></div>

          <div className="documents-block">
            <div className="block-title"><span>PROJECT FILES</span><span className="count">{files.length}</span></div>
            <label className="upload-drop">
              <input id="file-input" type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.dwg,.dxf,.doc,.docx,.txt,.csv,.xlsx" onChange={addFiles} />
              <FileUp size={17} /><span><strong>Add drawings or calculations</strong><small>PDF, images, CAD and documents · 15 MB each</small></span><span className="plus">+</span>
            </label>
            <div className="file-list">
              {files.length ? files.map(file => <div className="file-row" key={file.id}><div className="file-type">{file.kind.slice(0, 4)}</div><div className="file-info"><strong title={file.name}>{file.name}</strong><small>{file.status}</small></div><button className="icon-button remove-file" onClick={() => setFiles(current => current.filter(item => item.id !== file.id))} aria-label={`Remove ${file.name}`}><X size={14} /></button></div>) : <p className="empty-files">No files added. Upload drawings to start a project review.</p>}
            </div>
            <p className="file-warning">Prototype note: selecting files currently records their names locally. Drawing extraction and image/file transfer to the model are not implemented yet.</p>
          </div>

          <div className="conversation" aria-live="polite">
            {messages.map((message, index) => <article className={message.role === "user" ? "message user-message" : "message assistant-message"} key={index}>
              {message.role !== "user" && <div className="assistant-avatar"><Sparkles size={14} /></div>}
              <div className="message-content"><span className="message-author">{message.role === "user" ? "YOU" : "BUILDLENS"}</span><p>{message.content}</p></div>
            </article>)}
            {busy && <div className="typing"><span /><span /><span /> <small>Reviewing request</small></div>}
          </div>

          <form className="composer" onSubmit={sendMessage}>
            <textarea value={input} onChange={e => setInput(e.target.value)} placeholder="Ask about the project, a member, or missing information…" rows={3} maxLength={6000} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }} aria-label="Message the engineering assistant" />
            <div className="composer-footer"><span>Enter to send · Shift + Enter for new line</span><button type="submit" className="send-button" disabled={!input.trim() || busy} aria-label="Send message"><Send size={16} /></button></div>
          </form>
          <div className="panel-footer"><span><Check size={13} /> API key stays server-side</span><button onClick={clearWorkspace}>Clear workspace</button></div>
        </aside>
      </div>
      {notice && <div className="toast" role="status">{notice}<button onClick={() => setNotice("")} aria-label="Dismiss notification"><X size={14} /></button></div>}
    </main>
  );
}