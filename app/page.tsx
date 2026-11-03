import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import historical from "@/data/source-derived/historical-error-distribution.json";
import { ArrowRight, CalendarClock, FileUp, Inbox, ListChecks, RefreshCw, Users } from "lucide-react";
import { RegisterTable } from "@/components/register-table";

export const dynamic = "force-dynamic";

export default async function JudgementRegisterPage({ searchParams }: { searchParams: Promise<{ q?: string; errorType?: string; p?: string }> }) {
  const { q = "", errorType = "", p = "1" } = await searchParams;
  const pageNumber = Math.max(1, Number.parseInt(p, 10) || 1);
  const pageSize = 100;
  const supabase = await createClient();
  let rows: any[] = [];
  let total = 0;
  let filteredTotal = 0;
  let pending = 0;
  let kmPending = 0;
  let dbMessage = "Connect the database and import the latest G-CATS Error Check Log to show live records.";

  if (supabase) {
    const { data: auth } = await supabase.auth.getUser();
    if (auth.user) { const { data: profile } = await supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle(); if (profile?.role === "supplier") redirect("/supplier-precheck"); }
    let itemQuery = supabase.from("gcat_error_items").select("id,source_record_key,error_type_label,delivery_part_no,supplier_code,judge,km_judge,source_judge_label,source_km_judge_label,assigned_person,starting_date,last_change_date,case_id", { count: "exact" }).order("last_change_date", { ascending: false, nullsFirst: true });
    if (errorType) itemQuery = itemQuery.eq("error_type_label", errorType);
    const safeTerm = q.trim().replace(/[,%()_*]/g, " ").replace(/\s+/g, " ").slice(0, 100);
    if (safeTerm) { const like = `%${safeTerm}%`; itemQuery = itemQuery.or(`source_record_key.ilike.${like},delivery_part_no.ilike.${like},supplier_code.ilike.${like},error_type_label.ilike.${like},assigned_person.ilike.${like}`); }
    const [countResult, pendingResult, kmResult, itemResult] = await Promise.all([
      supabase.from("gcat_error_items").select("id", { count: "exact", head: true }),
      supabase.from("gcat_error_items").select("id", { count: "exact", head: true }).is("judge", null),
      supabase.from("gcat_error_items").select("id", { count: "exact", head: true }).eq("judge", "OK").is("km_judge", null),
      itemQuery.range((pageNumber - 1) * pageSize, pageNumber * pageSize - 1)
    ]);
    total = countResult.count ?? 0;
    pending = pendingResult.count ?? 0;
    kmPending = kmResult.count ?? 0;
    rows = itemResult.data ?? [];
    filteredTotal = itemResult.count ?? 0;
    dbMessage = itemResult.error ? `Database query: ${itemResult.error.message}` : "Live operational register";
  }

  const filtered = rows;
  const topTypes = Object.entries(historical.types).sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 5);
  const typeOptions = [...new Set([...Object.keys(historical.types), ...rows.map((r) => r.error_type_label).filter(Boolean)])].sort();
  const pageCount = Math.max(1, Math.ceil(filteredTotal / pageSize));
  const pageHref = (page: number) => { const params = new URLSearchParams(); if (q) params.set("q", q); if (errorType) params.set("errorType", errorType); params.set("p", String(page)); return `/?${params.toString()}`; };

  return <div className="register-page">
    <div className="page-heading">
      <div>
        <div className="eyebrow">OPERATIONS / G-CATS</div>
        <h1 className="page-title">Judgement Register</h1>
        <p className="page-subtitle">One place to assign, judge, document, follow up and review each G-CATS error.</p>
      </div>
      <div className="heading-actions">
        <a className="btn" href="/api/register/export"><FileUp size={15}/> Export Excel</a>
        <Link className="btn" href="/daily-update"><RefreshCw size={15}/> Daily update</Link>
        <Link className="btn btn-primary" href="/supplier-precheck"><Inbox size={15}/> Supplier pre-check</Link>
      </div>
    </div>

    <div className="register-kpis">
      <div className="register-kpi"><span>Records in register</span><strong>{supabase ? total.toLocaleString("en-US") : "—"}</strong><small>{supabase ? "Current database records" : "Waiting for first import"}</small></div>
      <div className="register-kpi"><span>Need judgement</span><strong className="tone-amber">{supabase ? pending.toLocaleString("en-US") : "—"}</strong><small>Judge (OK/NG) is blank</small></div>
      <div className="register-kpi"><span>Need KM review</span><strong className="tone-blue">{supabase ? kmPending.toLocaleString("en-US") : "—"}</strong><small>Judged OK, KM review pending</small></div>
      <div className="register-kpi"><span>Historical workload</span><strong>{historical.data_rows.toLocaleString("en-US")}</strong><small>Master workbook snapshot · not live</small></div>
    </div>

    <section className="register-panel">
      <div className="register-panel-head">
        <div><h2>Working register</h2><p>{dbMessage} · {filteredTotal.toLocaleString("en-US")} matching records</p></div>
        <span className="quiet-badge">AO–AW · 9 judgement fields</span>
      </div>
      <form className="register-filters" action="/">
        <input name="q" defaultValue={q} placeholder="Search part number, supplier, error type, owner or source code…" aria-label="Search register"/>
        <select name="errorType" defaultValue={errorType} aria-label="Filter by error type">
          <option value="">All Error Types</option>
          {typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button className="btn" type="submit">Filter</button>
        {(q || errorType) && <Link className="text-link" href="/">Clear</Link>}
      </form>
      {rows.length ? <><RegisterTable rows={filtered}/><div className="register-pagination"><span>Showing {filtered.length ? ((pageNumber-1)*pageSize+1).toLocaleString("en-US") : 0}–{Math.min(pageNumber*pageSize,filteredTotal).toLocaleString("en-US")} of {filteredTotal.toLocaleString("en-US")}</span><div>{pageNumber>1&&<Link className="btn btn-sm" href={pageHref(pageNumber-1)}>Previous</Link>}<span>Page {pageNumber} / {pageCount}</span>{pageNumber<pageCount&&<Link className="btn btn-sm" href={pageHref(pageNumber+1)}>Next</Link>}</div></div></> : <div className="register-empty">
        <div className="empty-icon"><ListChecks size={22}/></div>
        <h3>{supabase ? "No G-CATS records imported yet" : "Register is ready for the first daily update"}</h3>
        <p>Import the G-CATS Error Check Log workbook. The importer keeps the original source code, sheet, row and Error Type label, then fills the register with any existing AO–AW judgement values.</p>
        <Link className="btn btn-primary" href="/daily-update"><FileUp size={15}/> Import G-CATS workbook</Link>
      </div>}
    </section>

    <div className="register-bottom-grid">
      <section className="simple-card"><div className="simple-card-head"><div><h2>Most repeated historical errors</h2><p>Use these trends to prioritize reusable work procedures.</p></div><span className="quiet-badge">HISTORICAL</span></div>
        {topTypes.map(([name, count]) => <div className="trend-row" key={name}><span>{name}</span><strong>{Number(count).toLocaleString("en-US")}</strong></div>)}
      </section>
      <section className="simple-card"><div className="simple-card-head"><div><h2>Shortcuts</h2><p>Keep the daily workflow short.</p></div></div>
        <Link className="shortcut-row" href="/daily-update"><span className="shortcut-icon"><CalendarClock size={16}/></span><span><strong>Import today's G-CATS file</strong><small>Refresh, compare, preview and commit</small></span><ArrowRight size={15}/></Link>
        <Link className="shortcut-row" href="/follow-up"><span className="shortcut-icon"><Users size={16}/></span><span><strong>Supplier follow-up</strong><small>Prepare an Outlook message from a case</small></span><ArrowRight size={15}/></Link>
        <Link className="shortcut-row" href="/supplier-precheck"><span className="shortcut-icon"><Inbox size={16}/></span><span><strong>Supplier-side pre-check</strong><small>Check before submitting to IMDS</small></span><ArrowRight size={15}/></Link>
      </section>
    </div>
  </div>;
}
