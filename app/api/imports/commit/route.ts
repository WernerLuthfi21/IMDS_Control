import { NextRequest, NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dispatch } from "@/lib/automation/outbox";
import { flowConfig, transportFor } from "@/lib/automation/flow";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const body = await request.json().catch(() => null) as { batchId?: string } | null;
  if (!body?.batchId || !/^[0-9a-f-]{36}$/i.test(body.batchId)) return NextResponse.json({ error: "A valid batchId is required." }, { status: 400 });
  const { data, error } = await supabase.rpc("commit_import_batch", { p_batch_id: body.batchId });
  if (error) return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });

  // Every row of this snapshot goes on the JudgementRegister queue, so the Excel master sheet also lists the rows
  // that TMA has not judged yet (blank Judge). Power Automate upserts them by `code`; judged values are not touched here.
  const excelReady = !!transportFor("EXCEL_UPSERT", flowConfig());
  let registerQueued = 0, registerError: string | null = null;
  const { data: items, error: itemsError } = await supabase.from("gcat_error_items").select("id").eq("source_batch_id", body.batchId)
    // Oldest first (code = Download Date + No.), so the register gets new rows at the bottom in the master's order,
    // even when a G-CATS export lists the newest day at the top.
    .order("source_record_key", { ascending: true }).limit(20000);
  if (itemsError) registerError = itemsError.message;
  else {
    // The queue is sent in created_at order; one millisecond apart keeps the oldest-first order inside a batch insert.
    const t0 = Date.now();
    const rows = (items || []).map((i, n) => ({ kind: "EXCEL_UPSERT", item_id: i.id as string, created_by: auth.user!.id, created_at: new Date(t0 + n).toISOString() }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error: qError } = await supabase.from("sync_outbox").insert(rows.slice(i, i + 500));
      if (qError) { registerError = qError.message; break; }
      registerQueued += Math.min(500, rows.length - i);
    }
    if (registerQueued && excelReady) after(async () => { try { await dispatch(supabase, { kind: "EXCEL_UPSERT", limit: 300 }); } catch { /* jobs stay queued and are retried */ } });
  }
  return NextResponse.json({
    batch: data,
    casesCreated: Number((data as { casesProcessed?: number })?.casesProcessed || 0),
    itemsCreated: Number((data as { itemsProcessed?: number })?.itemsProcessed || 0),
    register: { queued: registerQueued, flowConfigured: excelReady, error: registerError },
  });
}
