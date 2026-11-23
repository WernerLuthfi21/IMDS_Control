import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { canAccessImdsTracker } from "@/lib/security/imds-tracker";
import { EXEC_SUMMARY_ID, EXEC_SUMMARY_NAME, LIBRARY_MAX_FILE, LIBRARY_MAX_FILES, execSummary, listLibrary, safeName, sanitizeLibrary, type LibraryFile } from "@/lib/followup/library";

export const runtime = "nodejs";
const HINT = "The file library needs a one-time database update: run supabase/migrations/20261123010000_tracker_attachment_library.sql in the Supabase SQL editor.";
type Db = NonNullable<Awaited<ReturnType<typeof createClient>>>;

async function read(db: Db) {
  const { data, error } = await db.from("imds_tracker_settings").select("value,version").eq("key", "attachment_library").maybeSingle();
  if (error) throw new Error(error.message);
  return { lib: sanitizeLibrary(data?.value), version: Number(data?.version || 0) };
}
async function write(db: Db, userId: string, files: LibraryFile[], version: number) {
  const value = { files };
  if (!version) {
    const { error } = await db.from("imds_tracker_settings").insert({ key: "attachment_library", value, version: 1, updated_by: userId });
    if (error) throw new Error(/check constraint|violates/i.test(error.message) ? HINT : /duplicate|unique/i.test(error.message) ? "Someone else changed the library at the same moment. Try again." : error.message);
    return;
  }
  const { data, error } = await db.from("imds_tracker_settings").update({ value, version: version + 1, updated_by: userId, updated_at: new Date().toISOString() }).eq("key", "attachment_library").eq("version", version).select("version");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("Someone else changed the library at the same moment. Try again.");
}

/** GET: the list (names, sizes). GET ?id=…: the file itself (download, unchanged). */
export async function GET(request: NextRequest) {
  const auth = await getAuthContext();
  if (!auth.userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!canAccessImdsTracker(auth.role)) return NextResponse.json({ error: "Internal workspace access required." }, { status: 403 });
  const db = await createClient(); if (!db) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  try {
    const { lib } = await read(db), id = request.nextUrl.searchParams.get("id");
    if (id) {
      const f = lib.files.find((x) => x.id === id);
      if (!f) return NextResponse.json({ error: "File not found." }, { status: 404 });
      return new NextResponse(new Uint8Array(Buffer.from(f.base64, "base64")), { headers: { "Content-Type": f.contentType, "Content-Disposition": `attachment; filename="${f.name}"`, "Cache-Control": "private, no-store" } });
    }
    const ex = execSummary(lib, new Date());
    return NextResponse.json({ files: listLibrary(lib), canEdit: ["admin", "preparer"].includes(auth.role || ""), canPublishSummary: ["admin", "preparer", "reviewer"].includes(auth.role || ""), maxBytes: LIBRARY_MAX_FILE,
      execSummary: ex ? { at: ex.at, by: ex.by, size: ex.size, ageH: ex.ageH } : null }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) { return NextResponse.json({ files: [], error: e instanceof Error ? e.message : String(e) }, { status: 200 }); }
}

/**
 * POST {name, contentType, base64, note?, replaceId?}: add a file (or replace one, keeping its id). Admin / preparer.
 * POST {action:"exec-summary", base64}: the Tracker saves its own Executive summary PDF (the same PDF as the button)
 * for summary e-mails of the automations. Admin / preparer / reviewer.
 */
export async function POST(request: NextRequest) {
  const auth = await getAuthContext();
  if (!auth.userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const body = await request.json().catch(() => null) as { action?: string; name?: string; contentType?: string; base64?: string; note?: string; replaceId?: string } | null;
  if (body?.action === "exec-summary") {
    if (!["admin", "preparer", "reviewer"].includes(auth.role || "")) return NextResponse.json({ error: "Preparer, reviewer or admin role is required." }, { status: 403 });
    const bytes = Buffer.from(String(body.base64 || ""), "base64");
    if (bytes.length < 200 || bytes.subarray(0, 4).toString("latin1") !== "%PDF") return NextResponse.json({ error: "Not a PDF." }, { status: 422 });
    if (bytes.length > LIBRARY_MAX_FILE) return NextResponse.json({ error: "The executive summary PDF is larger than 3 MB." }, { status: 413 });
    const db0 = await createClient(); if (!db0) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const { lib, version } = await read(db0);
        const f: LibraryFile = { id: EXEC_SUMMARY_ID, name: EXEC_SUMMARY_NAME, contentType: "application/pdf", size: bytes.length, base64: bytes.toString("base64"), at: new Date().toISOString(), by: auth.email || auth.userId };
        try { await write(db0, auth.userId, [...lib.files.filter((x) => x.id !== EXEC_SUMMARY_ID), f], version); return NextResponse.json({ ok: true, at: f.at, size: f.size }); }
        catch (e) { if (attempt === 2 || !/same moment/.test(e instanceof Error ? e.message : "")) throw e; }
      }
    } catch (e) { const m = e instanceof Error ? e.message : String(e); return NextResponse.json({ error: m, migrationNeeded: m === HINT }, { status: m === HINT ? 503 : 409 }); }
  }
  if (!["admin", "preparer"].includes(auth.role || "")) return NextResponse.json({ error: "Admin or preparer role is required to change the file library." }, { status: 403 });
  if (!body?.base64 || !body.name) return NextResponse.json({ error: "Choose a file." }, { status: 400 });
  if (body.replaceId === EXEC_SUMMARY_ID) return NextResponse.json({ error: "The executive summary PDF is made by the Tracker itself." }, { status: 400 });
  const db = await createClient(); if (!db) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  try {
    const { lib, version } = await read(db);
    const id = body.replaceId && lib.files.some((f) => f.id === body.replaceId) ? body.replaceId : "f" + Date.now().toString(36);
    const candidate = sanitizeLibrary({ files: [{ id, name: safeName(body.name), contentType: String(body.contentType || ""), base64: body.base64, at: new Date().toISOString(), by: auth.email || auth.userId, note: body.note }] }).files[0];
    if (!candidate) return NextResponse.json({ error: `Not accepted: use PDF, Excel, Word, PowerPoint, PNG/JPEG, CSV or text, at most ${Math.round(LIBRARY_MAX_FILE / 1048576)} MB.` }, { status: 422 });
    const files = lib.files.filter((f) => f.id !== id);
    if (files.filter((f) => f.id !== EXEC_SUMMARY_ID).length >= LIBRARY_MAX_FILES) return NextResponse.json({ error: `The library holds at most ${LIBRARY_MAX_FILES} files. Remove one first.` }, { status: 422 });
    const i = lib.files.findIndex((f) => f.id === id);
    if (i >= 0) files.splice(i, 0, candidate); else files.push(candidate);
    await write(db, auth.userId, files, version);
    await db.from("audit_events").insert({ actor_id: auth.userId, action: "IMDS_TRACKER_LIBRARY_FILE_SAVED", entity_type: "imds_tracker_settings", metadata: { id, name: candidate.name, size: candidate.size, replaced: i >= 0 } });
    return NextResponse.json({ ok: true, file: listLibrary({ files: [candidate] })[0] });
  } catch (e) { const m = e instanceof Error ? e.message : String(e); return NextResponse.json({ error: m, migrationNeeded: m === HINT }, { status: m === HINT ? 503 : 409 }); }
}

/** DELETE ?id=…: remove a file. Admin / preparer. Automations that used it simply stop attaching it. */
export async function DELETE(request: NextRequest) {
  const auth = await getAuthContext();
  if (!auth.userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!["admin", "preparer"].includes(auth.role || "")) return NextResponse.json({ error: "Admin or preparer role is required to change the file library." }, { status: 403 });
  const id = request.nextUrl.searchParams.get("id") || "";
  if (id === EXEC_SUMMARY_ID) return NextResponse.json({ error: "The executive summary PDF is made by the Tracker itself." }, { status: 400 });
  const db = await createClient(); if (!db) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  try {
    const { lib, version } = await read(db);
    if (!lib.files.some((f) => f.id === id)) return NextResponse.json({ error: "File not found." }, { status: 404 });
    await write(db, auth.userId, lib.files.filter((f) => f.id !== id), version);
    await db.from("audit_events").insert({ actor_id: auth.userId, action: "IMDS_TRACKER_LIBRARY_FILE_REMOVED", entity_type: "imds_tracker_settings", metadata: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 409 }); }
}
