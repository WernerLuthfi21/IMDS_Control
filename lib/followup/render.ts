// Server-side rendering of a supplier e-mail from a template, for the weekly schedule. The Tracker page renders the
// same placeholders in the browser (private/shared-master-sync.js: fill / partLines / projLines); keep them in step.
import { fullSenderName, signOff, type FollowupConfig, type Template } from "./center";

/** The IMDS team (Tracker "Sender" list). Same as SENDERS in private/imds-tracker.html; a test keeps them equal. */
export const TEAM: Record<string, string> = { Aiko: "emd.magang3@toyota.co.id", Ayu: "eka.ayu@toyota.co.id", Jasmin: "emd.magang10@toyota.co.id", Werner: "emd.magang9@toyota.co.id" };

export type Bucket = "missing" | "rejected" | "process" | "complete" | "review" | "stop";
const RULES = {
  missing: ["not submitted yet", "not submit yet", "not submitted", "not submit", "not yet submit", "no submission", "missing"],
  rejected: /\breject(ed|ion)?\b/, stop: /^stop[\s-]?run$/, check: /^(check|cek)$/,
  negated: /\b(in|not|non|un)[-\s]?(complete|completed|accepted)\b/,
  complete: ["submission complete", "accepted", "complete"],
  process: ["working", "on process", "in process", "judgement", "judgment", "under judgement", "under judgment"]
};
/** IMDS STATUS → bucket. Same rules as classify() in the Tracker page. */
export function classifyStatus(raw: unknown): Bucket {
  const s = String(raw ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!s || s === "#n/a") return "missing";
  if (RULES.stop.test(s)) return "stop";
  if (RULES.check.test(s)) return "review";
  if (RULES.rejected.test(s)) return "rejected";
  if (RULES.missing.some((k) => s.includes(k))) return "missing";
  if (RULES.negated.test(s)) return "review";
  if (RULES.complete.some((k) => s.includes(k))) return "complete";
  if (RULES.process.some((k) => s.includes(k))) return "process";
  return "review";
}
/** Model key as the Tracker builds it ("737 D" stays "737 D", "688-D" → "688-D", blank → "UNASSIGNED"). */
export function modelKey(raw: unknown): string {
  const s = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!s || /^(#n\/a|n\/a|-|—|–|none|null|undefined)$/i.test(s)) return "UNASSIGNED";
  return s.toUpperCase().replace(/\s*[-–—]\s*/g, "-");
}

export type RenderPart = { partNo: string; partName: string; model: string; status: Bucket; target: string | null };
export type DueDates = { models?: Record<string, string>; suppliers?: Record<string, string> };

const WIB = "Asia/Jakarta";
const ymd = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: WIB }).format(d);
const isoToDate = (iso: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 5)) : null; };
const ordinal = (n: number) => { const v = n % 100; return v >= 11 && v <= 13 ? n + "th" : n + ((({ 1: "st", 2: "nd", 3: "rd" }) as Record<number, string>)[n % 10] || "th"); };
export function dateLong(iso: string): string {
  const d = isoToDate(iso); if (!d) return "";
  return `${ordinal(d.getUTCDate())} ${new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" }).format(d)} ${d.getUTCFullYear()}`;
}
const pretty = (iso: string) => { const d = isoToDate(iso); return d ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(d) : ""; };
/** "737D" → "7*7D": project numbers are masked in supplier e-mails, as in the Tracker. */
export const maskProj = (p: string) => String(p || "").replace(/\b(\d)\d(\d[A-Za-z]*)\b/g, "$1*$2");
const label = (k: string) => (k === "UNASSIGNED" ? "Unassigned" : k === "MISSING" ? "Missing" : k);
export const supDueKey = (c: string, m: string) => String(c || "").trim().toUpperCase() + "|" + String(m || "").trim();

export function greetingAt(now: Date): string {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: WIB }).format(now));
  return h < 11 ? "Good Morning" : h < 15 ? "Good Afternoon" : "Good Evening";
}

export function partLines(kind: string, parts: RenderPart[], today: string): string {
  return parts.map((r, i) => {
    const past = !!(r.target && r.target < today);
    const base = `${i + 1}. ${r.partNo} — ${r.partName || (kind === "request" ? "" : "(part name not on file)")}`;
    return base + (kind === "request" && r.target ? ` — Target Date: ${pretty(r.target)}` : "") + (r.status === "rejected" ? " — REJECTED, please resubmit" : "") + (past ? " — PAST DUE" : "");
  }).join("\n");
}

const listJoin = (p: string[]) => (p.length > 1 ? p.slice(0, -1).join(", ") + " and " + p[p.length - 1] : p[0] || "the requested project");

export type RenderInput = {
  template: Template; config: Pick<FollowupConfig, "signature" | "senderNames" | "senderFooters">; kind: string;
  supplier: string; code: string; parts: RenderPart[]; due: DueDates; sender: string; now: Date; includeList?: boolean; modelOrder?: string[];
};
export function renderSupplierEmail(i: RenderInput): { subject: string; body: string } {
  const today = ymd(i.now);
  const order = (a: string, b: string) => { const o = i.modelOrder || []; const x = o.indexOf(a), y = o.indexOf(b); return (x < 0 ? 999 : x) - (y < 0 ? 999 : y) || a.localeCompare(b); };
  const models = [...new Set(i.parts.map((p) => p.model))].sort(order);
  const deadlines = models.map((m) => {
    const own = (i.due.suppliers || {})[supDueKey(i.supplier, m)], md = (i.due.models || {})[m];
    return `- ${maskProj(label(m))} Project no later than ${own ? dateLong(own) : md ? dateLong(md) : "the applicable submission deadline"}`;
  }).join("\n");
  const sorted = [...i.parts].sort((a, b) => (a.target || "9999").localeCompare(b.target || "9999") || a.partNo.localeCompare(b.partNo));
  const fmtLong = (d: Date) => new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "long", year: "numeric", timeZone: WIB }).format(d);
  const ctx: Record<string, string> = {
    supplier: i.supplier, code: i.code || "-", count: String(i.parts.length), projects: listJoin(models.map((m) => maskProj(label(m)))),
    deadlines, partlist: i.includeList === false ? "(please see the attached file)" : partLines(i.kind, sorted, today),
    models: listJoin(models.map((m) => maskProj(label(m)))), modelshort: models.map((m) => maskProj(label(m))).join(", "),
    sender: i.sender, sendername: fullSenderName(i.config.senderNames || {}, i.sender), greeting: greetingAt(i.now),
    date: fmtLong(i.now), updated: fmtLong(i.now) + ", " + new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: WIB }).format(i.now) + " WIB",
    duedate: new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "2-digit", month: "long", year: "numeric", timeZone: WIB }).format(new Date(i.now.getTime() + 7 * 86400000))
  };
  const fill = (t: string) => t.replace(/\{(supplier|code|count|projects|deadlines|partlist|models|modelshort|sender|sendername|greeting|date|updated|duedate)\}/g, (_m, k: string) => ctx[k] ?? "");
  return { subject: fill(i.template.subject).slice(0, 240), body: signOff(fill(i.template.body), i.config, i.sender) };
}
