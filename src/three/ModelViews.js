export const MODEL_VIEWS = [
  { id: "building", label: "Building" },
  { id: "structure", label: "Structure" },
  { id: "roof", label: "Roof" },
  { id: "stairs", label: "Stairs" },
  { id: "foundation", label: "Foundation" },
  { id: "rebar", label: "Reinforcement" }
];

export function isElementVisible(category, view) {
  if (view === "building") return true;
  if (category === "grids") return view !== "foundation";
  if (view === "structure") return ["columns", "beams", "slabs", "walls", "stairs", "roofs"].includes(category);
  if (view === "stairs") return category === "stairs";
  if (view === "roof") return category === "roofs";
  if (view === "foundation") return ["foundations", "columns"].includes(category);
  if (view === "rebar") return category === "reinforcement";
  return false;
}

export const VIEW_DESCRIPTIONS = {
  building: "Project building model",
  structure: "Structural frame and slabs",
  roof: "Roof geometry and form",
  foundation: "Foundations and supporting columns",
  rebar: "Explicitly modelled reinforcement bars"
};
