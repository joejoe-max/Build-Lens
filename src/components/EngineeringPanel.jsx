import { Check, FileUp, MessageSquare, Send, ShieldAlert, Sparkles, X } from "lucide-react";

export default function EngineeringPanel({
  open, onClose, files, onAddFiles, onRemoveFile, messages, busy,
  input, onInputChange, onSend, onClear, onExport
}) {
  return <aside className={open ? "right-panel mobile-open" : "right-panel"}>
    <div className="panel-heading"><div className="panel-heading-icon"><Sparkles size={16} /></div><div><h2>Engineering assistant</h2><p>Document interpretation & review</p></div><button className="icon-button close-mobile" onClick={onClose} aria-label="Close assistant"><X size={18} /></button></div>
    <div className="assistant-scope"><ShieldAlert size={15} /><span>Preliminary review only. Not a substitute for engineering verification.</span></div>
    <div className="documents-block">
      <div className="block-title"><span>PROJECT FILES</span><span className="count">{files.length}</span></div>
      <label className="upload-drop">
        <input id="file-input" type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.dwg,.dxf,.doc,.docx,.txt,.csv,.xlsx" onChange={onAddFiles} />
        <FileUp size={17} /><span><strong>Add drawings or calculations</strong><small>PDF, images, CAD and documents · 15 MB each</small></span><span className="plus">+</span>
      </label>
      <div className="file-list">
        {files.length ? files.map(file => <div className="file-row" key={file.id}><div className="file-type">{file.kind.slice(0, 4)}</div><div className="file-info"><strong title={file.name}>{file.name}</strong><small>{file.status}</small></div><button className="icon-button remove-file" onClick={() => onRemoveFile(file.id)} aria-label={`Remove ${file.name}`}><X size={14} /></button></div>) : <p className="empty-files">No files added. Upload drawings to start a project review.</p>}
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
    <form className="composer" onSubmit={onSend}>
      <textarea value={input} onChange={e => onInputChange(e.target.value)} placeholder="Ask about the project, a member, or missing information…" rows={3} maxLength={6000} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(e); } }} aria-label="Message the engineering assistant" />
      <div className="composer-footer"><span>Enter to send · Shift + Enter for new line</span><button type="submit" className="send-button" disabled={!input.trim() || busy} aria-label="Send message"><Send size={16} /></button></div>
    </form>
    <div className="panel-footer"><span><Check size={13} /> API key stays server-side</span><button onClick={onClear}>Clear workspace</button></div>
  </aside>;
}