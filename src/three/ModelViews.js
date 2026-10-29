export const MODEL_VIEWS = [
  { id: "building", label: "Building" },
  { id: "structure", label: "Structure" },
  { id: "foundation", label: "Foundation" },
  { id: "rebar", label: "Reinforcement" }
];

export function isElementVisible(category, view) {
  if (view === "building") return true;
  if (category === "foundation") return view === "foundation";
  if (category === "ground") return view === "building" || view === "structure";
  if (category === "rebar") return view === "rebar";
  if (view === "structure") return ["structure", "column", "beam", "slab"].includes(category);
  if (view === "foundation") return ["column"].includes(category);
  if (view === "rebar") return ["slab", "beam"].includes(category);
  return false;
}

export const VIEW_DESCRIPTIONS = {
  building: "Illustrative sample · not to scale",
  structure: "Structural frame · illustrative only",
  foundation: "Foundation view · illustrative only",
  rebar: "Reinforcement view · illustrative only"
};