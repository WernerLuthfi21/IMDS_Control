import type { SupabaseClient } from "@supabase/supabase-js";
import { sendMail } from "@/lib/notify/mailer";

const LABEL: Record<string, string> = { supplier: "Supplier access", tmmin: "TMMIN staff access", password_help: "Password help" };

/** Tells the approval PICs a request is waiting. The e-mail has NO approve link: approval happens signed-in on the website. */
export async function notifyApprovers(admin: SupabaseClient, req: { id: string; kind: string; full_name: string; email: string; company?: string | null; supplier_code?: string | null; via: string }, origin: string) {
  const { data: pics } = await admin.from("approval_recipients").select("email").eq("active", true);
  let to = (pics || []).map((p) => p.email as string);
  if (!to.length) { const { data: admins } = await admin.from("profiles").select("email").eq("role", "admin"); to = (admins || []).map((a) => a.email as string).filter(Boolean); }
  const text = [
    `New request waiting for approval: ${LABEL[req.kind] || req.kind}`,
    `Name: ${req.full_name}`, `Email: ${req.email}`, req.company ? `Company: ${req.company}` : "", req.supplier_code ? `Supplier code: ${req.supplier_code}` : "",
    `Submitted by: ${req.via === "STAFF" ? "TMMIN staff" : "the requester"}`, "",
    `Review and approve (sign in required): ${origin}/settings#access`, "", "This message cannot approve anything. Do not forward it."
  ].filter(Boolean).join("\n");
  const r = await sendMail(to, `[IMDS] Access request: ${req.full_name}`, text);
  await admin.from("access_requests").update({ notification_status: r.status }).eq("id", req.id);
  return r;
}
