/**
 * Case decision timeline, built only from records that already exist (no new tables, no invented
 * events). Each builder below turns rows from one existing table into events; `buildTimeline`
 * merges, orders and labels them. Pure functions — the route does the queries, tests feed rows in.
 *
 * Honesty rules:
 *  - An event's time is the stored timestamp, a date-only source value, or nothing. Never made up.
 *  - A current value with no log entry is shown as "taken from the G-CATS source", not as a person's action.
 *  - A source the caller cannot read (RLS) is reported as "restricted", a missing table as "unavailable",
 *    so the UI can say *why* the timeline is short instead of implying nothing happened.
 */
export type HistoryKind = "import" | "system" | "supplier" | "reviewer" | "judgement" | "rule" | "admin";
export type Precision = "timestamp" | "date" | "none";
export type HistoryEvent = {
  id: string;
  at: string | null;
  precision: Precision;
  kind: HistoryKind;
  title: string;
  detail: string;
  actor: string | null;
  source: string;
};
export type SourceState = "ok" | "restricted" | "unavailable" | "error";
export type HistoryResponse = {
  item: { id: string; partNo: string | null; supplierCode: string | null; errorType: string; sourceRecordKey: string };
  events: HistoryEvent[];
  sources: Record<string, SourceState>;
  notRecorded: string[];
};

export const NOT_RECORDED = [
  "Field changes made by a G-CATS import are not logged one by one; they are rebuilt here by comparing kept snapshots.",
  "Bulk, auto-judge and register-editor saves do not store a step-by-step evaluation trace.",
  "The moment a result was typed into TMC's G-CATS is not recorded by this app.",
  "Earlier values of a remembered answer (e.g. destination) are overwritten; only the latest is kept."
];

const ORDER: Record<HistoryKind, number> = { import: 0, rule: 1, judgement: 2, system: 3, reviewer: 4, supplier: 5, admin: 6 };
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v)).trim();
const isoDate = (v: unknown): string | null => { const t = s(v); return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null; };

// ---------- import snapshots ----------
export type SnapshotRow = { batch_id: string; file_name: string; committed_at: string | null; created_at: string; source_sheet: string; source_row: number; normalized: Record<string, unknown> | null };
const SNAP_FIELDS: Array<[string, string]> = [
  ["sourceStatus", "Status"], ["sourceJudgeLabel", "Judge"], ["sourceKmJudgeLabel", "KM judge"], ["comment", "Comment (last time)"],
  ["okComment", "OK comment"], ["imdsRejectComment", "IMDS reject comment"], ["lastChangeDate", "Last change date"],
  ["assignedPerson", "Assigned person"], ["judgementProcedure", "Judgement procedure"]
];
/** One event per committed snapshot that contains the case, plus what changed since the previous one. */
export function fromSnapshots(rows: SnapshotRow[], batchesWithoutRow: Array<{ id: string; file_name: string; committed_at: string | null }> = []): HistoryEvent[] {
  const sorted = [...rows].sort((a, b) => (a.committed_at || a.created_at).localeCompare(b.committed_at || b.created_at));
  const out: HistoryEvent[] = [];
  let prev: Record<string, unknown> | null = null;
  sorted.forEach((r, i) => {
    const n = r.normalized || {};
    const changes = prev ? SNAP_FIELDS.filter(([k]) => s(n[k]) !== s(prev![k])).map(([k, label]) => `${label}: ${s(prev![k]) || "—"} → ${s(n[k]) || "—"}`) : [];
    const where = `${r.file_name} · ${r.source_sheet} row ${r.source_row}`;
    if (i === 0) out.push({ id: "snap:" + r.batch_id, at: r.committed_at || r.created_at, precision: "timestamp", kind: "import", title: "First imported from G-CATS", detail: where, actor: null, source: "import_rows" });
    else if (changes.length) out.push({ id: "snap:" + r.batch_id, at: r.committed_at || r.created_at, precision: "timestamp", kind: "import", title: "G-CATS snapshot changed this case", detail: `${changes.join("; ")} (${where})`, actor: null, source: "import_rows" });
    else out.push({ id: "snap:" + r.batch_id, at: r.committed_at || r.created_at, precision: "timestamp", kind: "import", title: "Seen again in G-CATS snapshot", detail: where + " · no tracked field changed", actor: null, source: "import_rows" });
    prev = n;
  });
  const first = sorted[0]?.committed_at || sorted[0]?.created_at || "";
  for (const b of batchesWithoutRow) {
    if (!b.committed_at || b.committed_at < first) continue;
    out.push({ id: "gap:" + b.id, at: b.committed_at, precision: "timestamp", kind: "import", title: "Not in this G-CATS snapshot", detail: `${b.file_name} — the case was kept, not deleted`, actor: null, source: "import_batches" });
  }
  return out;
}

// ---------- register change log (+ matching audit rows) ----------
export type ChangeRow = { id: string; actor_id: string | null; changed_columns: string[]; before_values: Record<string, unknown>; after_values: Record<string, unknown>; created_at: string };
export type AuditRow = { id: string; actor_id: string | null; action: string; metadata: Record<string, unknown> | null; created_at: string };
const SYSTEM_ACTOR = "Auto-judgement (System)";
const near = (a: string, b: string, ms = 5000) => Math.abs(Date.parse(a) - Date.parse(b)) <= ms;

export function fromChangeLog(rows: ChangeRow[], audits: AuditRow[], name: (id: string | null) => string | null): HistoryEvent[] {
  const used = new Set<string>();
  const out: HistoryEvent[] = rows.map((r) => {
    const a = r.after_values || {}, b = r.before_values || {};
    const cols = new Set(r.changed_columns || []);
    const audit = audits.find((x) => !used.has(x.id) && near(x.created_at, r.created_at));
    if (audit) used.add(audit.id);
    const reason = s(audit?.metadata?.reason);
    const auto = s(a.assigned_person) === SYSTEM_ACTOR || audit?.action === "JUDGEMENT_AUTO_FINAL";
    const diff = [...cols].filter((c) => !c.endsWith("_override")).map((c) => `${c.replace(/_/g, " ")}: ${s(b[c]) || "—"} → ${s(a[c]) || "—"}`).join("; ");
    let kind: HistoryKind = "reviewer", title = "Preparation updated";
    if (auto && cols.has("judge") && s(a.judge)) { kind = "system"; title = `Judged ${s(a.judge)} automatically`; }
    else if (cols.has("judge") && !s(a.judge) && s(b.judge)) { kind = "judgement"; title = audit?.action === "JUDGEMENT_AUTO_REOPENED" ? "Automatic judgement reopened" : audit?.action === "JUDGEMENT_BULK_UNDONE" ? "Bulk judgement undone" : "Judgement cleared"; }
    else if (cols.has("judge")) { kind = "judgement"; title = `Judged ${s(a.judge) || "—"}${audit?.action === "JUDGEMENT_BULK_APPLIED" ? " (bulk, identical cases)" : ""}`; }
    else if ([...cols].some((c) => c.startsWith("km_"))) { kind = "reviewer"; title = s(a.km_judge) ? `KM/TMA judge ${s(a.km_judge)}` : "KM/TMA fields updated"; }
    return { id: "log:" + r.id, at: r.created_at, precision: "timestamp" as const, kind, title, detail: [diff, reason && "Reason: " + reason].filter(Boolean).join(" · "), actor: auto ? SYSTEM_ACTOR : name(r.actor_id), source: "register_change_log" };
  });
  // audit rows with no change-log row next to them are still real events (best effort: the log insert may have failed)
  for (const x of audits) {
    if (used.has(x.id)) continue;
    const label: Record<string, [HistoryKind, string]> = {
      JUDGEMENT_AUTO_FINAL: ["system", "Judged automatically"], JUDGEMENT_AUTO_REOPENED: ["judgement", "Automatic judgement reopened"],
      JUDGEMENT_BULK_APPLIED: ["judgement", "Bulk judgement applied"], JUDGEMENT_BULK_UNDONE: ["judgement", "Bulk judgement undone"],
      JUDGEMENT_REGISTER_UPDATED: ["judgement", "Register updated"], KM_JUDGEMENT_UPDATED: ["reviewer", "KM/TMA judgement updated"]
    };
    const [kind, title] = label[x.action] || ["admin", x.action.replace(/_/g, " ").toLowerCase()];
    out.push({ id: "audit:" + x.id, at: x.created_at, precision: "timestamp", kind, title, detail: s(x.metadata?.reason), actor: x.action === "JUDGEMENT_AUTO_FINAL" ? SYSTEM_ACTOR : name(x.actor_id), source: "audit_events" });
  }
  return out;
}

// ---------- rule runs and approvals ----------
export type RunRow = { id: string; rule_id: string; rule_status: string; recommendation: string; reason: string; final_decision: string; created_at: string };
export type ApprovalRow = { id: string; judgement_run_id: string; reviewer_id: string; decision: string; comment: string; created_at: string };
export function fromRuns(runs: RunRow[], approvals: ApprovalRow[], name: (id: string | null) => string | null): HistoryEvent[] {
  return [
    ...runs.map((r) => ({ id: "run:" + r.id, at: r.created_at, precision: "timestamp" as const, kind: "rule" as const, title: `Rules evaluated: ${r.recommendation.replace(/_/g, " ")}`, detail: `${r.rule_id} (${r.rule_status}) · ${r.reason}`, actor: null, source: "judgement_runs" })),
    ...approvals.map((a) => ({ id: "appr:" + a.id, at: a.created_at, precision: "timestamp" as const, kind: "judgement" as const, title: `Finalised ${a.decision.replace("FINAL_", "")}`, detail: a.comment, actor: name(a.reviewer_id), source: "approvals" }))
  ];
}

// ---------- supplier, reviewer side tables ----------
export type FollowupRow = { id: string; status: string; recipient_email: string; subject: string; created_at: string; composed_at: string | null; sent_at: string | null };
export function fromFollowups(rows: FollowupRow[]): HistoryEvent[] {
  return rows.flatMap((f) => [
    { id: "fu:" + f.id, at: f.composed_at || f.created_at, precision: "timestamp" as const, kind: "supplier" as const, title: "Supplier follow-up prepared", detail: `${f.subject} → ${f.recipient_email}`, actor: null, source: "supplier_followups" },
    ...(f.sent_at ? [{ id: "fus:" + f.id, at: f.sent_at, precision: "timestamp" as const, kind: "supplier" as const, title: "Supplier follow-up sent", detail: `${f.subject} → ${f.recipient_email}`, actor: null, source: "supplier_followups" }] : [])
  ]);
}
export type MemoryRow = { field: string; value: string; source: string; set_by_name: string | null; updated_at: string };
export function fromMemory(rows: MemoryRow[]): HistoryEvent[] {
  return rows.map((m) => ({ id: `mem:${m.field}`, at: m.updated_at, precision: "timestamp" as const, kind: m.source === "system" ? "system" as const : "reviewer" as const, title: `Answer remembered for this part: ${m.field} = ${m.value}`, detail: "Latest value only; earlier values are not kept.", actor: m.set_by_name, source: "judgement_memory" }));
}
export type EscalationRow = { id: string; history: Array<{ at?: string; by?: string; status?: string; answer?: string; note?: string }> | null };
export function fromEscalations(rows: EscalationRow[]): HistoryEvent[] {
  return rows.flatMap((e) => (e.history || []).filter((h) => h.at).map((h, i) => ({
    id: `esc:${e.id}:${i}`, at: s(h.at), precision: "timestamp" as const, kind: "reviewer" as const,
    title: h.status === "CONFIRMED" ? `TMC answered ${s(h.answer) || "—"}` : h.status === "SENT" ? "Sent to TMC" : "Marked: needs TMC",
    detail: s(h.note), actor: s(h.by) || null, source: "judgement_escalations"
  })));
}
export type EvidenceRow = { id: string; file_name: string; classification: string; created_at: string };
export type TaskRow = { id: string; title: string; status: string; created_at: string; completed_at: string | null };
export function fromCaseFiles(evidence: EvidenceRow[], tasks: TaskRow[]): HistoryEvent[] {
  return [
    ...evidence.map((e) => ({ id: "ev:" + e.id, at: e.created_at, precision: "timestamp" as const, kind: "reviewer" as const, title: "Evidence uploaded", detail: `${e.file_name} (${e.classification})`, actor: null, source: "evidence" })),
    ...tasks.flatMap((t) => [
      { id: "task:" + t.id, at: t.created_at, precision: "timestamp" as const, kind: "reviewer" as const, title: "Verification task created", detail: t.title, actor: null, source: "verification_tasks" },
      ...(t.completed_at ? [{ id: "taskdone:" + t.id, at: t.completed_at, precision: "timestamp" as const, kind: "reviewer" as const, title: "Verification task completed", detail: t.title, actor: null, source: "verification_tasks" }] : [])
    ])
  ];
}

// ---------- current values without a log entry ----------
export type ItemNow = { judge: string | null; km_judge: string | null; source_judge_label: string | null; source_km_judge_label: string | null; last_change_date: string | null; starting_date: string | null; last_comment: string | null };
export function fromCurrentState(item: ItemNow, logged: HistoryEvent[]): HistoryEvent[] {
  const out: HistoryEvent[] = [];
  const judgeLogged = logged.some((e) => e.source === "register_change_log" && /^Judged |Judgement cleared|undone|reopened/.test(e.title));
  if (s(item.judge) && !judgeLogged) {
    const d = isoDate(item.last_change_date);
    out.push({ id: "now:judge", at: d, precision: d ? "date" : "none", kind: "judgement", title: `Judge ${s(item.judge)} taken from the G-CATS source`, detail: `No in-app judgement is logged for this case; the value came with the export${s(item.source_judge_label) ? ` (label "${s(item.source_judge_label)}")` : ""}.`, actor: null, source: "gcat_error_items" });
  }
  const sd = isoDate(item.starting_date);
  if (sd) out.push({ id: "now:start", at: sd, precision: "date", kind: "import", title: "G-CATS starting date", detail: "Date the case opened in G-CATS (date only).", actor: null, source: "gcat_error_items" });
  if (s(item.last_comment)) out.push({ id: "now:lastcomment", at: null, precision: "none", kind: "import", title: "G-CATS comment (last time)", detail: s(item.last_comment), actor: null, source: "gcat_error_items" });
  return out;
}

/** Merge, de-duplicate and order: by time (dates as the start of that day, Jakarta), then by kind; undated last. */
export function buildTimeline(groups: HistoryEvent[][]): HistoryEvent[] {
  const seen = new Set<string>();
  const all = groups.flat().filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
  const key = (e: HistoryEvent) => e.at === null ? Number.POSITIVE_INFINITY : e.precision === "date" ? Date.parse(e.at + "T00:00:00+07:00") : Date.parse(e.at);
  return all.sort((a, b) => {
    const ka = key(a), kb = key(b);
    if (ka !== kb) return (Number.isNaN(ka) ? Infinity : ka) - (Number.isNaN(kb) ? Infinity : kb);
    return ORDER[a.kind] - ORDER[b.kind] || a.id.localeCompare(b.id);
  });
}

/** Postgres/PostgREST errors that mean "the table is not there" (migration not applied) rather than a failure. */
export const isMissingTable = (e: { code?: string; message?: string } | null | undefined) =>
  Boolean(e && (e.code === "42P01" || e.code === "PGRST205" || /does not exist|could not find the table/i.test(e.message || "")));
