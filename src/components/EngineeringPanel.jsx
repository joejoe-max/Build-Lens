import React from "react";
import { Check, FileUp, MessageSquare, Plus, Send, ShieldAlert, Sparkles, X } from "lucide-react";

export default function EngineeringPanel({
  open, onClose, files, onAddFiles, onRemoveFile, messages, busy,
  input, onInputChange, onSend, onClear, onNewChat, pendingAttachments = []
}) {
  return <aside className={open ? "right-panel mobile-open" : "right-panel"}>
    <div className="panel-heading">
      <div className="panel-heading-icon"><Sparkles size={16} /></div>
      <div className="panel-heading-title"><h2>Engineering assistant</h2><p>Document interpretation & review</p></div>
      <button className="new-chat-button" onClick={onNewChat} disabled={busy} title="Start a new conversation"><Plus size={14} /><span>New chat</span></button>
      <button className="icon-button close-mobile" onClick={onClose} aria-label="Close assistant"><X size={18} /></button>
    </div>
    <div className="assistant-scope"><ShieldAlert size={15} /><span>Preliminary review only. Not a substitute for engineering verification.</span></div>
    <div className="documents-block">
      <div className="block-title"><span>PROJECT FILES</span><span className="count">{files.length}</span></div>
      <label className="upload-drop">
        <input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.txt,.md,.csv,.json,.xml" onChange={onAddFiles} />
        <FileUp size={17} /><span><strong>Add drawings or calculations</strong><small>PDF, DOCX, text and images · 12 MB each</small></span><span className="plus">+</span>
      </label>
      <div className="file-list">
        {files.length ? files.map(file => <div className="file-row" key={file.id}><div className="file-type">{file.kind.slice(0, 4)}</div><div className="file-info"><strong title={file.name}>{file.name}</strong><small>{file.status}</small></div><button className="icon-button remove-file" onClick={() => onRemoveFile(file.id)} aria-label={`Remove ${file.name}`}><X size={14} /></button></div>) : <p className="empty-files">No project files yet. Add a drawing, report or photo to discuss it.</p>}
      </div>
      <p className="file-warning">PDF text, DOCX text and JPG/PNG/WEBP images can be sent to the assistant. Scanned PDFs and CAD files need conversion to images or supported documents first.</p>
    </div>
    <div className="conversation" aria-live="polite">
      {messages.map((message, index) => <article className={message.role === "user" ? "message user-message" : "message assistant-message"} key={index}>
        {message.role !== "user" && <div className="assistant-avatar"><Sparkles size={14} /></div>}
        <div className="message-content"><span className="message-author">{message.role === "user" ? "YOU" : "BUILDLENS"}</span><p>{message.content}</p></div>
      </article>)}
      {busy && <div className="typing"><span /><span /><span /> <small>Reviewing your message and attachments</small></div>}
    </div>
    {pendingAttachments.length > 0 && <div className="pending-attachments"><span>{pendingAttachments.length} attachment(s) ready</span>{pendingAttachments.map(file => <span className="pending-chip" key={file.id}>{file.name}<button type="button" onClick={() => onRemoveFile(file.id)} aria-label={`Remove ${file.name} from message`}><X size={11} /></button></span>)}</div>}
    <form className="composer" onSubmit={onSend}>
      <textarea value={input} onChange={e => onInputChange(e.target.value)} placeholder="Ask about a drawing, dimension, member or calculation…" rows={3} maxLength={6000} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(e); } }} aria-label="Message the engineering assistant" />
      <div className="composer-footer"><span>Enter to send · Shift + Enter for new line</span><button type="submit" className="send-button" disabled={(!input.trim() && !pendingAttachments.length) || busy} aria-label="Send message"><Send size={16} /></button></div>
    </form>
    <div className="panel-footer"><span><Check size={13} /> API key stays server-side</span><button onClick={onClear}>Clear workspace</button></div>
  </aside>;
}