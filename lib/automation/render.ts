// Client-safe (no Node imports): used by the browser preview and the server.
import emailTemplates from "@/data/followup-templates.json";

export function renderFollowup(opts: { errorType: string; supplierName?: string | null; supplierCode: string; partNo: string }) {
  const greeting = opts.supplierName ? `Dear ${opts.supplierName} team,` : "Dear Supplier,";
  const n = opts.errorType.toLowerCase();
  const list = emailTemplates.templates;
  const body = (list.find((t) => t.labels.some((l) => n.includes(l))) || list[list.length - 1]).body
    .replaceAll("{{greeting}}", greeting).replaceAll("{{supplierCode}}", opts.supplierCode).replaceAll("{{partNo}}", opts.partNo).replaceAll("{{errorType}}", opts.errorType);
  return { subject: `IMDS confirmation required · ${opts.partNo} · ${opts.errorType}`, body };
}
