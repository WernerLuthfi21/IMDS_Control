import { NextResponse } from "next/server";
import { internalContext } from "@/lib/automation/auth";
import { flowConfig } from "@/lib/automation/flow";
export async function GET() {
  const ctx = await internalContext();
  if ("error" in ctx) return ctx.error;
  const cfg = flowConfig();
  const { data } = await ctx.supabase.from("sync_outbox").select("kind,status,last_error,updated_at").neq("status", "SENT").order("updated_at", { ascending: false }).limit(500);
  const counts: Record<string, number> = {};
  for (const r of data || []) counts[`${r.kind}:${r.status}`] = (counts[`${r.kind}:${r.status}`] || 0) + 1;
  const lastError = (data || []).find((r) => r.last_error)?.last_error ?? null;
  return NextResponse.json({ configured: { excel: !!cfg.excelUrl, email: !!cfg.emailUrl, secret: !!cfg.secret }, counts, lastError });
}
