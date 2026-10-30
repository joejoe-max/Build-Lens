import React from "react";
import { ChevronDown, CircleAlert, CheckCircle2, FileSearch } from "lucide-react";

const statusLabel = status => status ? status.charAt(0).toUpperCase() + status.slice(1) : "Unverified";

export default function AssumptionPanel({ open, onToggle, modelSpec = null, findings = [] }) {
  const counts = findings.reduce((result, item) => {
    result[item.provenance] = (result[item.provenance] || 0) + 1;
    return result;
  }, {});
  const totalElements = modelSpec
    ? Object.values(modelSpec.structure || {}).reduce((sum, items) => sum + (Array.isArray(items) ? items.length : 0), 0)
    : 0;
  return <section className="details-section">
    <div className="details-heading"><div><span className="section-kicker">MODEL STATUS</span><h2>Drawing evidence & assumptions</h2></div><button className="icon-button" onClick={onToggle} aria-label="Toggle information panel"><ChevronDown size={17} className={open ? "" : "rotated"} /></button></div>
    {open && <>
      <div className="status-notice">
        {modelSpec ? <CheckCircle2 size={17} /> : <CircleAlert size={17} />}
        <div><strong>{modelSpec ? "Project model data loaded" : "Awaiting drawing interpretation"}</strong>
          <p>{modelSpec ? `${totalElements} structural elements in ${modelSpec.name}. Data validation checks structure and provenance; it does not certify engineering safety.` : "Upload structural drawings, schedules and calculations. BuildLens will record source-page evidence before constructing project geometry."}</p>
        </div>
      </div>
      <div className="assumption-grid">
        <div className="assumption-item"><span className="status-chip specified">Specified</span><strong>{counts.specified || 0}</strong><p>Values explicitly found in the source documents.</p></div>
        <div className="assumption-item"><span className="status-chip inferred">Calculated / inferred</span><strong>{(counts.calculated || 0) + (counts.inferred || 0)}</strong><p>Derived or visually interpreted values.</p></div>
        <div className="assumption-item"><span className="status-chip assumed">Unverified / missing</span><strong>{(counts.unverified || 0) + (counts.missing || 0) + (counts.assumed || 0)}</strong><p>Values requiring confirmation or additional information.</p></div>
      </div>
      <div className="evidence-summary"><FileSearch size={15} /><span>{findings.length} drawing observations recorded</span></div>
      {findings.slice(-8).reverse().map((item,index) => <div className="evidence-row" key={item.sourceFile + item.sourcePage + item.property + index}>
        <div><strong>{item.property}</strong><span>{item.sourceFile} · p. {item.sourcePage}</span></div>
        <span className="evidence-value">{String(item.value)} {item.unit}</span>
        <small>{statusLabel(item.provenance)}{item.confidence !== undefined ? ` · ${Math.round(item.confidence*100)}% confidence` : ""}</small>
      </div>)}
    </>}
  </section>;
}
