import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { canAccessImdsTracker } from "@/lib/security/imds-tracker";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await getAuthContext();
  if (!auth.configured) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  if (!auth.userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!canAccessImdsTracker(auth.role)) return NextResponse.json({ error: "Internal workspace access required." }, { status: 403 });

  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });

  const parts: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await supabase.from("imds_master_parts")
      .select("project,vendor_code,main_pic_email,company_name,part_name,part_no,submission_plan,imds_status,part_status,source_row")
      .order("project", { ascending: true, nullsFirst: true })
      .order("company_name", { ascending: true, nullsFirst: true })
      .order("part_no", { ascending: true, nullsFirst: true })
      .range(from, from + 499);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    parts.push(...(data || []) as Record<string, unknown>[]);
    if (!data || data.length < 500) break;
  }

  const { data: contactRows } = await supabase.from("supplier_contacts")
    .select("supplier_code,supplier_name,email,contact_role,active")
    .eq("active", true)
    .limit(5000);

  const contacts = new Map<string, { company: string; pic: string; cc: string[]; spv: string[]; note: string }>();
  const ensure = (company: string) => {
    const key = company.trim().toUpperCase();
    let item = contacts.get(key);
    if (!item) {
      item = { company, pic: "", cc: [], spv: [], note: "" };
      contacts.set(key, item);
    }
    return item;
  };

  for (const row of parts) {
    const company = String(row.company_name || "").trim();
    if (!company) continue;
    const item = ensure(company);
    const email = String(row.main_pic_email || "").trim();
    if (!item.pic && email && email !== "0") item.pic = email;
  }

  for (const row of contactRows || []) {
    const company = String(row.supplier_name || "").trim();
    const email = String(row.email || "").trim();
    if (!company || !email || email === "0") continue;
    const item = ensure(company);
    const role = String(row.contact_role || "").toUpperCase();
    if (role === "PIC" && !item.pic) item.pic = email;
    else if (role.includes("SPV")) item.spv.push(email);
    else if (role.includes("CC") || role.includes("MARKETING")) item.cc.push(email);
  }

  const contactList = [...contacts.values()].map((item) => ({
    company: item.company,
    pic: item.pic,
    cc: [...new Set(item.cc)].join("; "),
    spv: [...new Set(item.spv)].join("; "),
    note: item.note
  }));

  return NextResponse.json({
    rows: parts,
    contacts: contactList,
    total: parts.length,
    refreshedAt: new Date().toISOString()
  }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
