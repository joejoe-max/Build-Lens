import React, { useState } from "react";
import { Check, Plus, Send, ShieldAlert, Sparkles, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Viewport from "./Viewport.jsx";

const Conversation = React.memo(function Conversation({ messages, busy, busyLabel, modelSpec }) {
 return <div className="conversation" aria-live="polite">{messages.map((message,index)=><article className={message.role==="user"?"message user-message":"message assistant-message"} key={index}>{message.role!=="user"&&<div className="assistant-avatar"><Sparkles size={14}/></div>}<div className="message-content"><span className="message-author">{message.role==="user"?"YOU":"BUILDLENS"}</span><div className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content||""}</ReactMarkdown></div>{(message.modelSpec || message.modelActions?.length) && <section className="chat-model-card"><div className="chat-model-card-heading"><strong>3D MODEL</strong><span>{message.modelSpec?.name || "Workspace preview"} · {message.modelSpec?.units || modelSpec?.units || "model units"}</span></div><div className="chat-model-viewport"><Viewport view="building" showGrid={true} modelSpec={message.modelSpec || modelSpec} modelActions={message.modelActions || []} compact /></div><p>Interactive model · drag to orbit, pinch or scroll to zoom, drag with two fingers to pan.</p></section>}</div></article>)}{busy&&<div className="typing"><span/><span/><span/><small>{busyLabel || "BuildLens is responding…"}</small></div>}</div>;
});

export default function EngineeringPanel({open,onClose,files,onRemoveFile,messages,busy,busyLabel,input,onSend,onClear,onNewChat,fileInputRef,pendingAttachments=[],modelSpec=null,uploadQueue=[],onRetryUpload=()=>{}}) {
 const [draft,setDraft] = useState(input || "");
 const submit = event => { event.preventDefault(); onSend(event,draft); setDraft(""); };
 const newChat = () => { setDraft(""); onNewChat(); };
 const clearWorkspace = () => { setDraft(""); onClear(); };
 return <aside className={open ? "right-panel mobile-open" : "right-panel"}>
  <div className="panel-heading"><div className="panel-heading-icon"><Sparkles size={16}/></div><div className="panel-heading-title"><h2>Engineering assistant</h2></div><button className="new-chat-button" onClick={newChat} disabled={busy}><Plus size={14}/><span>New chat</span></button><button className="icon-button close-mobile" onClick={onClose} aria-label="Close assistant"><X size={18}/></button></div>
  <div className="assistant-scope"><ShieldAlert size={15}/><span>Engineering guidance is preliminary. Verify design decisions before construction.</span></div>
  <div className="documents-block"><div className="block-title"><span>PROJECT FILES</span><span className="count">{files.length}</span></div><div className="file-list">{files.length ? files.map(file=><div className="file-row" key={file.id}><div className="file-type">{file.kind.slice(0,4)}</div><div className="file-info"><strong title={file.name}>{file.name}</strong><small>{file.status}</small></div><button className="icon-button remove-file" onClick={()=>onRemoveFile(file.id)} aria-label={"Remove " + file.name}><X size={14}/></button></div>) : <p className="empty-files">No project files yet.</p>}</div></div>
  {uploadQueue.filter(job=>job.status!=="ready").map(job=><div className="upload-progress-row" key={job.id}><div className="upload-progress-copy"><strong title={job.name}>{job.name}</strong><small>{job.status==="error" ? job.error || "Upload failed" : job.status==="queued" ? "Waiting to process…" : "Reading and preparing file…"}</small></div><div className="upload-progress-track"><span className={job.status==="error"?"upload-failed":job.status==="processing"?"upload-processing":""} style={{width:job.progress+"%"}}/></div>{job.status==="error"&&<button type="button" className="upload-retry" onClick={()=>onRetryUpload(job.id)}>Retry</button>}</div>)}
  <Conversation messages={messages} busy={busy} busyLabel={busyLabel} modelSpec={modelSpec} />
  {pendingAttachments.length>0&&<div className="pending-attachments"><span>{pendingAttachments.length} attachment(s) ready</span>{pendingAttachments.map(file=><span className="pending-chip" key={file.id}>{(file.dataUrl || file.pageImages?.[0]?.dataUrl) && <img className="pending-thumb" src={file.dataUrl || file.pageImages[0].dataUrl} alt="" />}<span className="pending-chip-name">{file.name}</span><button type="button" onClick={()=>onRemoveFile(file.id)} aria-label={"Remove " + file.name + " from message"}><X size={11}/></button></span>)}</div>}
  <form className="composer" onSubmit={submit}>
   <div className="composer-input-row">
    <button type="button" className="composer-attach-button" onClick={()=>fileInputRef?.current?.click()} disabled={busy} aria-label="Attach files"><Plus size={20}/></button>
    <textarea value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Ask anything about buildings, drawings or engineering…" rows={2} maxLength={6000} disabled={busy} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();onSend(e);}}} aria-label="Message the engineering assistant"/>
    <button type="submit" className="send-button" disabled={(!draft.trim()&&!pendingAttachments.length)||busy} aria-label="Send message"><Send size={16}/></button>
   </div>
   <div className="composer-footer"><span>Enter to send · Shift + Enter for new line</span></div>
  </form>
  <div className="panel-footer"><span><Check size={13}/> {busy?"Generating response…":"Ready to help"}</span><button onClick={clearWorkspace} disabled={busy}>Clear workspace</button></div>
 </aside>;
}