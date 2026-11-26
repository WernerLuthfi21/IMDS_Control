// Shared-master view rules are ported from private/imds-tracker.html and
// private/shared-master-sync.js. Keep workbook and server normalization distinct.
const statusRanks = { complete: 3, process: 2, rejected: 1.5, missing: 1, review: 0, stop: -1 };
export type PartStatus = keyof typeof statusRanks;

export const partStatuses = {
  complete: { label: "Submitted", tone: "ok", glyph: "✓" },
  process: { label: "Working", tone: "warn", glyph: "◐" },
  missing: { label: "Not Submitted Yet", tone: "bad", glyph: "✕" },
  rejected: { label: "Rejected", tone: "rej", glyph: "⊘" },
  review: { label: "Check", tone: "info", glyph: "?" },
  stop: { label: "Stop run", tone: "neutral", glyph: "■" }
} as const;

export const generalStatuses = ["complete", "process", "missing", "rejected"] as const;
export type GeneralStatus = (typeof generalStatuses)[number];

const UNASSIGNED = "__UNASSIGNED__";
const legacyDeadlines: Record<string, string> = { "688D": "2026-09-25", "737D": "2026-11-25", MISSING: "2026-11-30" };
const palette = ["#6D28D9", "#4338CA", "#0369A1", "#A21CAF", "#5B4FC9", "#0E7490", "#7E22CE", "#3B5BDB", "#86198F", "#1D4ED8", "#6B46C1", "#0F6E8C"];
const unassignedColor = "#6B6478";
const DAY = 86_400_000;

export function trackerCell(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object") return "result" in value ? trackerCell(value.result) : "";
  const text = String(value);
  if (/^\{\s*"(?:formula|sharedFormula|result|error)"\s*:/.test(text)) {
    try { return trackerCell(JSON.parse(text)); } catch { return ""; }
  }
  return text.replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, " ").trim();
}

export function classifyTrackerStatus(raw: unknown): PartStatus {
  const status = trackerCell(raw).toLowerCase();
  if (!status || status === "#n/a") return "missing";
  if (/^stop[\s-]?run$/.test(status)) return "stop";
  if (/^(check|cek)$/.test(status)) return "review";
  if (/\breject(ed|ion)?\b/.test(status)) return "rejected";
  if (["not submitted yet", "not submit yet", "not submitted", "not submit", "not yet submit", "no submission", "missing"].some(term => status.includes(term))) return "missing";
  if (/\b(in|not|non|un)[-\s]?(complete|completed|accepted)\b/.test(status)) return "review";
  if (["submission complete", "accepted", "complete"].some(term => status.includes(term))) return "complete";
  if (["working", "on process", "in process", "judgement", "judgment"].some(term => status.includes(term))) return "process";
  return "review";
}

export function normalizeModel(value: unknown) {
  const text = trackerCell(value);
  return !text || /^(#n\/a|n\/a|-|—|–|none|null|undefined)$/i.test(text)
    ? UNASSIGNED
    : text.toUpperCase().replace(/\s*[-–—]\s*/g, "-");
}

function modelColor(key: string) {
  if (key === UNASSIGNED) return unassignedColor;
  let hash = 2166136261;
  for (let index = 0; index < key.length; index++) hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
  return palette[(hash >>> 0) % palette.length];
}

export function localDate(iso: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
}

export const dateLabel = (date: Date) => new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(date);
export const percent = (part: number, total: number) => total ? Math.round(part / total * 100) : 0;
export const isSupplierAction = (status: PartStatus) => status === "missing" || status === "rejected";
export const normalizePartSearch = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");

export type MasterRow = Record<string, unknown>;
export type TrackerPart = {
  model: string;
  modelRaw: string;
  company: string;
  partNo: string;
  partName: string;
  vendorCode: string;
  masterId: string;
  status: PartStatus;
  statusRaw: string;
  targetDate: Date | null;
  pastDue: boolean;
  sourceCount: number;
  source: MasterRow;
};

type ModelPreference = { label?: string; color?: string; dash?: boolean; pdf?: boolean; deadline?: string };
export type ModelPreferences = Record<string, ModelPreference>;
export type TrackerDueDates = { models: Record<string, string>; suppliers: Record<string, string>; version: number };
export type TrackerCounts = Record<PartStatus, number> & { total: number; pastDue: number };

export function countParts(rows: readonly TrackerPart[]): TrackerCounts {
  const counts = { total: rows.length, complete: 0, process: 0, missing: 0, rejected: 0, review: 0, stop: 0, pastDue: 0 };
  for (const row of rows) {
    counts[row.status]++;
    if (row.pastDue) counts.pastDue++;
  }
  return counts;
}

export function buildTrackerDataset(rows: readonly MasterRow[], now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const grouped = new Map<string, TrackerPart>();
  rows.forEach((source, index) => {
    const company = trackerCell(source.company_name) || "(Unknown Supplier)";
    const partNo = trackerCell(source.part_no);
    const modelRaw = trackerCell(source.project);
    const model = normalizeModel(modelRaw);
    const statusRaw = trackerCell(source.imds_status);
    const status = classifyTrackerStatus(statusRaw);
    const partName = trackerCell(source.part_name);
    const targetDate = localDate(String(source.submission_plan ?? "").slice(0, 10));
    const key = partNo ? company + "|" + model + "|" + partNo.toUpperCase() : "#row" + (index + 1);
    const part = grouped.get(key);
    if (!part) {
      grouped.set(key, {
        model, modelRaw, company, partNo, partName, status, statusRaw, targetDate,
        vendorCode: trackerCell(source.vendor_code), masterId: trackerCell(source.id),
        pastDue: false, sourceCount: 1, source
      });
      return;
    }
    part.sourceCount++;
    if (statusRanks[status] > statusRanks[part.status]) part.status = status;
    if (targetDate && (!part.targetDate || targetDate < part.targetDate)) part.targetDate = targetDate;
    if (!part.partName && partName) part.partName = partName;
  });

  const all = [...grouped.values()];
  const modelsWithOpenParts = new Set(all.filter(part => isSupplierAction(part.status)).map(part => part.model));
  for (const part of all) {
    part.pastDue = Boolean(part.targetDate && part.targetDate < today && part.status !== "complete" && modelsWithOpenParts.has(part.model));
  }
  return {
    rawCount: rows.length,
    active: all.filter(part => part.status !== "review" && part.status !== "stop"),
    checks: all.filter(part => part.status === "review"),
    stopped: all.filter(part => part.status === "stop"),
    duplicates: all.filter(part => part.sourceCount > 1),
    all
  };
}

export function buildModelRegistry(
  rows: readonly TrackerPart[],
  preferences: ModelPreferences,
  dueDates: TrackerDueDates,
  now = new Date()
) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const byModel = Map.groupBy(rows, part => part.model);
  return Array.from(byModel, ([key, parts]) => {
    const preference = Object.hasOwn(preferences, key) ? preferences[key] || {} : {};
    const saved = Object.hasOwn(dueDates.models, key) ? dueDates.models[key] : undefined;
    const legacy = Object.hasOwn(legacyDeadlines, key) ? legacyDeadlines[key] : undefined;
    const local = Object.hasOwn(preference, "deadline") ? preference.deadline || "" : undefined;
    // A versioned team deadline overrides the browser value. When a previously
    // saved browser deadline is removed on the server, it stays cleared.
    const iso = dueDates.version > 0 ? saved ?? (local === undefined ? legacy : "") : local ?? legacy;
    const deadline = localDate(iso ?? "");
    const counts = countParts(parts);
    return {
      key,
      label: preference.label || (key === UNASSIGNED ? "Unassigned" : key === "MISSING" ? "Missing" : key),
      color: /^#[\da-f]{6}$/i.test(preference.color ?? "") ? preference.color! : modelColor(key),
      visible: preference.dash !== false,
      inPdf: preference.pdf !== false,
      deadline, days: deadline ? Math.ceil((deadline.getTime() - today.getTime()) / DAY) : Infinity,
      done: !parts.some(part => isSupplierAction(part.status) || part.status === "review"),
      progress: percent(counts.complete, counts.total),
      counts, parts
    };
  }).sort((a, b) => {
    if (a.key === UNASSIGNED) return 1;
    if (b.key === UNASSIGNED) return -1;
    return Number(!a.deadline) - Number(!b.deadline) || (a.deadline?.getTime() ?? Infinity) - (b.deadline?.getTime() ?? Infinity) ||
      a.key.localeCompare(b.key, "en", { numeric: true, sensitivity: "base" });
  });
}

export type TrackerModel = ReturnType<typeof buildModelRegistry>[number];
export type TrackerScope = { model: string; status: GeneralStatus | ""; supplier: string; query: string; urgency: string };
export const emptyScope: TrackerScope = { model: "", status: "", supplier: "", query: "", urgency: "" };

export function urgencyForModel(model: TrackerModel) {
  if (model.done) return "ontime";
  return model.days < 0 ? "pastdue" : model.days <= 14 ? "due14" : "ontime";
}

export function scopeParts(rows: readonly TrackerPart[], models: readonly TrackerModel[], scope: TrackerScope) {
  const registry = new Map(models.map(model => [model.key, model]));
  const query = scope.query.trim().toLowerCase();
  const partSearch = normalizePartSearch(query);
  return rows.filter(part => {
    const model = registry.get(part.model);
    if (!model?.visible || (scope.model && part.model !== scope.model) || (scope.supplier && part.company !== scope.supplier)) return false;
    if (scope.urgency && urgencyForModel(model) !== scope.urgency) return false;
    return !query || [part.partNo, part.partName, part.company, model.label].join(" ").toLowerCase().includes(query) ||
      (partSearch.length >= 3 && normalizePartSearch(part.partNo).includes(partSearch));
  });
}

export function aggregateSuppliers(rows: readonly TrackerPart[], models: readonly TrackerModel[]) {
  const registry = new Map(models.map((model, index) => [model.key, index]));
  return Array.from(Map.groupBy(rows, row => row.company), ([company, parts]) => {
    const counts = countParts(parts);
    const keys = [...new Set(parts.map(part => part.model))].sort((a, b) => (registry.get(a) ?? 0) - (registry.get(b) ?? 0));
    return { company, counts, models: keys, open: counts.missing + counts.rejected, progress: percent(counts.complete, counts.total), parts };
  });
}

export type TrackerSupplier = ReturnType<typeof aggregateSuppliers>[number];

export function nextModelDeadline(models: readonly TrackerModel[]) {
  const open = models.filter(model => model.visible && model.deadline && !model.done).sort((a, b) => a.days - b.days);
  return open.find(model => model.days >= 0) ?? open.at(-1);
}

export function modelHealth(model: TrackerModel) {
  if (model.done) return { label: "Complete", tone: "ok" };
  if (!model.deadline) return { label: "No deadline", tone: "neutral" };
  if (model.days < 0) return { label: model.progress < 30 ? "Overdue · critical" : "Overdue", tone: "bad" };
  if (model.days <= 14) return { label: "At risk", tone: "warn" };
  return { label: "On track", tone: "ok" };
}
