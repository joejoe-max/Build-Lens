import React from "react";
import { Check, Plus, Send, ShieldAlert, Sparkles, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function EngineeringPanel({open,onClose,files,onRemoveFile,messages,busy,input,onInputChange,onSend,onClear,onNewChat,fileInputRef,pendingAttachments=[]}) {
 return <aside className={open ? "right-panel mobile-open" : "right-panel"}>
  <div className="panel-heading"><div className="panel-heading-icon"><Sparkles size={16}/></div><div className="panel-heading-title"><h2>Engineering assistant</h2></div><button className="new-chat-button" onClick={onNewChat} disabled={busy}><Plus size={14}/><span>New chat</span></button><button className="icon-button close-mobile" onClick={onClose} aria-label="Close assistant"><X size={18}/></button></div>
  <div className="assistant-scope"><ShieldAlert size={15}/><span>Engineering guidance is preliminary. Verify design decisions before construction.</span></div>
  <div className="documents-block"><div className="block-title"><span>PROJECT FILES</span><span className="count">{files.length}</span></div><div className="file-list">{files.length ? files.map(file=><div className="file-row" key={file.id}><div className="file-type">{file.kind.slice(0,4)}</div><div className="file-info"><strong title={file.name}>{file.name}</strong><small>{file.status}</small></div><button className="icon-button remove-file" onClick={()=>onRemoveFile(file.id)} aria-label={"Remove " + file.name}><X size={14}/></button></div>) : <p className="empty-files">No project files yet.</p>}</div></div>
  <div className="conversation" aria-live="polite">{messages.map((message,index)=><article className={message.role==="user"?"message user-message":"message assistant-message"} key={index}>{message.role!=="user"&&<div className="assistant-avatar"><Sparkles size={14}/></div>}<div className="message-content"><span className="message-author">{message.role==="user"?"YOU":"BUILDLENS"}</span><div className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content||""}</ReactMarkdown></div></div></article>)}{busy&&<div className="typing"><span/><span/><span/><small>BuildLens is responding…</small></div>}</div>
  {pendingAttachments.length>0&&<div className="pending-attachments"><span>{pendingAttachments.length} attachment(s) ready</span>{pendingAttachments.map(file=><span className="pending-chip" key={file.id}>{(file.dataUrl || file.pageImages?.[0]?.dataUrl) && <img className="pending-thumb" src={file.dataUrl || file.pageImages[0].dataUrl} alt="" />}<span className="pending-chip-name">{file.name}</span><button type="button" onClick={()=>onRemoveFile(file.id)} aria-label={"Remove " + file.name + " from message"}><X size={11}/></button></span>)}</div>}
  <form className="composer" onSubmit={onSend}>
   <div className="composer-input-row">
    <button type="button" className="composer-attach-button" onClick={()=>fileInputRef?.current?.click()} disabled={busy} aria-label="Attach files"><Plus size={20}/></button>
    <textarea value={input} onChange={e=>onInputChange(e.target.value)} placeholder="Ask anything about buildings, drawings or engineering…" rows={2} maxLength={6000} disabled={busy} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();onSend(e);}}} aria-label="Message the engineering assistant"/>
    <button type="submit" className="send-button" disabled={(!input.trim()&&!pendingAttachments.length)||busy} aria-label="Send message"><Send size={16}/></button>
   </div>
   <div className="composer-footer"><span>Enter to send · Shift + Enter for new line</span></div>
  </form>
  <div className="panel-footer"><span><Check size={13}/> {busy?"Generating response…":"Ready to help"}</span><button onClick={onClear} disabled={busy}>Clear workspace</button></div>
 </aside>;
}