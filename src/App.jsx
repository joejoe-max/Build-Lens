import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, FileUp, Layers3, MessageSquare, Plus, X, ArrowRight } from "lucide-react";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import mammoth from "mammoth";
import Viewport from "./components/Viewport.jsx";
import ModelControls, { ModelViewTabs } from "./components/ModelControls.jsx";
import EngineeringPanel from "./components/EngineeringPanel.jsx";
import AssumptionPanel from "./components/AssumptionPanel.jsx";
import { askBuildLens } from "./services/ai.js";
import { validateBuildingModel } from "./domain/buildingModel.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const MAX_FILE_SIZE = 12 * 1024 * 1024;
const textExtensions = ["txt", "md", "csv", "json", "xml"];

async function readAttachment(file) {
  const extension = file.name.split(".").pop().toLowerCase();
  if (file.type.startsWith("image/") && ["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    let dataUrl = canvas.toDataURL("image/jpeg", 0.58);
    if (dataUrl.length > 350000) dataUrl = canvas.toDataURL("image/jpeg", 0.42);
    if (dataUrl.length > 350000) throw new Error(`${file.name} could not be compressed small enough. Try a smaller image.`);
    return { id: crypto.randomUUID(), name: file.name, type: "image/jpeg", kind: "image", dataUrl, status: "Image ready to analyse" };
  }
  if (extension === "pdf" || file.type === "application/pdf") {
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const pageRecords = [];
    const maxPages = Math.min(pdf.numPages, 100);
    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const positioned = content.items
        .filter(item => typeof item.str === "string" && item.str.trim())
        .map(item => ({ text: item.str.trim(), x: item.transform?.[4] || 0, y: item.transform?.[5] || 0, width: item.width || 0 }))
        .sort((a, b) => Math.abs(b.y - a.y) > 2.5 ? b.y - a.y : a.x - b.x);
      const rows = [];
      for (const item of positioned) {
        let row = rows.find(candidate => Math.abs(candidate.y - item.y) <= 2.5);
        if (!row) { row = { y: item.y, items: [] }; rows.push(row); }
        row.items.push(item);
      }
      const pageText = rows
        .sort((a, b) => b.y - a.y)
        .map(row => {
          row.items.sort((a, b) => a.x - b.x);
          let line = "";
          let previous = null;
          for (const item of row.items) {
            if (previous) {
              const gap = item.x - (previous.x + previous.width);
              line += gap > 34 ? "  |  " : " ";
            }
            line += item.text;
            previous = item;
          }
          return line.trim();
        })
        .filter(Boolean)
        .join("\n");
      pageRecords.push({ pageNumber, text: pageText });
    }

    // Choose page previews across the whole drawing set: first/last/middle,
    // plus sheets whose extracted text suggests plans, sections or schedules.
    const keywords = /architect|structur|foundation|footing|column|beam|slab|reinforc|rebar|schedule|section|elevation|stair|roof|layout|framing|general arrangement|bar mark/i;
    const ranked = pageRecords.map(record => {
      const hits = (record.text.match(new RegExp(keywords.source, "gi")) || []).length;
      const spread = record.pageNumber === 1 || record.pageNumber === maxPages || record.pageNumber === Math.ceil(maxPages / 2);
      return { ...record, score: hits * 3 + (spread ? 4 : 0) + (record.text.length > 100 ? 1 : 0) };
    }).sort((a, b) => b.score - a.score || a.pageNumber - b.pageNumber);
    const selectedPages = new Set(ranked.slice(0, Math.min(8, ranked.length)).map(record => record.pageNumber));
    // Scanned sheets have no searchable text; include evenly spaced pages.
    if (pageRecords.every(record => !record.text)) {
      for (let i = 0; i < Math.min(8, maxPages); i++) selectedPages.add(Math.max(1, Math.min(maxPages, Math.round(1 + i * (maxPages - 1) / 7))));
    }

    const pageImages = [];
    for (const pageNumber of [...selectedPages].sort((a, b) => a - b)) {
      const page = await pdf.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(1, 900 / base.width) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      let dataUrl = canvas.toDataURL("image/jpeg", 0.46);
      if (dataUrl.length > 260000) dataUrl = canvas.toDataURL("image/jpeg", 0.34);
      if (dataUrl.length <= 260000) pageImages.push({ pageNumber, dataUrl });
      canvas.width = 0; canvas.height = 0;
    }
    const extracted = pageRecords
      .filter(record => record.text)
      .map(record => "[Page " + record.pageNumber + "]\n" + record.text)
      .join("\n\n");
    if (!extracted && !pageImages.length) throw new Error(`${file.name} could not be read. Try exporting it again as a standard PDF.`);
    return {
      id: crypto.randomUUID(), name: file.name, type: "application/pdf", kind: "text",
      content: extracted.slice(0, 120000), pageImages,
      status: `Read ${maxPages} of ${pdf.numPages} pages · ${pageImages.length} visual sheets selected`
    };
  }
  if (extension === "docx") {
    const buffer = await file.arrayBuffer();
    const [result, htmlResult] = await Promise.all([
      mammoth.extractRawText({ arrayBuffer: buffer }),
      mammoth.convertToHtml({ arrayBuffer: buffer })
    ]);
    const parsed = new DOMParser().parseFromString(htmlResult.value, "text/html");
    const tables = [...parsed.querySelectorAll("table")].map((table, index) => {
      const rows = [...table.querySelectorAll("tr")].map(row =>
        [...row.querySelectorAll("th,td")].map(cell => cell.textContent.trim()).join(" | ")
      ).filter(Boolean);
      return rows.length ? "[Table " + (index + 1) + "]\n" + rows.join("\n") : "";
    }).filter(Boolean);
    const content = [result.value.trim(), ...tables].filter(Boolean).join("\n\n");
    if (!content.trim()) throw new Error(`${file.name} contains no extractable text.`);
    return { id: crypto.randomUUID(), name: file.name, type: file.type, kind: "text", content: content.slice(0, 120000), status: `Document text + ${tables.length} table(s) extracted` };
  }
  if (textExtensions.includes(extension) || file.type.startsWith("text/")) {
    return { id: crypto.randomUUID(), name: file.name, type: file.type || "text/plain", kind: "text", content: (await file.text()).slice(0, 120000), status: "Text ready to analyse" };
  }
  throw new Error(`${file.name}: this format is not supported yet. Use PDF, DOCX, TXT, CSV, JSON, PNG, JPG or WEBP.`);
}

const ATTACHMENT_DB = "buildlens-project-files";
const ATTACHMENT_STORE = "attachments";
function openAttachmentDB() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) return reject(new Error("IndexedDB unavailable"));
    const request = indexedDB.open(ATTACHMENT_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(ATTACHMENT_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function readSavedAttachments() {
  const db = await openAttachmentDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction(ATTACHMENT_STORE, "readonly").objectStore(ATTACHMENT_STORE).get("active-project");
    request.onsuccess = () => { resolve(Array.isArray(request.result) ? request.result : []); db.close(); };
    request.onerror = () => { reject(request.error); db.close(); };
  });
}
async function writeSavedAttachments(attachments) {
  const db = await openAttachmentDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(ATTACHMENT_STORE, "readwrite");
    transaction.objectStore(ATTACHMENT_STORE).put(attachments, "active-project");
    transaction.oncomplete = () => { resolve(); db.close(); };
    transaction.onerror = () => { reject(transaction.error); db.close(); };
  });
}
async function clearSavedAttachments() {
  try { await writeSavedAttachments([]); } catch { /* Local file cache is best-effort. */ }
}

export default function App() {
  const [view, setView] = useState("building");
  const [files, setFiles] = useState([]);
  const [pendingAttachments, setPendingAttachments] = useState([]);
  const [projectAttachments, setProjectAttachments] = useState([]);
  const [attachmentsHydrated, setAttachmentsHydrated] = useState(false);
  const [modelSpec, setModelSpec] = useState(null);
  const [modelActions, setModelActions] = useState([]);
  const [drawingFindings, setDrawingFindings] = useState([]);
  const [focusedFinding, setFocusedFinding] = useState(null);
  const messagesRef = useRef([]);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("BuildLens is responding…");
  const [mobilePanel, setMobilePanel] = useState(false);
  const [hasStartedChat, setHasStartedChat] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [projectName, setProjectName] = useState("Untitled project");
  const [editingName, setEditingName] = useState(false);
  const [notice, setNotice] = useState("");
  const [assumptionsOpen, setAssumptionsOpen] = useState(true);
  const fileInputRef = useRef(null);

  useEffect(() => {
    readSavedAttachments().then(saved => {
      if (saved.length) { setProjectAttachments(saved); setPendingAttachments([]); }
      setAttachmentsHydrated(true);
    }).catch(() => setAttachmentsHydrated(true));
    try {
      const saved = localStorage.getItem("buildlens-workspace-v2");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed.messages) && parsed.messages.length) {
          const safeMessages = parsed.messages.map(item => {
            if (!item || typeof item !== "object") return item;
            if (item.modelSpec && !validateBuildingModel(item.modelSpec).valid) {
              const { modelSpec: ignoredModel, ...safeItem } = item;
              return safeItem;
            }
            return item;
          });
          messagesRef.current = safeMessages;
          setMessages(safeMessages);
        }
        if (Array.isArray(parsed.files)) setFiles(parsed.files);
        if (typeof parsed.projectName === "string") setProjectName(parsed.projectName);
        if (parsed.modelSpec && typeof parsed.modelSpec === "object") {
          const validation = validateBuildingModel(parsed.modelSpec);
          if (validation.valid) setModelSpec(parsed.modelSpec);
          else setNotice("A saved model was invalid and has been skipped. Your chat and uploaded files were preserved.");
        }
        if (Array.isArray(parsed.modelActions)) setModelActions(parsed.modelActions);
        if (Array.isArray(parsed.drawingFindings)) setDrawingFindings(parsed.drawingFindings);
      }
    } catch { /* Ignore invalid local workspace data. */ }
  }, []);

  useEffect(() => {
    if (attachmentsHydrated) writeSavedAttachments(projectAttachments).catch(() => setNotice("Browser storage could not save the uploaded file contents. Keep a copy of the original files."));
  }, [projectAttachments, attachmentsHydrated]);

  useEffect(() => {
    try {
      localStorage.setItem("buildlens-workspace-v2", JSON.stringify({ messages: messages.slice(-30), files, projectName, modelSpec, modelActions: modelActions.slice(-100), drawingFindings: drawingFindings.slice(-500) }));
    } catch { setNotice("Workspace storage is full. Remove some files or export the workspace."); }
  }, [messages, files, projectName, modelSpec, modelActions, drawingFindings]);

  const addFiles = async event => {
    const selected = Array.from(event.target.files || []);
    event.target.value = "";
    if (!selected.length) return;
    const next = [];
    const failures = [];
    for (const file of selected) {
      if (file.size > MAX_FILE_SIZE) { failures.push(`${file.name}: exceeds 12 MB`); continue; }
      try {
        const attachment = await readAttachment(file);
        next.push(attachment);
      } catch (error) { failures.push(error.message); }
    }
    if (next.length) {
      setFiles(current => [...current, ...next.map(({ id, name, type, status }) => ({ id, name, kind: name.split(".").pop().toUpperCase(), type, status }))]);
      setPendingAttachments(current => [...current, ...next]);
      setProjectAttachments(current => [...current, ...next]);
      setNotice(`${next.length} file(s) ready. Add a question and send them to the assistant.`);
    }
    if (failures.length) setNotice(failures.slice(0, 3).join(" · "));
    setMobilePanel(true);
  };

  const removeFile = id => {
    setFiles(current => current.filter(file => file.id !== id));
    setPendingAttachments(current => current.filter(file => file.id !== id));
    setProjectAttachments(current => current.filter(file => file.id !== id));
  };

  const startNewChat = () => {
    if (busy) return;
    messagesRef.current = [];
    setMessages([]);
    setHasStartedChat(true);
    setInput("");
    setPendingAttachments([]);
    setNotice("");
  };

  const sendMessage = async event => {
    event?.preventDefault();
    const message = input.trim();
    if ((!message && !pendingAttachments.length) || busy) return;
    if (!attachmentsHydrated) { setNotice("Project documents are still loading. Please wait a moment and send again."); return; }
    if (projectAttachments.length > 12) { setNotice("BuildLens can analyse up to 12 project documents per request. Remove or split the extra files first."); return; }
    const attachmentSnapshot = projectAttachments.slice(0, 12);
    const history = messagesRef.current.filter(item => item && ["user", "assistant"].includes(item.role) && typeof item.content === "string" && item.content.trim()).slice(-20);
    const userText = message || `Please inspect the ${attachmentSnapshot.length} project file(s) and summarize what they contain.`;
    const attachmentNames = attachmentSnapshot.map(file => file.name);
    const userEntry = { role: "user", content: attachmentNames.length ? `${userText}\n\nProject files available: ${attachmentNames.join(", ")}` : userText };
    messagesRef.current = [...history, userEntry, { role: "assistant", content: "" }];
    setMessages(messagesRef.current);
    setInput("");
    setPendingAttachments([]);
    setBusy(true);
    setHasStartedChat(true);
    setMobilePanel(true);
    try {
      // Keep the request comfortably below Vercel's function body limit.
      // Document text from every active project file is retained; only a
      // maximum of three compressed visual previews are sent per request.
      let remainingVisualPreviews = 10;
      const textFileCount = Math.max(1, attachmentSnapshot.filter(file => typeof file.content === "string").length);
      const perDocumentTextBudget = Math.floor(480000 / textFileCount);
      const requestAttachments = attachmentSnapshot.map(({ name, type, kind, content, dataUrl, pageImages }) => {
        let visual = [];
        if (remainingVisualPreviews > 0 && kind === "image" && typeof dataUrl === "string") {
          visual = [{ dataUrl }];
          remainingVisualPreviews -= 1;
        } else if (remainingVisualPreviews > 0 && Array.isArray(pageImages)) {
          visual = pageImages.slice(0, remainingVisualPreviews);
          remainingVisualPreviews -= visual.length;
        }
        return {
          name, type, kind,
          ...(typeof content === "string" ? { content: content.slice(0, perDocumentTextBudget) } : {}),
          ...(visual.length && kind === "image" ? { dataUrl: visual[0].dataUrl } : {}),
          ...(visual.length && kind !== "image" ? { pageImages: visual } : {})
        };
      });
      await askBuildLens({
        message: userText,
        history,
        attachments: requestAttachments,
        currentModel: modelSpec,
        onStatus: status => setBusyLabel(status),
        onActions: result => {
          if (result.model) setModelSpec(result.model);
          // Keep visibility commands scoped to the assistant response that
          // produced them; chat previews must not mutate the main workspace.
          if (result.model || result.actions?.length) {
            const next = [...messagesRef.current];
            const last = next.length - 1;
            if (last >= 0 && next[last].role === "assistant") {
              next[last] = {
                ...next[last],
                ...(result.model ? { modelSpec: result.model } : {}),
                ...(result.actions?.length ? { modelActions: result.actions } : {})
              };
              messagesRef.current = next;
              setMessages(next);
            }
          }
          const workspaceActions = (result.actions || []).filter(action =>
            action?.type === "model.visibility" || action?.type === "model.opacity");
          if (workspaceActions.length) {
            setModelActions(current => {
              let next = [...current];
              for (const action of workspaceActions) {
                const scope = (action.elementIds || []).slice().sort().join(",");
                next = next.filter(existing => !(existing.type === action.type &&
                  existing.category === action.category &&
                  (existing.elementIds || []).slice().sort().join(",") === scope));
                next.push(action);
              }
              return next.slice(-40);
            });
          }
          if (result.findings?.length) setDrawingFindings(current => [...current, ...result.findings].slice(-500));
        },
        onDelta: streamed => {
          const next = [...messagesRef.current];
          const last = next.length - 1;
          if (last >= 0 && next[last].role === "assistant") next[last] = { ...next[last], content: streamed };
          messagesRef.current = next;
          setMessages(next);
        }
      });
    } catch (error) {
      setMessages(current => {
        const next = [...messagesRef.current];
        const last = next.length - 1;
        const failure = "I couldn't complete that request: " + error.message + ". Your uploaded files remain in the project list; you can try sending again.";
        if (last >= 0 && next[last].role === "assistant") next[last] = { ...next[last], content: next[last].content ? next[last].content + "\n\n" + failure : failure };
        else next.push({ role: "assistant", content: failure });
        messagesRef.current = next;
        return next;
      });
    } finally { setBusy(false); setBusyLabel("BuildLens is responding…"); }
  };

  const exportWorkspace = () => {
    const blob = new Blob([JSON.stringify({ app: "BuildLens", exportedAt: new Date().toISOString(), projectName, files, messages, modelSpec, modelActions, drawingFindings }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "buildlens-workspace.json"; a.click(); URL.revokeObjectURL(url);
  };

  const clearWorkspace = () => {
    if (!window.confirm("Clear this workspace's chat and uploaded-file list? This cannot be undone.")) return;
    messagesRef.current = []; setMessages([]); setFiles([]); setPendingAttachments([]); setProjectAttachments([]); clearSavedAttachments(); setModelSpec(null); setModelActions([]); setDrawingFindings([]); setNotice("Workspace cleared.");
  };

  return <main className="app-shell">
    <header className="topbar">
      <a className="brand" href="/" aria-label="BuildLens home"><span className="brand-mark"><Layers3 size={19} strokeWidth={2.2} /></span><span>BuildLens</span><span className="brand-tag">WORKSPACE</span></a>
      <div className="project-title">
        {editingName ? <input autoFocus value={projectName} onChange={e => setProjectName(e.target.value)} onBlur={() => setEditingName(false)} onKeyDown={e => e.key === "Enter" && setEditingName(false)} aria-label="Project name" /> : <button className="project-name" onClick={() => setEditingName(true)} title="Rename project">{projectName}<ChevronDown size={14} /></button>}
        <span className="unsaved-dot" /><span className="saved-label">Local workspace</span>
      </div>
      <div className="top-actions">
        <button className="quiet-button export-button" onClick={exportWorkspace}>Export workspace</button>
        <button className="icon-button mobile-chat-trigger" onClick={() => setMobilePanel(value => !value)} aria-label="Toggle engineering assistant"><MessageSquare size={18} /></button>
        <span className="prototype-pill">PROTOTYPE</span>
      </div>
    </header>
    {!hasStartedChat && <button className="welcome-ask-button" onClick={() => { setHasStartedChat(true); setMobilePanel(true); }}><span className="welcome-ask-icon"><MessageSquare size={17} /></span><span><strong>Ask BuildLens</strong><small>Start a conversation or upload your drawings</small></span><ArrowRight size={17} /></button>}
    <div className="workspace">
      <aside className="left-rail">
        <button className="rail-item active" title="Model workspace"><Layers3 size={18} /><span>Model</span></button>
        <button className="rail-item" title="Project documents" onClick={() => { setHasStartedChat(true); setMobilePanel(true); }}><FileUp size={18} /><span>Files</span></button>
        <button className="rail-item" title="Ask BuildLens" onClick={() => { setHasStartedChat(true); setMobilePanel(true); }}><MessageSquare size={18} /><span>Ask AI</span></button>
        <div className="rail-bottom"><span className="status-light" /><span>Workspace ready</span></div>
      </aside>
      <section className="model-column">
        <div className="model-toolbar">
          <div className="toolbar-left"><span className="section-kicker">3D VIEWPORT</span><span className="toolbar-divider" /><span className="model-caption">{modelSpec ? `${modelSpec.name} · ${modelSpec.units}` : "Illustrative sample · not to scale"}</span></div>
          <ModelControls showGrid={showGrid} onToggleGrid={() => setShowGrid(value => !value)} onReset={() => document.querySelector(".viewport-canvas")?.dispatchEvent(new CustomEvent("buildlens-reset"))} />
        </div>
        <div className="viewport-wrap">
          <Viewport view={view} showGrid={showGrid} modelSpec={modelSpec} modelActions={modelActions} findings={drawingFindings} focusElementId={focusedFinding?.id} focusRequest={focusedFinding?.request} />
          <div className="viewport-badge"><span className="live-dot" /> {modelSpec ? "PROJECT MODEL DATA RECEIVED" : "CONCEPT MODEL"} <span className="badge-divider">/</span> {modelSpec ? "VALIDATED" : "DEMO DATA"}</div>
          <div className="viewport-instructions"><span>DRAG TO ORBIT</span><i /><span>RIGHT-DRAG / TWO-FINGER DRAG TO PAN</span><i /><span>SCROLL / PINCH TO ZOOM</span></div>
          <div className="orientation-cube" aria-label="View orientation"><span className="cube-top">Y</span><span className="cube-front">Z</span><span className="cube-side">X</span></div>
        </div>
        <ModelViewTabs view={view} onViewChange={setView} />
        <AssumptionPanel open={assumptionsOpen} onToggle={() => setAssumptionsOpen(value => !value)} modelSpec={modelSpec} findings={drawingFindings} onSelectFinding={item => item.elementId && setFocusedFinding({ id: item.elementId, request: Date.now() })} />
      </section>
      <EngineeringPanel
        open={mobilePanel} onClose={() => setMobilePanel(false)}
        files={files} onAddFiles={addFiles} onRemoveFile={removeFile}
        messages={messages} busy={busy} busyLabel={busyLabel} input={input} onInputChange={setInput}
        onSend={sendMessage} onClear={clearWorkspace} onExport={exportWorkspace}
        onNewChat={startNewChat} fileInputRef={fileInputRef} pendingAttachments={pendingAttachments}
      />
    </div>
    {notice && <div className="toast" role="status">{notice}<button onClick={() => setNotice("")} aria-label="Dismiss notification"><X size={14} /></button></div>}
    <input ref={fileInputRef} className="hidden-file-input" type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.txt,.md,.csv,.json,.xml,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg,image/webp,text/plain,text/csv" onChange={addFiles} />
  </main>;
}