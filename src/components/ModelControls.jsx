import { Box, Building2, Layers3, RotateCcw, SlidersHorizontal } from "lucide-react";

const views = [
  { id: "building", label: "Building", icon: Building2 },
  { id: "structure", label: "Structure", icon: Layers3 },
  { id: "foundation", label: "Foundation", icon: Box },
  { id: "rebar", label: "Reinforcement", icon: SlidersHorizontal }
];

export function ModelViewTabs({ view, onViewChange }) {
  return <div className="view-tabs" role="tablist" aria-label="Model views">
    {views.map(({ id, label, icon: Icon }) => <button key={id} role="tab" aria-selected={view === id} className={view === id ? "view-tab active" : "view-tab"} onClick={() => onViewChange(id)}><Icon size={16} /><span>{label}</span></button>)}
  </div>;
}

export default function ModelControls({ showLabels, onToggleLabels, onReset }) {
  return <div className="toolbar-right">
    <button className={showLabels ? "tool-button selected" : "tool-button"} onClick={onToggleLabels}><SlidersHorizontal size={15} /><span>Display</span></button>
    <button className="tool-button" onClick={onReset} title="Reset camera"><RotateCcw size={15} /><span>Reset view</span></button>
  </div>;
}