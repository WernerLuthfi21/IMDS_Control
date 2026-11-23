// Weekly automatic follow-up: which days and which hour (WIB), what to send and to whom. Stored inside the
// follow-up settings (followup_config.schedule). Vercel calls /api/cron/followups once per hour of the day
// (24 daily jobs in vercel.json, the Hobby plan allows daily jobs only, each within its hour); the job sends
// only when the current WIB day and hour match and that slot has not run yet.
export type ScheduleAttach = { pdf: boolean; xlsx: boolean; checkForm: boolean };
export type ScheduleCc = { mid: boolean; top: boolean; dir: boolean; buyer: boolean };
export type Schedule = {
  enabled: boolean;
  /** 0 = Sunday … 6 = Saturday (WIB). */
  days: number[];
  /** 0–23, WIB. */
  hour: number;
  kind: "followup" | "request";
  /** Template id; empty = the default of that kind. */
  templateId: string;
  /** Short name from the Sender list (Werner, Ayu, …). */
  sender: string;
  attachments: ScheduleAttach;
  cc: ScheduleCc;
  /** Model keys to include; empty = all models. */
  models: string[];
  /** Also include parts that are Working (under TMMIN judgement). Default: only Not submitted + Rejected. */
  includeWorking: boolean;
  /** Only suppliers with at least one part past its target date. */
  onlyPastDue: boolean;
  /** Safety cap per run. */
  maxSuppliers: number;
  /** When a supplier has no IMDS PIC e-mail, send To middle management. */
  fallbackMid: boolean;
};

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const DEFAULT_SCHEDULE: Schedule = {
  enabled: false, days: [1], hour: 9, kind: "followup", templateId: "", sender: "",
  attachments: { pdf: true, xlsx: true, checkForm: true }, cc: { mid: false, top: false, dir: false, buyer: true },
  models: [], includeWorking: false, onlyPastDue: false, maxSuppliers: 60, fallbackMid: true
};

export function sanitizeSchedule(v: unknown): Schedule {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const a = (o.attachments && typeof o.attachments === "object" ? o.attachments : {}) as Record<string, unknown>;
  const c = (o.cc && typeof o.cc === "object" ? o.cc : {}) as Record<string, unknown>;
  const days = [...new Set((Array.isArray(o.days) ? o.days : DEFAULT_SCHEDULE.days).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  const hour = Number(o.hour);
  const max = Math.round(Number(o.maxSuppliers));
  return {
    enabled: o.enabled === true,
    days,
    hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : DEFAULT_SCHEDULE.hour,
    kind: o.kind === "request" ? "request" : "followup",
    templateId: String(o.templateId ?? "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 60),
    sender: String(o.sender ?? "").trim().slice(0, 40),
    attachments: { pdf: a.pdf !== false, xlsx: a.xlsx !== false, checkForm: a.checkForm !== false },
    cc: { mid: c.mid === true, top: c.top === true, dir: c.dir === true, buyer: c.buyer !== false },
    models: (Array.isArray(o.models) ? o.models : []).map((m) => String(m).trim().toUpperCase()).filter(Boolean).slice(0, 40),
    includeWorking: o.includeWorking === true,
    onlyPastDue: o.onlyPastDue === true,
    maxSuppliers: Number.isFinite(max) && max >= 1 && max <= 300 ? max : DEFAULT_SCHEDULE.maxSuppliers,
    fallbackMid: o.fallbackMid !== false
  };
}

/** WIB calendar slot of a moment: date, weekday, hour and a key that is unique per scheduled run. */
export function wibSlot(now: Date): { date: string; dow: number; hour: number; key: string } {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" })
    .formatToParts(now).map((x) => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`, hour = Number(p.hour) % 24;
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(String(p.weekday));
  return { date, dow, hour, key: `${date}@${String(hour).padStart(2, "0")}` };
}

export function isDue(s: Schedule, now: Date): boolean {
  if (!s.enabled || !s.days.length) return false;
  const w = wibSlot(now);
  return s.days.includes(w.dow) && w.hour === s.hour;
}

/** The next `n` run times (start of the hour, WIB) after `now`. The job runs within that hour. */
export function nextRuns(s: Schedule, now: Date, n = 3): Date[] {
  const out: Date[] = [];
  if (!s.enabled || !s.days.length) return out;
  const start = new Date(Math.floor(now.getTime() / 3600000) * 3600000 + 3600000);
  for (let t = start.getTime(); out.length < n && t < start.getTime() + 15 * 86400000; t += 3600000) {
    const d = new Date(t), w = wibSlot(d);
    if (s.days.includes(w.dow) && w.hour === s.hour) out.push(d);
  }
  return out;
}
