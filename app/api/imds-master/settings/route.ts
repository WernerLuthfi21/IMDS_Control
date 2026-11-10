import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { canAccessImdsTracker } from "@/lib/security/imds-tracker";
import { DEFAULT_CONFIG, sanitizeConfig } from "@/lib/followup/center";

export const runtime = "nodejs";
const KEYS = ["directory", "followup_config"] as const;
type Key = (typeof KEYS)[number];
const MAX_BYTES: Record<Key, number> = { directory: 3_000_000, followup_config: 200_000 };

/** Versioned settings shared by everyone who uses the Tracker. GET ?key=… ; PUT {key,value,baseVersion}. */
export async function GET(request: NextRequest) {
  const auth = await getAuthContext();
  if (!auth.configured) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  if (!auth.userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!canAccessImdsTracker(auth.role)) return NextResponse.json({ error: "Internal workspace access required." }, { status: 403 });
  const key = request.nextUrl.searchParams.get("key") as Key | null;
  if (!key || !KEYS.includes(key)) return NextResponse.json({ error: "Unknown settings key." }, { status: 400 });
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const { data, error } = await supabase.from("imds_tracker_settings").select("value,version,updated_at").eq("key", key).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const value = key === "followup_config" ? sanitizeConfig(data?.value ?? DEFAULT_CONFIG) : (data?.value ?? null);
  return NextResponse.json({ exists: Boolean(data), value, version: data?.version ?? 0, updatedAt: data?.updated_at ?? null }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PUT(request: NextRequest) {
  const auth = await getAuthContext();
  if (!auth.configured) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  if (!auth.userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const body = await request.json().catch(() => null) as { key?: Key; value?: unknown; baseVersion?: number } | null;
  if (!body?.key || !KEYS.includes(body.key)) return NextResponse.json({ error: "Unknown settings key." }, { status: 400 });
  const allowed = body.key === "followup_config" ? ["admin", "preparer"] : ["admin", "preparer", "reviewer"];
  if (!allowed.includes(auth.role || "")) return NextResponse.json({ error: body.key === "followup_config" ? "Admin or preparer role is required to change follow-up settings." : "Admin, preparer or reviewer role is required to edit the directory." }, { status: 403 });
  const value = body.key === "followup_config" ? sanitizeConfig(body.value) : body.value;
  if (!value || typeof value !== "object") return NextResponse.json({ error: "A settings object is required." }, { status: 400 });
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_BYTES[body.key]) return NextResponse.json({ error: "Settings are too large." }, { status: 413 });
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });

  const base = Number(body.baseVersion || 0);
  if (base === 0) {
    const { error } = await supabase.from("imds_tracker_settings").insert({ key: body.key, value, version: 1, updated_by: auth.userId });
    if (error) {
      if (/duplicate|unique/i.test(error.message)) return NextResponse.json({ error: "Someone else saved first. Reload to see their version.", conflict: true }, { status: 409 });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, version: 1 });
  }
  const { data, error } = await supabase.from("imds_tracker_settings")
    .update({ value, version: base + 1, updated_by: auth.userId, updated_at: new Date().toISOString() })
    .eq("key", body.key).eq("version", base).select("version");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "Someone else saved a newer version. Reload to see it.", conflict: true }, { status: 409 });
  return NextResponse.json({ ok: true, version: base + 1 });
}
