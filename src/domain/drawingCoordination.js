const LENGTH_SCALE = { mm: 0.001, cm: 0.01, m: 1, ft: 0.3048 };

function disciplineOf(item) {
  if (item.discipline && item.discipline !== "general") return item.discipline;
  if (/architect|architectural|\barch\b|\bA[-_ ]?\d{2,}/i.test(item.sourceFile || "")) return "architectural";
  if (/structural|structure|\bSTR\b|\bS[-_ ]?\d{2,}/i.test(item.sourceFile || "")) return "structural";
  return "general";
}

function valuesDiffer(a, b) {
  if (typeof a.value === "number" && typeof b.value === "number") {
    if (LENGTH_SCALE[a.unit] && LENGTH_SCALE[b.unit]) {
      return Math.abs(a.value * LENGTH_SCALE[a.unit] - b.value * LENGTH_SCALE[b.unit]) > 0.001;
    }
    if (a.unit === b.unit) return Math.abs(a.value - b.value) > 0.0001;
    return false;
  }
  return String(a.value).trim().toLowerCase() !== String(b.value).trim().toLowerCase();
}

export function detectDrawingConflicts(observations = []) {
  const candidates = observations.filter(item => item?.elementId && item.category !== "conflict");
  const conflicts = [];
  const seen = new Set();
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i], b = candidates[j];
      if (a.elementId !== b.elementId || a.property?.toLowerCase() !== b.property?.toLowerCase()) continue;
      const da = disciplineOf(a), db = disciplineOf(b);
      if (!((da === "architectural" && db === "structural") || (da === "structural" && db === "architectural"))) continue;
      if (!valuesDiffer(a, b)) continue;
      const architectural = da === "architectural" ? a : b;
      const structural = da === "structural" ? a : b;
      const key = architectural.elementId + "|" + architectural.property.toLowerCase() + "|" + structural.sourceFile + "|" + structural.sourcePage;
      if (seen.has(key)) continue;
      seen.add(key);
      conflicts.push({
        sourceFile: architectural.sourceFile, sourcePage: architectural.sourcePage,
        category: "conflict", elementId: architectural.elementId,
        property: "Architectural/structural conflict: " + architectural.property,
        value: String(architectural.value) + " " + architectural.unit + " vs " + String(structural.value) + " " + structural.unit,
        unit: architectural.unit, provenance: "missing",
        confidence: Math.min(a.confidence ?? 0.8, b.confidence ?? 0.8),
        description: "Architectural sheet " + architectural.sourceFile + " p." + architectural.sourcePage +
          " differs from structural sheet " + structural.sourceFile + " p." + structural.sourcePage +
          " for " + architectural.elementId + ". Confirm the governing design information before construction."
      });
    }
  }
  return conflicts;
}
