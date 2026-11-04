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

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const textExtensions = ["txt", "md", "csv", "json", "xml"];

let dwgConverterPromise = null;

function parseDxfDrawing(source) {
  const lines = source.replace(/\r/g, "").split("\n");
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number.parseInt(lines[i].trim(), 10);
    if (Number.isFinite(code)) pairs.push({ code, value: lines[i + 1].trim() });
  }
  const entities = [];
  let inEntities = false;
  let current = null;
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    if (pair.code === 0 && pair.value === "SECTION" && pairs[i + 1]?.code === 2) {
      inEntities = pairs[i + 1].value === "ENTITIES";
      current = null;
      continue;
    }
    if (pair.code === 0 && pair.value === "ENDSEC") {
      inEntities = false; current = null; continue;
    }
    if (!inEntities) continue;
    if (pair.code === 0) {
      current = { type: pair.value, data: [] };
      entities.push(current);
    } else if (current) current.data.push(pair);
  }
  const value = (entity, code) => entity.data.find(item => item.code === code)?.value;
  const values = (entity, code) => entity.data.filter(item => item.code === code).map(item => item.value);
  const counts = {};
  const layers = new Map();
  const geometry = [];
  const labels = [];
  const allPoints = [];
  for (const entity of entities) {
    counts[entity.type] = (counts[entity.type] || 0) + 1;
    const layer = value(entity, 8) || "0";
    layers.set(layer, (layers.get(layer) || 0) + 1);
    const nums = code => values(entity, code).map(Number).filter(Number.isFinite);
    if (entity.type === "LINE") {
      const x1 = Number(value(entity, 10)), y1 = Number(value(entity, 20));
      const x2 = Number(value(entity, 11)), y2 = Number(value(entity, 21));
      if ([x1,y1,x2,y2].every(Number.isFinite)) {
        const item = { type: "LINE", layer, points: [[x1,y1],[x2,y2]] };
        geometry.push(item); allPoints.push(...item.points);
      }
    } else if (entity.type === "LWPOLYLINE" || entity.type === "POLYLINE") {
      const xs = nums(10), ys = nums(20);
      const points = xs.map((x, i) => [x, ys[i]]).filter(point => Number.isFinite(point[1]));
      if (points.length > 1) { geometry.push({ type: "POLYLINE", layer, points, closed: (Number(value(entity, 70)) & 1) === 1 }); allPoints.push(...points); }
    } else if (entity.type === "CIRCLE" || entity.type === "ARC") {
      const x = Number(value(entity, 10)), y = Number(value(entity, 20)), radius = Number(value(entity, 40));
      if ([x,y,radius].every(Number.isFinite) && radius > 0) {
        geometry.push({ type: entity.type, layer, center: [x,y], radius });
        allPoints.push([x-radius,y-radius],[x+radius,y+radius]);
      }
    } else if (entity.type === "INSERT" || entity.type === "POINT") {
      const x = Number(value(entity, 10)), y = Number(value(entity, 20));
      if ([x,y].every(Number.isFinite)) {
        geometry.push({ type: entity.type, layer, point: [x,y], name: value(entity, 2) || "" });
        allPoints.push([x,y]);
      }
    } else if (entity.type === "3DFACE") {
      const points = [10,11,12,13].map(code => [Number(value(entity, code)), Number(value(entity, code+10))])
        .filter(point => point.every(Number.isFinite));
      if (points.length > 2) { geometry.push({ type: "POLYLINE", layer, points, closed: true }); allPoints.push(...points); }
    }
    if (["TEXT","MTEXT","ATTRIB","ATTDEF","DIMENSION"].includes(entity.type)) {
      const text = [...values(entity, 1), ...values(entity, 3)].join(" ").replace(/\\P/g, " ").trim();
      if (text) labels.push({ layer, type: entity.type, text });
    }
  }
  const bounds = allPoints.length ? {
    minX: Math.min(...allPoints.map(point => point[0])),
    minY: Math.min(...allPoints.map(point => point[1])),
    maxX: Math.max(...allPoints.map(point => point[0])),
    maxY: Math.max(...allPoints.map(point => point[1]))
  } : null;
  const summary = [
    "CAD drawing entity extraction (DXF)",
    "Units: not reliably declared in this text summary; confirm drawing INSUNITS/dimensions before using numeric values.",
    "Entity count: " + entities.length,
    "Entity types: " + Object.entries(counts).map(([key,count]) => key + "=" + count).join(", "),
    "Layers: " + [...layers.entries()].map(([key,count]) => key + " (" + count + ")").join(", "),
    bounds ? "2D extents: X " + bounds.minX + " to " + bounds.maxX + "; Y " + bounds.minY + " to " + bounds.maxY : "No supported 2D geometry entities were extracted.",
    "Text and dimension labels:",
    ...labels.slice(0, 500).map(item => "[" + item.layer + " · " + item.type + "] " + item.text),
    "Representative geometry by layer:",
    ...geometry.slice(0, 900).map((item,index) => item.type === "LINE"
      ? (index+1) + ". " + item.layer + " LINE (" + item.points[0].join(",") + ") to (" + item.points[1].join(",") + ")"
      : item.type === "POLYLINE"
        ? (index+1) + ". " + item.layer + " POLYLINE " + item.points.map(point => point.join(",")).join("; ") + (item.closed ? " [closed]" : "")
        : item.type === "INSERT" || item.type === "POINT"
          ? (index+1) + ". " + item.layer + " " + item.type + " " + (item.name || "") + " at " + item.point.join(",")
          : (index+1) + ". " + item.layer + " " + item.type + " center " + item.center.join(",") + " radius " + item.radius)
  ].join("\n");
  return { summary, geometry, bounds, entityCount: entities.length, layerCount: layers.size };
}

function renderCadPreview(parsed) {
  if (!parsed.bounds || !parsed.geometry.length) return null;
  const width = 900, height = 650, padding = 35;
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d");
  context.fillStyle = "#11161a"; context.fillRect(0, 0, width, height);
  const b = parsed.bounds;
  const spanX = Math.max(1e-6, b.maxX - b.minX), spanY = Math.max(1e-6, b.maxY - b.minY);
  const scale = Math.min((width-padding*2)/spanX,(height-padding*2)/spanY);
  const project = point => [padding+(point[0]-b.minX)*scale,height-padding-(point[1]-b.minY)*scale];
  context.strokeStyle = "#d8e0e5"; context.lineWidth = 1;
  for (const entity of parsed.geometry) {
    context.beginPath();
    if (entity.type === "LINE" || entity.type === "POLYLINE") {
      entity.points.forEach((point,index) => { const p=project(point); if(index===0)context.moveTo(...p);else context.lineTo(...p); });
      if(entity.closed)context.closePath();
    } else if (entity.type === "INSERT" || entity.type === "POINT") {
      const point = project(entity.point);
      context.moveTo(point[0]-4,point[1]); context.lineTo(point[0]+4,point[1]);
      context.moveTo(point[0],point[1]-4); context.lineTo(point[0],point[1]+4);
    } else {
      const center=project(entity.center);
      context.arc(center[0],center[1],entity.radius*scale,0,Math.PI*2);
    }
    context.stroke();
  }
  const dataUrl=canvas.toDataURL("image/jpeg",0.42);
  canvas.width=0;canvas.height=0;
  return dataUrl.length<=260000?dataUrl:null;
}

async function readCadAttachment(file, extension) {
  let dxfText;
  if (extension === "dwg") {
    const dwg = await file.arrayBuffer();
    const converter = await import("dwgdxf");
    if (!dwgConverterPromise) dwgConverterPromise = converter.init({ wasmBase: converter.CDN_WASM_BASE });
    await dwgConverterPromise;
    const converted = await converter.convertDwgToDxf(new Uint8Array(dwg));
    dxfText = new TextDecoder().decode(converted);
  } else {
    dxfText = await file.text();
  }
  if (!dxfText || !dxfText.includes("SECTION")) throw new Error(file.name + " could not be decoded as a supported ASCII DXF drawing.");
  const parsed = parseDxfDrawing(dxfText);
  if (!parsed.entityCount) throw new Error(file.name + " contains no readable model-space entities.");
  const preview = renderCadPreview(parsed);
  return {
    id: crypto.randomUUID(), name: file.name, type: "text/plain", kind: "text",
    content: parsed.summary.slice(0,120000),
    ...(preview ? { pageImages: [{ pageNumber: 1, dataUrl: preview }] } : {}),
    status: (extension === "dwg" ? "DWG converted and " : "DXF ") + parsed.entityCount + " CAD entities read across " + parsed.layerCount + " layers"
  };
}

async function readSpreadsheetAttachment(file) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true, cellFormula: true });
  const sheets = workbook.SheetNames.map(name => {
    const sheet = workbook.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
    const values = rows.map((row,index) => String(index+1).padStart(3,"0") + " | " + row.map(cell => String(cell ?? "")).join(" | ")).join("\n");
    const formulas = XLSX.utils.sheet_to_formulae(sheet);
    const formulaText = formulas.length ? "\nFormulas:\n" + formulas.slice(0,500).join("\n") : "";
    return "[Worksheet: " + name + "]\n" + values + formulaText;
  });
  const content = sheets.join("\n\n").slice(0,120000);
  if (!content.trim()) throw new Error(file.name + " contains no readable worksheet data.");
  return { id: crypto.randomUUID(), name: file.name, type: file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", kind: "text", content, status: "Read " + workbook.SheetNames.length + " spreadsheet sheet(s), including table rows and formulas" };
}

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
  if (["dwg", "dxf"].includes(extension)) return readCadAttachment(file, extension);
  if (["xls", "xlsx", "ods"].includes(extension)) return readSpreadsheetAttachment(file);
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
  throw new Error(`${file.name}: this format is not supported yet. Use PDF, DOCX, DWG, DXF, XLS, XLSX, ODS, TXT, CSV, JSON, PNG, JPG or WEBP.`);
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
  const [uploadQueue, setUploadQueue] = useState([]);
  const [projectAttachments, setProjectAttachments] = useState([]);
  const [attachmentsHydrated, setAttachmentsHydrated] = useState(false);
  const [modelSpec, setModelSpec] = useState(null);
  const [drawingFindings, setDrawingFindings] = useState([]);
  const [focusedFinding, setFocusedFinding] = useState(null);
  const messagesRef = useRef([]);
  const [messages, setMessages] = useState([]);
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
        if (Array.isArray(parsed.drawingFindings)) setDrawingFindings(parsed.drawingFindings);
      }
    } catch { /* Ignore invalid local workspace data. */ }
  }, []);

  useEffect(() => {
    if (attachmentsHydrated) writeSavedAttachments(projectAttachments).catch(() => setNotice("Browser storage could not save the uploaded file contents. Keep a copy of the original files."));
  }, [projectAttachments, attachmentsHydrated]);

  useEffect(() => {
    try {
      localStorage.setItem("buildlens-workspace-v2", JSON.stringify({ messages: messages.slice(-30), files, projectName, modelSpec, drawingFindings: drawingFindings.slice(-500) }));
    } catch { setNotice("Workspace storage is full. Remove some files or export the workspace."); }
  }, [messages, files, projectName, modelSpec, drawingFindings]);

  const processUpload = async (file, jobId) => {
    setUploadQueue(current => current.map(job => job.id === jobId ? { ...job, status: "processing", progress: 12, error: "" } : job));
    try {
      const attachment = await readAttachment(file);
      attachment.id = jobId;
      setUploadQueue(current => current.map(job => job.id === jobId ? { ...job, progress: 88, status: "processing" } : job));
      setFiles(current => [...current.filter(item => item.id !== jobId), {
        id: attachment.id, name: attachment.name,
        kind: attachment.name.split(".").pop().toUpperCase(),
        type: attachment.type, status: attachment.status
      }]);
      setPendingAttachments(current => [...current.filter(item => item.id !== jobId), attachment]);
      setProjectAttachments(current => [...current.filter(item => item.id !== jobId), attachment]);
      setUploadQueue(current => current.map(job => job.id === jobId ? { ...job, status: "ready", progress: 100, error: "" } : job));
      return true;
    } catch (error) {
      setUploadQueue(current => current.map(job => job.id === jobId ? { ...job, status: "error", progress: 100, error: error.message } : job));
      return false;
    }
  };

  const addFiles = async event => {
    const selected = Array.from(event.target.files || []);
    event.target.value = "";
    if (!selected.length) return;
    const jobs = selected.map(file => ({ id: crypto.randomUUID(), name: file.name, file, status: "queued", progress: 4, error: "" }));
    setUploadQueue(current => [...current, ...jobs]);
    setMobilePanel(true);
    for (const job of jobs) {
      if (job.file.size > MAX_FILE_SIZE) {
        setUploadQueue(current => current.map(item => item.id === job.id ? { ...item, status: "error", progress: 100, error: "File exceeds 25 MB." } : item));
        continue;
      }
      await processUpload(job.file, job.id);
    }
  };

  const retryUpload = async jobId => {
    const job = uploadQueue.find(item => item.id === jobId);
    if (job?.file) await processUpload(job.file, job.id);
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
    setPendingAttachments([]);
    setNotice("");
  };

  const sendMessage = async (event, draftText = "") => {
    event?.preventDefault();
    const message = String(draftText || "").trim();
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
      const visualSelections = attachmentSnapshot.map(() => []);
      let remainingVisualPreviews = 10;
      // Give every visual document one chance before distributing extra sheets
      // round-robin, so an early multi-page PDF cannot crowd out later files.
      for (let i = 0; i < attachmentSnapshot.length && remainingVisualPreviews > 0; i++) {
        const item = attachmentSnapshot[i];
        if (item.kind === "image" && typeof item.dataUrl === "string") visualSelections[i].push({ dataUrl: item.dataUrl });
        else if (Array.isArray(item.pageImages) && item.pageImages.length) visualSelections[i].push(item.pageImages[0]);
        if (visualSelections[i].length) remainingVisualPreviews--;
      }
      let added = true;
      while (remainingVisualPreviews > 0 && added) {
        added = false;
        for (let i = 0; i < attachmentSnapshot.length && remainingVisualPreviews > 0; i++) {
          const item = attachmentSnapshot[i];
          if (!Array.isArray(item.pageImages)) continue;
          const next = item.pageImages[visualSelections[i].length];
          if (next) { visualSelections[i].push(next); remainingVisualPreviews--; added = true; }
        }
      }
      const textFileCount = Math.max(1, attachmentSnapshot.filter(file => typeof file.content === "string").length);
      const perDocumentTextBudget = Math.floor(480000 / textFileCount);
      const requestAttachments = attachmentSnapshot.map(({ name, type, kind, content }, index) => {
        const visual = visualSelections[index];
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
          if (result.findings?.length) setDrawingFindings(current => {
            const unique = new Map(current.map(item => [
              [item.sourceFile, item.sourcePage, item.elementId || "", item.property, String(item.value)].join("|"), item
            ]));
            for (const item of result.findings) {
              unique.set([item.sourceFile, item.sourcePage, item.elementId || "", item.property, String(item.value)].join("|"), item);
            }
            return [...unique.values()].slice(-500);
          });
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
    const blob = new Blob([JSON.stringify({ app: "BuildLens", exportedAt: new Date().toISOString(), projectName, files, messages, modelSpec, drawingFindings }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "buildlens-workspace.json"; a.click(); URL.revokeObjectURL(url);
  };

  const clearWorkspace = () => {
    if (!window.confirm("Clear this workspace's chat and uploaded-file list? This cannot be undone.")) return;
    messagesRef.current = []; setMessages([]); setFiles([]); setPendingAttachments([]); setProjectAttachments([]); clearSavedAttachments(); setModelSpec(null); setDrawingFindings([]); setNotice("Workspace cleared.");
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
          <Viewport view={view} showGrid={showGrid} modelSpec={modelSpec} modelActions={[]} findings={drawingFindings} focusElementId={focusedFinding?.id} focusRequest={focusedFinding?.request} />
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
        messages={messages} busy={busy} busyLabel={busyLabel} modelSpec={modelSpec}
        onSend={sendMessage} onClear={clearWorkspace} onExport={exportWorkspace}
        onNewChat={startNewChat} fileInputRef={fileInputRef} pendingAttachments={pendingAttachments} uploadQueue={uploadQueue} onRetryUpload={retryUpload}
      />
    </div>
    {notice && <div className="toast" role="status">{notice}<button onClick={() => setNotice("")} aria-label="Dismiss notification"><X size={14} /></button></div>}
    <input ref={fileInputRef} className="hidden-file-input" type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.txt,.md,.csv,.json,.xml,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg,image/webp,text/plain,text/csv" onChange={addFiles} />
  </main>;
}