import React, { useEffect, useState } from "react";
import { ChevronDown, FileUp, Layers3, MessageSquare, X } from "lucide-react";
import Viewport from "./components/Viewport.jsx";
import ModelControls, { ModelViewTabs } from "./components/ModelControls.jsx";
import EngineeringPanel from "./components/EngineeringPanel.jsx";
import AssumptionPanel from "./components/AssumptionPanel.jsx";
import { askBuildLens } from "./services/ai.js";

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
  const [showGrid, setShowGrid] = useState(true);
  const [projectName, setProjectName] = useState("Untitled project");
  const [editingName, setEditingName] = useState(false);
  const [notice, setNotice] = useState("");
  const [assumptionsOpen, setAssumptionsOpen] = useState(true);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("buildlens-workspace-v1");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed.messages) && parsed.messages.length) setMessages(parsed.messages);
        if (Array.isArray(parsed.files)) setFiles(parsed.files);
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
      status: "Listed locally",
      size: file.size
    }));
    setFiles(current => [...current.filter(file => !file.id.startsWith("sample-")), ...added]);
    setNotice(rejected ? `${rejected} file(s) exceeded the 15 MB limit and were skipped.` : "File names added locally. Drawing extraction is not implemented yet.");
    event.target.value = "";
  };

  const sendMessage = async event => {
    event?.preventDefault();
    const message = input.trim();
    if (!message || busy) return;
    const history = messages.slice(-8).map(({ role, content }) => ({ role, content }));
    setMessages(current => [...current, { role: "user", content: message }]);
    setInput("");
    setBusy(true);
    setMobilePanel(true);
    try {
      const reply = await askBuildLens({ message, history });
      setMessages(current => [...current, { role: "assistant", content: reply }]);
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

  return <main className="app-shell">
    <header className="topbar">
      <a className="brand" href="/" aria-label="BuildLens home">
        <span className="brand-mark"><Layers3 size={19} strokeWidth={2.2} /></span><span>BuildLens</span><span className="brand-tag">WORKSPACE</span>
      </a>
      <div className="project-title">
        {editingName
          ? <input autoFocus value={projectName} onChange={e => setProjectName(e.target.value)} onBlur={() => setEditingName(false)} onKeyDown={e => e.key === "Enter" && setEditingName(false)} aria-label="Project name" />
          : <button className="project-name" onClick={() => setEditingName(true)} title="Rename project">{projectName}<ChevronDown size={14} /></button>}
        <span className="unsaved-dot" /><span className="saved-label">Local workspace</span>
      </div>
      <div className="top-actions">
        <button className="quiet-button export-button" onClick={exportWorkspace}>Export workspace</button>
        <button className="icon-button mobile-chat-trigger" onClick={() => setMobilePanel(value => !value)} aria-label="Toggle engineering assistant"><MessageSquare size={18} /></button>
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
          <div className="toolbar-left"><span className="section-kicker">3D VIEWPORT</span><span className="toolbar-divider" /><span className="model-caption">Illustrative sample · not to scale</span></div>
          <ModelControls
            showGrid={showGrid}
            onToggleGrid={() => setShowGrid(value => !value)}
            onReset={() => document.querySelector(".viewport-canvas")?.dispatchEvent(new CustomEvent("buildlens-reset"))}
          />
        </div>
        <div className="viewport-wrap">
          <Viewport view={view} showGrid={showGrid} />
          <div className="viewport-badge"><span className="live-dot" /> CONCEPT MODEL <span className="badge-divider">/</span> DEMO DATA</div>
          <div className="viewport-instructions"><span>DRAG TO ORBIT</span><i /><span>SCROLL OR PINCH TO ZOOM</span></div>
          <div className="orientation-cube" aria-label="View orientation"><span className="cube-top">Y</span><span className="cube-front">Z</span><span className="cube-side">X</span></div>
        </div>
        <ModelViewTabs view={view} onViewChange={setView} />
        <AssumptionPanel open={assumptionsOpen} onToggle={() => setAssumptionsOpen(value => !value)} />
      </section>

      <EngineeringPanel
        open={mobilePanel}
        onClose={() => setMobilePanel(false)}
        files={files}
        onAddFiles={addFiles}
        onRemoveFile={id => setFiles(current => current.filter(file => file.id !== id))}
        messages={messages}
        busy={busy}
        input={input}
        onInputChange={setInput}
        onSend={sendMessage}
        onClear={clearWorkspace}
        onExport={exportWorkspace}
      />
    </div>
    {notice && <div className="toast" role="status">{notice}<button onClick={() => setNotice("")} aria-label="Dismiss notification"><X size={14} /></button></div>}
  </main>;
}