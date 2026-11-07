import { NextResponse } from "next/server";
import { internalContext } from "@/lib/automation/auth";
import { flowConfig, transportFor } from "@/lib/automation/flow";
export async function GET() {
  const ctx = await internalContext();
  if ("error" in ctx) return ctx.error;
  const cfg = flowConfig();
  const { data } = await ctx.supabase.from("sync_outbox").select("id,kind,status,last_error,updated_at,attempts,item_id").neq("status", "SENT").order("updated_at", { ascending: false }).limit(500);
  const counts: Record<string, number> = {};
  for (const r of data || []) counts[`${r.kind}:${r.status}`] = (counts[`${r.kind}:${r.status}`] || 0) + 1;
  const lastError = (data || []).find((r) => r.last_error)?.last_error ?? null;
  const failed = (data || []).filter((r) => r.status === "FAILED").slice(0, 8).map((r) => ({ id: r.id, kind: r.kind, error: r.last_error, attempts: r.attempts, at: r.updated_at }));
  return NextResponse.json({ failed, configured: { excel: !!transportFor("EXCEL_UPSERT", cfg), email: !!transportFor("SUPPLIER_EMAIL", cfg), secret: !!cfg.secret }, transport: { excel: transportFor("EXCEL_UPSERT", cfg), email: transportFor("SUPPLIER_EMAIL", cfg) }, counts, lastError });
}
