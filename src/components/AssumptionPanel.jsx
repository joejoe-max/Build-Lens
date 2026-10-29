import { ChevronDown, CircleAlert } from "lucide-react";

export default function AssumptionPanel({ open, onToggle }) {
  return <section className="details-section">
    <div className="details-heading"><div><span className="section-kicker">MODEL STATUS</span><h2>Information & assumptions</h2></div><button className="icon-button" onClick={onToggle} aria-label="Toggle information panel"><ChevronDown size={17} className={open ? "" : "rotated"} /></button></div>
    {open && <>
      <div className="status-notice"><CircleAlert size={17} /><div><strong>Demo geometry only</strong><p>This 3D structure is procedurally generated for the prototype. It has not been derived from uploaded engineering drawings or verified calculations.</p></div></div>
      <div className="assumption-grid">
        <div className="assumption-item"><span className="status-chip specified">Specified</span><strong>None yet</strong><p>No project drawings have been interpreted.</p></div>
        <div className="assumption-item"><span className="status-chip inferred">Inferred</span><strong>None yet</strong><p>No geometry has been inferred from source files.</p></div>
        <div className="assumption-item"><span className="status-chip assumed">Assumed</span><strong>Sample frame</strong><p>Floor count, grid and member sizes are illustrative placeholders.</p></div>
      </div>
    </>}
  </section>;
}