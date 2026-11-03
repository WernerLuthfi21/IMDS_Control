import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const body = await request.json().catch(() => null) as { batchId?: string } | null;
  if (!body?.batchId || !/^[0-9a-f-]{36}$/i.test(body.batchId)) return NextResponse.json({ error: "A valid batchId is required." }, { status: 400 });
  const { data, error } = await supabase.rpc("commit_import_batch", { p_batch_id: body.batchId });
  if (error) return NextResponse.json({ error: error.message }, { status: 409 });
  return NextResponse.json({ batch: data, casesCreated: Number((data as { casesProcessed?: number })?.casesProcessed || 0), itemsCreated: Number((data as { itemsProcessed?: number })?.itemsProcessed || 0) });
}
