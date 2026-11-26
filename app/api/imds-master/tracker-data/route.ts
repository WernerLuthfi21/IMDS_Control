import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { canAccessImdsTracker } from "@/lib/security/imds-tracker";

export const dynamic = "force-dynamic";

const COLUMNS = "id,project,vendor_code,main_pic_email,company_name,part_name,part_no,submission_plan,supplier_promise_date,imds_status,part_status,status_update,md_id_version,md_status_update_date,comment,md_system_records,source_row,updated_at";
const PAGE = 500;

export async function GET(request: Request) {
  const auth = await getAuthContext();
  if (!auth.configured) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  if (!auth.userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!canAccessImdsTracker(auth.role)) return NextResponse.json({ error: "Internal workspace access required." }, { status: 403 });

  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });

  // Cheap version check first: if nothing changed since the browser's copy, answer 304 and skip the heavy read.
  const [{ count, error: countError }, { data: newest, error: newestError }, { count: contactCount, error: contactCountError }, { data: newestContact, error: newestContactError }] = await Promise.all([
    supabase.from("imds_master_parts").select("id", { count: "exact", head: true }),
    supabase.from("imds_master_parts").select("updated_at").order("updated_at", { ascending: false }).limit(1),
    supabase.from("supplier_contacts").select("id", { count: "exact", head: true }).eq("active", true),
    supabase.from("supplier_contacts").select("updated_at").order("updated_at", { ascending: false }).limit(1)
  ]);
  if (countError || newestError || contactCountError || newestContactError) return NextResponse.json({ error: "Shared master or contact metadata unavailable." }, { status: 503 });
  const etag = `W/"${count ?? 0}-${newest?.[0]?.updated_at ?? "none"}-${contactCount ?? 0}-${newestContact?.[0]?.updated_at ?? "none"}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag, "Cache-Control": "private, no-cache" } });
  }

  // Read all pages in parallel instead of one after another.
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));
  const results = await Promise.all(Array.from({ length: pages }, (_, i) => supabase.from("imds_master_parts")
    .select(COLUMNS)
    .order("project", { ascending: true, nullsFirst: true })
    .order("company_name", { ascending: true, nullsFirst: true })
    .order("part_no", { ascending: true, nullsFirst: true })
    .order("id", { ascending: true })
    .range(i * PAGE, i * PAGE + PAGE - 1)));
  const failed = results.find((r) => r.error);
  if (failed?.error) return NextResponse.json({ error: failed.error.message }, { status: 500 });
  const parts = results.flatMap((r) => (r.data || []) as unknown as Record<string, unknown>[]);

  const { data: contactRows, error: contactError } = await supabase.from("supplier_contacts")
    .select("supplier_code,supplier_name,email,contact_role,active")
    .eq("active", true)
    .limit(5000);
  if (contactError) return NextResponse.json({ error: "Supplier contacts unavailable." }, { status: 503 });
  if ((contactCount ?? 0) > 5000 || parts.length !== (count ?? 0)) return NextResponse.json({ error: "Shared data is incomplete; refresh or contact an administrator." }, { status: 503 });

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
  }, { headers: { "Cache-Control": "private, no-cache", ETag: etag } });
}
