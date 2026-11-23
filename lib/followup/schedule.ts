// Automatic follow-ups ("automations"), stored in followup_config.automations. Each automation has its own e-mail
// type, frequency (weekly, every 2 weeks, monthly), days, hour (WIB), recipients, files and a reminder to the TMMIN
// PIC before it sends. Vercel calls /api/cron/followups once in every hour of the day (24 daily jobs, Hobby plan);
// each automation sends only when its WIB slot matches, once per slot, and never on a slot that was skipped.
export type AutoKind = "followup" | "request" | "recap";
export type Frequency = "weekly" | "biweekly" | "monthly";
export type Automation = {
  id: string;
  name: string;
  enabled: boolean;
  kind: AutoKind;
  frequency: Frequency;
  /** 0 = Sunday … 6 = Saturday (WIB). */
  days: number[];
  /** 0–23, WIB. */
  hour: number;
  /** Every 2 weeks: the week of this date (YYYY-MM-DD) is a sending week. */
  anchor: string;
  /** Monthly: 1–4 = first … fourth week of the month, 5 = last week. */
  monthWeek: number;
  templateId: string;
  /** Short name from the Sender list (sign-off and "from"). */
  sender: string;
  /** Model keys; empty = all. */
  models: string[];
  includeWorking: boolean;
  onlyPastDue: boolean;
  maxSuppliers: number;
  fallbackMid: boolean;
  cc: { mid: boolean; top: boolean; dir: boolean; buyer: boolean };
  /** pdf = supplier recap PDF (recap: summary PDF of all suppliers); xlsx = Excel list; library = ids of standard files. */
  attachments: { pdf: boolean; xlsx: boolean; library: string[] };
  /** Reminder e-mail to the TMMIN PIC before the run (hours ahead; empty "to" = the sender's own address). */
  notify: { enabled: boolean; leadHours: number; to: string[] };
  /** A run slot (YYYY-MM-DD@HH) that must not send ("Skip next run"). */
  skip: string;
};

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const KIND_NAMES: Record<AutoKind, string> = { followup: "Follow-up per supplier", request: "Request per supplier", recap: "Summary to all suppliers (one e-mail, PDF)" };

export function newAutomation(id: string, today: string): Automation {
  return {
    id, name: "Weekly follow-up", enabled: false, kind: "followup", frequency: "weekly", days: [1], hour: 9, anchor: today, monthWeek: 1,
    templateId: "", sender: "", models: [], includeWorking: false, onlyPastDue: false, maxSuppliers: 60, fallbackMid: true,
    cc: { mid: false, top: false, dir: false, buyer: true }, attachments: { pdf: true, xlsx: true, library: [] },
    notify: { enabled: true, leadHours: 24, to: [] }, skip: ""
  };
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const emailRe = /^[^@\s;,<>]+@[^@\s;,<>]+\.[^@\s;,<>]+$/;
export function sanitizeAutomation(v: unknown, fallbackId = "a1"): Automation {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const a = (o.attachments && typeof o.attachments === "object" ? o.attachments : {}) as Record<string, unknown>;
  const c = (o.cc && typeof o.cc === "object" ? o.cc : {}) as Record<string, unknown>;
  const n = (o.notify && typeof o.notify === "object" ? o.notify : {}) as Record<string, unknown>;
  const base = newAutomation(String(o.id ?? fallbackId).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || fallbackId, "2026-01-05");
  const days = [...new Set((Array.isArray(o.days) ? o.days : base.days).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  const hour = Number(o.hour), max = Math.round(Number(o.maxSuppliers)), lead = Math.round(Number(n.leadHours)), mw = Math.round(Number(o.monthWeek));
  return {
    id: base.id,
    name: String(o.name ?? "").trim().slice(0, 80) || "Automatic follow-up",
    enabled: o.enabled === true,
    kind: o.kind === "request" || o.kind === "recap" ? o.kind : "followup",
    frequency: o.frequency === "biweekly" || o.frequency === "monthly" ? o.frequency : "weekly",
    days,
    hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : base.hour,
    anchor: ISO.test(String(o.anchor ?? "")) ? String(o.anchor) : base.anchor,
    monthWeek: mw >= 1 && mw <= 5 ? mw : 1,
    templateId: String(o.templateId ?? "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 60),
    sender: String(o.sender ?? "").trim().slice(0, 40),
    models: (Array.isArray(o.models) ? o.models : []).map((m) => String(m).trim().toUpperCase()).filter(Boolean).slice(0, 40),
    includeWorking: o.includeWorking === true,
    onlyPastDue: o.onlyPastDue === true,
    maxSuppliers: Number.isFinite(max) && max >= 1 && max <= 300 ? max : base.maxSuppliers,
    fallbackMid: o.fallbackMid !== false,
    cc: { mid: c.mid === true, top: c.top === true, dir: c.dir === true, buyer: c.buyer !== false },
    attachments: { pdf: a.pdf !== false, xlsx: a.xlsx !== false, library: (Array.isArray(a.library) ? a.library : []).map((x) => String(x).replace(/[^a-zA-Z0-9_-]/g, "")).filter(Boolean).slice(0, 10) },
    notify: {
      enabled: n.enabled !== false,
      leadHours: Number.isFinite(lead) && lead >= 1 && lead <= 72 ? lead : 24,
      to: [...new Set((Array.isArray(n.to) ? n.to : String(n.to ?? "").split(/[;,\s]+/)).map((x) => String(x).trim()).filter((x) => emailRe.test(x)))].slice(0, 10)
    },
    skip: /^\d{4}-\d{2}-\d{2}@\d{2}$/.test(String(o.skip ?? "")) ? String(o.skip) : ""
  };
}

/** The list of automations; an older single "schedule" setting becomes the first automation. */
export function sanitizeAutomations(list: unknown, legacy?: unknown): Automation[] {
  let src = Array.isArray(list) ? list : [];
  if (!src.length && legacy && typeof legacy === "object") {
    const l = legacy as Record<string, unknown>, att = (l.attachments || {}) as Record<string, unknown>;
    if (l.enabled === true || Array.isArray(l.days)) src = [{ ...l, id: "a1", name: "Weekly follow-up", attachments: { pdf: att.pdf, xlsx: att.xlsx, library: [] } }];
  }
  const seen = new Set<string>(), out: Automation[] = [];
  src.slice(0, 20).forEach((v, i) => { const a = sanitizeAutomation(v, "a" + (i + 1)); if (seen.has(a.id)) a.id = a.id + "_" + i; seen.add(a.id); out.push(a); });
  return out;
}

/** WIB calendar slot of a moment. */
export function wibSlot(now: Date): { date: string; dow: number; hour: number; day: number; key: string } {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" })
    .formatToParts(now).map((x) => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`, hour = Number(p.hour) % 24;
  return { date, dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(String(p.weekday)), hour, day: Number(p.day), key: `${date}@${String(hour).padStart(2, "0")}` };
}

const dayNo = (iso: string) => Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000);
/** Monday-based week number, so "every 2 weeks" keeps the same week parity as the anchor. */
const weekNo = (iso: string) => Math.floor((dayNo(iso) + 3) / 7);
const daysInMonth = (iso: string) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7), 0)).getUTCDate();

/** Is this WIB date a sending date for the automation (frequency + weekday)? */
export function onDate(a: Automation, w: { date: string; dow: number; day: number }): boolean {
  if (!a.days.includes(w.dow)) return false;
  if (a.frequency === "biweekly") return (((weekNo(w.date) - weekNo(a.anchor)) % 2) + 2) % 2 === 0;
  if (a.frequency === "monthly") return a.monthWeek === 5 ? w.day + 7 > daysInMonth(w.date) : Math.ceil(w.day / 7) === a.monthWeek;
  return true;
}
export function isDue(a: Automation, now: Date): boolean {
  if (!a.enabled || !a.days.length) return false;
  const w = wibSlot(now);
  return w.hour === a.hour && onDate(a, w) && a.skip !== w.key;
}
/** The next `n` run times (start of the hour) after `now`, skipped slot excluded. */
export function nextRuns(a: Automation, now: Date, n = 3): Date[] {
  const out: Date[] = [];
  if (!a.enabled || !a.days.length) return out;
  const start = Math.floor(now.getTime() / 3600000) * 3600000 + 3600000;
  for (let t = start; out.length < n && t < start + 70 * 86400000; t += 3600000) {
    const d = new Date(t), w = wibSlot(d);
    if (w.hour === a.hour && onDate(a, w) && a.skip !== w.key) out.push(d);
  }
  return out;
}
/** The run this hour's reminder is for: the run exactly `leadHours` after the current hour, if any. */
export function noticeFor(a: Automation, now: Date): Date | null {
  if (!a.enabled || !a.notify.enabled || !a.days.length) return null;
  const run = new Date(Math.floor(now.getTime() / 3600000) * 3600000 + a.notify.leadHours * 3600000), w = wibSlot(run);
  return w.hour === a.hour && onDate(a, w) && a.skip !== w.key ? run : null;
}

export function describe(a: Automation): string {
  const h = String(a.hour).padStart(2, "0"), days = a.days.map((d) => DAY_NAMES[d]).join(", ") || "no day";
  const freq = a.frequency === "biweekly" ? "Every 2 weeks on " : a.frequency === "monthly" ? `Monthly, ${["", "first", "second", "third", "fourth", "last"][a.monthWeek]} week, on ` : "Every ";
  return `${freq}${days}, ${h}:00–${h}:59 WIB`;
}
