// Pure rules for the Tracker follow-up center: configuration, templates, who is on CC, which parts are chased.
// No I/O so everything here is unit-tested. The API routes only load data and call these functions.
import { emailsOf } from "./recipients";

export type Template = { id: string; name: string; subject: string; body: string };
export type FollowupConfig = {
  templates: Template[];
  defaultTemplateId: string;
  /** Always on CC for every supplier e-mail. Senders cannot remove these. */
  requiredCc: string[];
  /** Directory contacts added to CC by default (the sender may switch them off per batch, never the required list). */
  ccRoles: { mid: boolean; top: boolean; buyer: boolean };
  attachments: { pdf: boolean; xlsx: boolean };
  /** "action" = parts the supplier must act on (not submitted / rejected / unknown). "all" = everything not ACCEPTED. */
  statusScope: "action" | "all";
  maxPartsInBody: number;
};

export const PLACEHOLDERS = ["{supplier}", "{code}", "{count}", "{models}", "{partlist}", "{sender}", "{date}"] as const;

export const DEFAULT_CONFIG: FollowupConfig = {
  templates: [
    {
      id: "reminder-en", name: "Standard reminder (English)",
      subject: "IMDS submission follow-up | {supplier} | {count} outstanding part(s)",
      body: ["Dear {supplier} Team,", "", "We would appreciate your support to review the latest IMDS submission status for the following outstanding parts.", "Supplier code: {code}", "Model(s): {models}", "Outstanding parts: {count}", "", "PART LIST", "{partlist}", "", "Please confirm the latest IMDS status and provide a committed submission date for each part. The part list is attached for your reference (the column on the right is for your planned submission date).", "", "Thank you for your support and cooperation.", "", "Best regards,", "{sender}"].join("\n")
    },
    {
      id: "pengingat-id", name: "Pengingat standar (Indonesia)",
      subject: "Tindak lanjut submit IMDS | {supplier} | {count} part belum selesai",
      body: ["Yth. Tim {supplier},", "", "Mohon dukungan Bapak/Ibu untuk menindaklanjuti submit IMDS pada part berikut.", "Kode supplier: {code}", "Model: {models}", "Jumlah part: {count}", "", "DAFTAR PART", "{partlist}", "", "Mohon konfirmasi status terbaru dan tanggal komitmen submit untuk setiap part. Daftar lengkap terlampir (kolom paling kanan dapat diisi dengan rencana tanggal submit).", "", "Terima kasih atas kerja samanya.", "", "Hormat kami,", "{sender}"].join("\n")
    },
    {
      id: "eskalasi-id", name: "Eskalasi / pengingat akhir (Indonesia)",
      subject: "[PENTING] Pengingat akhir submit IMDS | {supplier} | {count} part",
      body: ["Yth. {supplier},", "", "Submit IMDS untuk part berikut masih belum selesai dan memerlukan penyelesaian segera.", "Kode supplier: {code}", "Model: {models}", "Jumlah part: {count}", "", "DAFTAR PART", "{partlist}", "", "Mohon balas email ini paling lambat dalam 3 hari kerja dengan tanggal komitmen submit. Email ini disertai manajemen Anda dan manajemen kami untuk penanganan bersama.", "", "Terima kasih.", "", "Hormat kami,", "{sender}"].join("\n")
    }
  ],
  defaultTemplateId: "pengingat-id",
  requiredCc: [],
  ccRoles: { mid: false, top: false, buyer: false },
  attachments: { pdf: true, xlsx: true },
  statusScope: "action",
  maxPartsInBody: 25
};

const text = (v: unknown, max: number) => String(v ?? "").replace(/\r\n/g, "\n").slice(0, max);

/** Accepts whatever the browser sent and returns a safe, complete configuration. Unknown keys are dropped. */
export function sanitizeConfig(input: unknown): FollowupConfig {
  const src = (input && typeof input === "object" ? input : {}) as Partial<Record<keyof FollowupConfig, unknown>>;
  const seen = new Set<string>();
  const templates: Template[] = [];
  for (const t of Array.isArray(src.templates) ? src.templates.slice(0, 30) : []) {
    const o = (t && typeof t === "object" ? t : {}) as Record<string, unknown>;
    const id = text(o.id, 60).replace(/[^a-zA-Z0-9_-]/g, "") || `t${templates.length + 1}`;
    const name = text(o.name, 80).trim();
    const subject = text(o.subject, 240).trim();
    const body = text(o.body, 8000).trim();
    if (!name || !subject || !body || seen.has(id)) continue;
    seen.add(id); templates.push({ id, name, subject, body });
  }
  if (!templates.length) templates.push(...DEFAULT_CONFIG.templates);
  const defaultTemplateId = templates.some((t) => t.id === src.defaultTemplateId) ? String(src.defaultTemplateId) : templates[0].id;
  const roles = (src.ccRoles && typeof src.ccRoles === "object" ? src.ccRoles : {}) as Record<string, unknown>;
  const att = (src.attachments && typeof src.attachments === "object" ? src.attachments : {}) as Record<string, unknown>;
  const max = Number(src.maxPartsInBody);
  return {
    templates, defaultTemplateId,
    requiredCc: [...new Set(emailsOf(Array.isArray(src.requiredCc) ? src.requiredCc.join(";") : String(src.requiredCc ?? "")))].slice(0, 20),
    ccRoles: { mid: roles.mid === true, top: roles.top === true, buyer: roles.buyer === true },
    attachments: { pdf: att.pdf !== false, xlsx: att.xlsx !== false },
    statusScope: src.statusScope === "all" ? "all" : "action",
    maxPartsInBody: Number.isFinite(max) ? Math.max(0, Math.min(100, Math.round(max))) : DEFAULT_CONFIG.maxPartsInBody
  };
}

export function renderTemplate(template: string, ctx: Record<string, string | number>): string {
  return template.replace(/\{(supplier|code|count|models|partlist|sender|date)\}/g, (_m, k: string) => String(ctx[k] ?? ""));
}

const norm = (s: unknown) => String(s ?? "").trim().toUpperCase();
/** Decided by people; never chased automatically. */
const PROTECTED = new Set(["DEAD (NEW SMS)", "NOT TO BE COLLECTED"]);

export function isOutstanding(status: unknown, scope: "action" | "all"): boolean {
  const s = norm(status);
  if (PROTECTED.has(s) || /^ACCEPTED$|APPROVED|COMPLETE|CLEARED/.test(s)) return false;
  if (scope === "all") return true;
  // The supplier must act when nothing was submitted or TMMIN rejected it. TMMIN WORKING means the ball is on TMMIN's side.
  return !s || /REJECT|NOT\s*(YET\s*)?SUBMIT|NOT\s*YET|PENDING|OUTSTANDING/.test(s) || !/WORKING|IN\s*PROCESS|SUBMITTED/.test(s);
}

export type PartLike = { project?: string | null; part_no?: string | null; part_name?: string | null; imds_status?: string | null; submission_plan?: string | null };

export function selectParts<T extends PartLike>(parts: T[], scope: "action" | "all", models: string[]): T[] {
  const want = new Set(models.map(norm).filter(Boolean));
  return parts.filter((p) => isOutstanding(p.imds_status, scope) && (!want.size || want.has(norm(p.project))));
}

export function partListText(parts: PartLike[], max: number): string {
  const shown = parts.slice(0, Math.max(0, max));
  const lines = shown.map((p, i) => `${i + 1}. ${p.project || "-"} | ${p.part_no || "-"} | ${p.part_name || "-"} | ${p.imds_status || "NOT SUBMITTED"}`);
  if (parts.length > shown.length) lines.push(`... dan ${parts.length - shown.length} part lainnya (lihat lampiran) / and ${parts.length - shown.length} more (see attachment)`);
  return lines.join("\n");
}

export type DirectoryEmails = { pic: string[]; mid: string[]; top: string[]; buyer: string[] };
type DirEntry = { name?: string; code?: string; f?: Record<string, string> };
export const dirNameKey = (s: unknown) => String(s ?? "").toUpperCase().replace(/&/g, " AND ").replace(/[^A-Z0-9]+/g, " ").trim().split(" ").filter((w) => w && w !== "PT" && w !== "CV" && w !== "TBK").join(" ");
const codeKey = (c: unknown) => String(c ?? "").trim().toUpperCase().replace(/\.0$/, "");

/** Contacts for a supplier from the Tracker Directory blob. Matches by vendor code first, then by normalized name. */
export function directoryEmails(directory: unknown, supplierCode: string, supplierName: string): DirectoryEmails {
  const empty: DirectoryEmails = { pic: [], mid: [], top: [], buyer: [] };
  const d = (directory && typeof directory === "object" ? directory : {}) as { entries?: Record<string, DirEntry>; buyers?: Record<string, { email?: string }> };
  const entries = Object.entries(d.entries || {});
  const code = codeKey(supplierCode), nk = dirNameKey(supplierName);
  const hit = entries.find(([, e]) => code && codeKey(e.code) === code) || entries.find(([k, e]) => dirNameKey(e.name || k) === nk && nk);
  if (!hit) return empty;
  const f = hit[1].f || {};
  const pick = (keys: string[]) => [...new Set(keys.flatMap((k) => emailsOf(f[k] || "")))];
  const buyerKey = f.buyer ? Object.keys(d.buyers || {}).find((s) => s.toLowerCase() === String(f.buyer).toLowerCase()) : undefined;
  return {
    pic: pick(["pic1_email", "pic2_email", "pic3_email", "pic_extra"]),
    mid: pick(["staff_email", "spv_email", "dph_email", "gm_email"]),
    top: pick(["md_email", "vp_email", "pd_email"]),
    buyer: buyerKey ? emailsOf(d.buyers?.[buyerKey]?.email || "") : []
  };
}

export type CcInput = { to: string[]; supplierCc: string[]; directory: DirectoryEmails; config: FollowupConfig; roles: { mid: boolean; top: boolean; buyer: boolean }; extra: string[] };
/** Required CC is always included. Role CC follows the batch choice. Nothing in `to` is repeated on CC. */
export function resolveCc(i: CcInput): { cc: string[]; required: string[] } {
  const required = i.config.requiredCc;
  const roleCc = [...(i.roles.mid ? i.directory.mid : []), ...(i.roles.top ? i.directory.top : []), ...(i.roles.buyer ? i.directory.buyer : [])];
  const seen = new Set(i.to.map((e) => e.toLowerCase()));
  const cc: string[] = [];
  for (const e of [...required, ...i.supplierCc, ...roleCc, ...emailsOf(i.extra.join(";"))]) { const k = e.toLowerCase(); if (!seen.has(k)) { seen.add(k); cc.push(e); } }
  return { cc, required };
}
