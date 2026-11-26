import { classifyStatus, modelKey, supDueKey, type Bucket, type DueDates } from "@/lib/followup/render";

export type WorkbenchPart = { id: string; company_name?: string | null; vendor_code?: string | null; project?: string | null; part_no?: string | null; imds_status?: string | null; submission_plan?: string | null; supplier_promise_date?: string | null; main_pic_email?: string | null };
import type { WorkbenchRow } from "./workbench-metrics";
const norm = (v: unknown) => String(v ?? "").trim();
export function dateOnly(v: unknown): string | null {
  const s = norm(v).slice(0,10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s+"T00:00:00Z");
  return Number.isFinite(+d) && d.toISOString().slice(0,10)===s ? s : null;
}
export function toWorkbenchRows(parts: WorkbenchPart[], due: DueDates, today: string): WorkbenchRow[] {
  return parts.map(p=>{
    const supplier=norm(p.company_name)||"Unassigned supplier", code=norm(p.vendor_code).toUpperCase(), model=modelKey(p.project);
    const status=classifyStatus(p.imds_status), open=status==="missing"||status==="rejected";
    const deadline=dateOnly(due.suppliers?.[supDueKey(supplier,model)])||dateOnly(due.models?.[model])||dateOnly(p.submission_plan);
    const promise=dateOnly(p.supplier_promise_date);
    return {id:p.id,supplier,supplierKey:code?"code:"+code:"name:"+supplier.toUpperCase(),model,part:norm(p.part_no),status,deadline,promise,overdue:open&&!!deadline&&deadline<today,missedPromise:open&&!!promise&&promise<today,contact:/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(norm(p.main_pic_email))};
  });
}
export function communicationState(status: unknown, response: unknown): string {
  const s=norm(status).toUpperCase(), p=response&&typeof response==="object"?response as Record<string,unknown>:{};
  if(p.handedOff===true||p.httpStatus===202||s==="HANDED_OFF")return "HANDED_OFF";
  if(s==="SENT")return "LEGACY_SENT_UNVERIFIED";
  if(s==="FAILED"&&p.httpStatus===0)return "UNKNOWN";
  return s||"UNKNOWN";
}
