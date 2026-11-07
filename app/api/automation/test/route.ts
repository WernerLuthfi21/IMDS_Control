import { NextRequest, NextResponse } from "next/server";
import { internalContext } from "@/lib/automation/auth";
import { buildTestPayload, deliver, flowConfig, transportFor } from "@/lib/automation/flow";
import { sameOrigin } from "@/lib/security/request";
export const maxDuration = 60;

/** Connection test. Excel: upserts the fixed row IMDS-PING. E-mail: sends one message to the signed-in user's OWN address only. */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request.headers)) return NextResponse.json({ error: "Request rejected." }, { status: 403 });
  const ctx = await internalContext();
  if ("error" in ctx) return ctx.error;
  if (!["admin", "preparer"].includes(ctx.profile.role)) return NextResponse.json({ error: "Preparer or admin role required." }, { status: 403 });
  const body = await request.json().catch(() => null) as { target?: string } | null;
  const cfg = flowConfig();
  const target = body?.target === "email" ? "SUPPLIER_EMAIL" : body?.target === "excel" ? "EXCEL_UPSERT" : null;
  if (!target) return NextResponse.json({ error: "target must be excel or email." }, { status: 400 });
  const transport = transportFor(target, cfg);
  if (!transport) return NextResponse.json({ ok: false, transport: null, hint: "Nothing is configured for this flow yet (see the checklist)." });
  if (target === "SUPPLIER_EMAIL" && !ctx.user.email) return NextResponse.json({ ok: false, transport, hint: "Your account has no email address." });
  const payload = target === "EXCEL_UPSERT" ? buildTestPayload()
    : { type: "supplier_email", followupId: "test", to: ctx.user.email || "", cc: "", subject: "IMDS connection test", body: "This is a test from the IMDS workspace. If you can read this, the supplier e-mail flow works." };
  const r = await deliver(target, cfg, payload);
  await ctx.supabase.from("audit_events").insert({ actor_id: ctx.user.id, action: "AUTOMATION_TEST_" + target, entity_type: "automation", entity_id: null, metadata: { transport, ok: r.ok } });
  const hint = !r.ok ? (r.error || "Failed.") : transport === "mail"
    ? "Handed to the mailbox (SMTP accepted). Check the flow's Run history, then " + (target === "EXCEL_UPSERT" ? "look for row IMDS-PING in the Excel table." : "check your inbox.")
    : "The flow accepted it (HTTP " + r.status + "). " + (target === "EXCEL_UPSERT" ? "Look for row IMDS-PING in the Excel table." : "Check your inbox.");
  return NextResponse.json({ ok: r.ok, transport, hint });
}
