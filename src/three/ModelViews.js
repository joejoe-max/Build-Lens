export const MODEL_VIEWS = [
  { id: "building", label: "Building" },
  { id: "structure", label: "Structure" },
  { id: "foundation", label: "Foundation" },
  { id: "rebar", label: "Reinforcement" }
];

export function isElementVisible(category, view) {
  if (view === "building") return true;
  if (category === "grids") return view !== "foundation";
  if (view === "structure") return ["columns", "beams", "slabs", "walls"].includes(category);
  if (view === "foundation") return ["foundations", "columns"].includes(category);
  if (view === "rebar") return category === "reinforcement";
  return false;
}

export const VIEW_DESCRIPTIONS = {
  building: "Project building model",
  structure: "Structural frame and slabs",
  foundation: "Foundations and supporting columns",
  rebar: "Explicitly modelled reinforcement bars"
};
