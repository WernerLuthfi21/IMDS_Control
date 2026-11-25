// Pure rules for Tracker part operations: target dates, the Check tab, Stop run and its log.
// No I/O: the route reads the master rows and the "part_log" settings document, calls planPartOps(), then writes.
//
// Statuses written to the master (column IMDS STATUS, synced to Excel like any manual edit):
//   CHECK     = we are checking this part by hand (supplier says it is not theirs, wrong model…). Not a general status.
//   STOP RUN  = the part number is no longer running. It leaves the Tracker; its last identity stays in the log.
// Moving back never guesses: the status from before the move is restored unless the user picks another one.

export const CHECK_STATUS = "CHECK";
export const STOP_STATUS = "STOP RUN";
export const DEFAULT_OPEN_STATUS = "NOT SUBMITTED YET";
/** Statuses the user may pick when sending a part back from Check. */
export const RESOLVE_STATUSES = ["NOT SUBMITTED YET", "WORKING", "ACCEPTED", "REJECTED"] as const;
export const MAX_EVENTS = 5000;

export type Action = "set-target" | "to-check" | "resolve" | "stop-run" | "restore" | "reassign" | "renumber";
export const ACTIONS: Action[] = ["set-target", "to-check", "resolve", "stop-run", "restore", "reassign", "renumber"];
/** Part number as stored (trimmed, upper case, inner spaces removed) and the normalised form used for matching. */
export const cleanPartNo = (v: unknown) => String(v ?? "").toUpperCase().replace(/\s+/g, "").replace(/[^A-Z0-9\-._/]/g, "").slice(0, 40);
export const normPartNo = (v: unknown) => String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Who and what a part was at a moment: enough to recognise it after it leaves the Tracker. */
export type Identity = {
  company: string; vendorCode: string; model: string; partNo: string; partName: string;
  status: string; targetDate: string; email: string;
};
export type CheckEntry = { at: string; by: string; reason: string; from: Identity };
export type LogEvent = {
  id: string; at: string; by: string; action: Exclude<Action, "set-target">;
  reason: string; before: Identity; after?: Partial<Identity>;
};
export type PartLog = { checks: Record<string, CheckEntry>; events: LogEvent[] };

export type MasterRow = {
  id: string; company_name?: string | null; vendor_code?: string | null; project?: string | null; part_no?: string | null;
  part_name?: string | null; imds_status?: string | null; submission_plan?: string | null; main_pic_email?: string | null;
};
export type Options = {
  reason?: string; date?: string | null;
  company?: string; vendorCode?: string; email?: string; model?: string; status?: string;
  /** renumber: the new part number and (optional) new part name. */
  partNo?: string; partName?: string;
};
export type Patch = Partial<Pick<Required<MasterRow>, "company_name" | "vendor_code" | "project" | "imds_status" | "submission_plan" | "main_pic_email" | "part_no" | "part_name">> & { part_no_norm?: string };
/** release = fields handed back to the Excel import (removed from manual_overrides), e.g. the status after Check. */
export type Update = { id: string; patch: Patch; release?: string[] };
export type Plan = { log: PartLog; updates: Update[]; logChanged: boolean };

const txt = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : v == null ? "" : String(v).trim().slice(0, max));
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function isCheckStatus(raw: unknown): boolean { return /^\s*(check|cek)\s*$/i.test(String(raw ?? "")); }
export function isStopStatus(raw: unknown): boolean { return /^\s*stop[\s-]?run\s*$/i.test(String(raw ?? "")); }

export function identityOf(r: MasterRow): Identity {
  return {
    company: txt(r.company_name), vendorCode: txt(r.vendor_code, 40), model: txt(r.project, 60), partNo: txt(r.part_no, 80),
    partName: txt(r.part_name), status: txt(r.imds_status, 60), targetDate: txt(r.submission_plan, 10), email: txt(r.main_pic_email, 320),
  };
}

function cleanIdentity(v: unknown): Identity {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return {
    company: txt(o.company), vendorCode: txt(o.vendorCode, 40), model: txt(o.model, 60), partNo: txt(o.partNo, 80),
    partName: txt(o.partName), status: txt(o.status, 60), targetDate: ISO.test(txt(o.targetDate, 10)) ? txt(o.targetDate, 10) : "", email: txt(o.email, 320),
  };
}

export function sanitizePartLog(v: unknown): PartLog {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const checks: Record<string, CheckEntry> = {};
  const rawChecks = (o.checks && typeof o.checks === "object" ? o.checks : {}) as Record<string, unknown>;
  for (const [id, e] of Object.entries(rawChecks).slice(0, 20000)) {
    if (!/^[0-9a-f-]{36}$/i.test(id) || !e || typeof e !== "object") continue;
    const c = e as Record<string, unknown>;
    checks[id] = { at: txt(c.at, 40), by: txt(c.by, 120), reason: txt(c.reason, 500), from: cleanIdentity(c.from) };
  }
  const events: LogEvent[] = [];
  for (const e of Array.isArray(o.events) ? o.events : []) {
    if (!e || typeof e !== "object") continue;
    const x = e as Record<string, unknown>;
    const action = txt(x.action, 20) as LogEvent["action"];
    if (!["to-check", "resolve", "stop-run", "restore", "reassign", "renumber"].includes(action) || !/^[0-9a-f-]{36}$/i.test(txt(x.id, 40))) continue;
    const ev: LogEvent = { id: txt(x.id, 40), at: txt(x.at, 40), by: txt(x.by, 120), action, reason: txt(x.reason, 500), before: cleanIdentity(x.before) };
    if (x.after && typeof x.after === "object") {
      const a = cleanIdentity(x.after), after: Partial<Identity> = {};
      (Object.keys(a) as Array<keyof Identity>).forEach((k) => { if (a[k]) after[k] = a[k]; });
      ev.after = after;
    }
    events.push(ev);
  }
  return { checks, events: events.slice(-MAX_EVENTS) };
}

/** The last Stop run event of a part, if it is still stopped (no restore after it). */
export function lastStop(log: PartLog, id: string): LogEvent | null {
  for (let i = log.events.length - 1; i >= 0; i--) {
    const e = log.events[i];
    if (e.id !== id) continue;
    if (e.action === "stop-run") return e;
    if (e.action === "restore") return null;
  }
  return null;
}

/** Status to show again after Check: the user's choice, else the status from before the move, else Not Submitted Yet. */
function statusBack(chosen: string | undefined, prior: string | undefined): string {
  const c = txt(chosen, 60).toUpperCase();
  if (c) return c;
  const p = txt(prior, 60);
  return p && !isCheckStatus(p) && !isStopStatus(p) ? p : DEFAULT_OPEN_STATUS;
}

export function validate(action: string, ids: string[], o: Options): string | null {
  if (!ACTIONS.includes(action as Action)) return "Unknown action.";
  if (!ids.length) return "Select at least one part.";
  if (ids.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) return "Invalid part id.";
  if (ids.length > (action === "set-target" ? 6000 : 500)) return "Too many parts in one request.";
  if (action === "set-target" && o.date != null && o.date !== "" && !ISO.test(String(o.date))) return "The date must use YYYY-MM-DD.";
  if (action === "resolve") {
    if (o.status && !RESOLVE_STATUSES.includes(txt(o.status, 60).toUpperCase() as (typeof RESOLVE_STATUSES)[number])) return "That status cannot be chosen here.";
  }
  if (action === "stop-run" && !txt(o.reason)) return "Write why the part stopped running (it goes into the log).";
  if (action === "reassign" && !txt(o.company) && !txt(o.model)) return "Choose the correct supplier or the correct model.";
  if (action === "renumber") {
    if (ids.length !== 1) return "Change one part number at a time.";
    if (normPartNo(o.partNo).length < 5) return "Enter the new part number (at least 5 letters or digits).";
  }
  return null;
}

export function planPartOps(action: Action, rows: MasterRow[], current: PartLog, o: Options, by: string, now: Date): Plan {
  const at = now.toISOString(), reason = txt(o.reason, 500);
  const log: PartLog = { checks: { ...current.checks }, events: current.events.slice() };
  const updates: Plan["updates"] = [];
  let logChanged = false;
  for (const r of rows) {
    const me = identityOf(r);
    if (action === "set-target") {
      const date = o.date && ISO.test(o.date) ? o.date : null;
      if ((r.submission_plan || null) !== date) updates.push({ id: r.id, patch: { submission_plan: date } });
      continue;
    }
    if (action === "to-check") {
      if (isCheckStatus(r.imds_status) && log.checks[r.id]) continue;
      log.checks[r.id] = { at, by, reason, from: me };
      log.events.push({ id: r.id, at, by, action, reason, before: me });
      updates.push({ id: r.id, patch: { imds_status: CHECK_STATUS } });
      logChanged = true;
      continue;
    }
    if (action === "resolve") {
      const prior = log.checks[r.id]?.from;
      const patch: Patch = { imds_status: statusBack(o.status, prior?.status) };
      const after: Partial<Identity> = { status: patch.imds_status! };
      const company = txt(o.company);
      if (company && company !== me.company) {
        patch.company_name = company; after.company = company;
        if (o.vendorCode !== undefined) { patch.vendor_code = txt(o.vendorCode, 40) || null; after.vendorCode = patch.vendor_code || ""; }
        if (o.email !== undefined) { patch.main_pic_email = txt(o.email, 320) || null; after.email = patch.main_pic_email || ""; }
      }
      const model = txt(o.model, 60);
      if (model && model !== me.model) { patch.project = model; after.model = model; }
      delete log.checks[r.id];
      log.events.push({ id: r.id, at, by, action, reason, before: prior ? { ...me, status: prior.status } : me, after });
      updates.push({ id: r.id, patch, release: ["imds_status"] });
      logChanged = true;
      continue;
    }
    if (action === "reassign") {
      // Wrong supplier or model found while the part is in the tracker: identity changes, status stays.
      const patch: Patch = {}, after: Partial<Identity> = {};
      const company = txt(o.company);
      if (company && company !== me.company) {
        patch.company_name = company; after.company = company;
        if (o.vendorCode !== undefined) { patch.vendor_code = txt(o.vendorCode, 40) || null; after.vendorCode = patch.vendor_code || ""; }
        if (o.email !== undefined) { patch.main_pic_email = txt(o.email, 320) || null; after.email = patch.main_pic_email || ""; }
      }
      const model = txt(o.model, 60);
      if (model && model !== me.model) { patch.project = model; after.model = model; }
      if (!Object.keys(patch).length) continue;
      log.events.push({ id: r.id, at, by, action, reason, before: me, after });
      updates.push({ id: r.id, patch });
      logChanged = true;
      continue;
    }
    if (action === "renumber") {
      // The supplier / Toyota changed the part number (e.g. a new suffix). Same row, same Excel KEY, status kept;
      // the old number stays in the log so it can still be found.
      const partNo = cleanPartNo(o.partNo), name = txt(o.partName);
      const patch: Patch = {}, after: Partial<Identity> = {};
      if (partNo && normPartNo(partNo) !== normPartNo(me.partNo)) { patch.part_no = partNo; patch.part_no_norm = normPartNo(partNo); after.partNo = partNo; }
      else if (partNo && partNo !== me.partNo) { patch.part_no = partNo; after.partNo = partNo; }
      if (name && name !== me.partName) { patch.part_name = name; after.partName = name; }
      if (!Object.keys(patch).length) continue;
      log.events.push({ id: r.id, at, by, action, reason: reason || "Part number updated", before: me, after });
      updates.push({ id: r.id, patch });
      logChanged = true;
      continue;
    }
    if (action === "stop-run") {
      if (isStopStatus(r.imds_status)) continue;
      const prior = log.checks[r.id]?.from;
      // The last identity before Stop run: the row as it is now, with the status it had before Check.
      const before = { ...me, status: prior && isCheckStatus(me.status) ? prior.status : me.status };
      delete log.checks[r.id];
      log.events.push({ id: r.id, at, by, action, reason, before });
      updates.push({ id: r.id, patch: { imds_status: STOP_STATUS } });
      logChanged = true;
      continue;
    }
    if (action === "restore") {
      const stop = lastStop(log, r.id);
      if (!stop && !isStopStatus(r.imds_status)) continue;
      const status = statusBack(o.status, stop?.before.status);
      log.events.push({ id: r.id, at, by, action, reason, before: me, after: { status } });
      updates.push({ id: r.id, patch: { imds_status: status }, release: ["imds_status"] });
      logChanged = true;
    }
  }
  log.events = log.events.slice(-MAX_EVENTS);
  return { log, updates, logChanged };
}

/** Rows that share the exact same update can be written in one query. */
// A field the app wrote stays in manual_overrides, so the next Excel import keeps it (CHECK, STOP RUN, a corrected
// supplier, a target date). A released field goes back to following the workbook.
export function groupUpdates(updates: Update[], overridesOf: (id: string) => string[]): Array<{ ids: string[]; patch: Patch & { manual_overrides: string[] } }> {
  const groups = new Map<string, { ids: string[]; patch: Patch & { manual_overrides: string[] } }>();
  for (const u of updates) {
    const release = new Set(u.release || []);
    const manual = [...new Set([...overridesOf(u.id), ...Object.keys(u.patch)])].filter((f) => !release.has(f)).sort();
    const patch = { ...u.patch, manual_overrides: manual };
    const key = JSON.stringify(patch);
    const g = groups.get(key);
    if (g) g.ids.push(u.id); else groups.set(key, { ids: [u.id], patch });
  }
  return [...groups.values()];
}
