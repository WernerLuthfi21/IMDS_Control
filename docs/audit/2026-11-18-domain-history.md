# Domain Workflow Audit: case history, counters, import safety

Repo: /home/claude/imds_control. This was a read-only audit; no repo files were changed. Date: 2026-11-18.
Citations use the form `file:line`. Migration files are named by their version prefix:
- `m048` = 20261103032048_initial_schema.sql
- `m119` = 20261103032119_judgement_register_supplier_workflows.sql
- `m155` = 20261103032155_source_status_overrides_and_precheck_import.sql
- `m157` = 20261103032157_precheck_internal_review.sql
- `m202` = 20261103032202_bulk_preparation_rpc.sql
- `m0600` = 20261106000000_supplier_confirmations.sql
- `m0603` = 20261106000300_sync_outbox.sql
- `m1180` = 20261118000000_judgement_memory_autojudge.sql
- `m1181` = 20261118010000_judgement_escalations.sql
- `m1182` = 20261118020000_followup_logs_if_missing.sql

**Remote-schema caveat.** According to `docs/DEPLOYMENT_AND_CLAUDE_GUIDE_ID.md:31-42` and `docs/IMPLEMENTATION_STATUS.md`, only the first 8 migrations (through 20261103032731) have been applied remotely. If that is still true, the following tables may not exist in the remote database: supplier_confirmations, sync_outbox, imds_tracker_*, judgement_memory, judgement_escalations and imds_tracker_followup_logs. A history endpoint should therefore treat "relation does not exist" as `unavailable` for each source. This is the same pattern used for `MEMORY_TABLE_MISSING` (lib/judgement/memory.ts:31). I could not check the remote database from here.

---

## Goal 1: Case decision timeline data inventory

The register item is `public.gcat_error_items` (m048:131-148, with columns added in m119:6-24 and m155:3-14).

The case is `public.gcat_cases` (m048:108-129). With the current importer, item and case are effectively 1:1:
- `source_case_code` and `source_record_key` are the same string: `code:<G-CATS code>`, or `fallback:<hash16>:<sheet>:<row>` when there is no code (app/api/imports/preview/route.ts:141,151,154; m155:103).
- So `case_id` identifies one item. Nothing in the schema enforces this (there is no unique constraint on `case_id`), and rows from older key formats (m048:469) could break it.

RLS role groups used below:
- "internal" = admin, preparer, reviewer, viewer, rule_author, rule_approver.
- "editors" = admin, preparer, reviewer.

### (a) Original imported source row and snapshot/batch information

| Table / columns | How to query by item | RLS read for internal users | Link |
|---|---|---|---|
| `gcat_error_items`: `source_record_key`, `source_batch_id` (last batch that touched the row), `source_sheet`, `source_row`, `source_hash` (sha256 of the last file), `source_first_seen_at` (set on insert, default now()), `source_last_seen_at` (now() on each commit, m155:119), `created_at`, `updated_at`, `raw_source` (latest full row JSON, keys `"<header> [col N]"`), `source_code`, `source_year`, `source_month`, `source_status` | `.eq("id", itemId)` | All internal roles (m048:337) | item id |
| `import_batches`: `id`, `file_name`, `source_file_hash`, `source_sheet`, `header_row`, `total_rows`, `committed_rows`, `status` (STAGED/COMMITTED/FAILED), `metadata` (classification, columns, sourceHash), `uploaded_by`, `created_at`, `committed_at` (m048:58-73) | `.eq("id", item.source_batch_id)`, or all committed batches | **Uploader, admin or reviewer only** (m048:327). Preparers who did not upload, viewers and rule roles see nothing | batch id |
| `import_rows`: one row per source row per batch: `batch_id`, `source_sheet`, `source_row`, `source_case_code`, `row_data` (full raw row), `normalized` (parsed fields: sourceStatus, sourceJudgeLabel, okComment, comment, lastChangeDate, downloadDate, year, month, …), `validation_*`, `created_at` (m048:75-88; written in preview/route.ts:202-206) | `.eq("source_case_code", item.source_record_key)` joined to `import_batches` with status COMMITTED. **This is the only per-snapshot history of the source row.** | Same restriction as `import_batches` (m048:330) | `source_case_code` = `source_record_key` |
| `gcat_cases`: `raw_source` and `source_batch_id` of the latest batch, `created_at`, `updated_at` (overwritten on each import, m155:96-98) | `.eq("id", item.case_id)` | All internal roles (m048:335) | case id |
| `audit_events` `IMPORT_STAGED` (preview/route.ts:207; metadata `fileName, classification, rows, sheet, hash`) and `IMPORT_COMMITTED` (m155:133-134; metadata `casesProcessed, itemsProcessed, mergeKey, preserveOnlyExplicitWebsiteOverrides`) | `entity_type='import_batch'`, `entity_id` in batch ids | admin, reviewer, rule_approver only (m048:360) | batch id |

Notes:
- `import_rows` has no index on `source_case_code`. The only index is `(batch_id, source_row)` (m048:88). Query by `batch_id IN (…)` plus `source_case_code` so the batch_id prefix is used. Scale will need an index later, which means a migration.
- Rows from STAGED-but-never-committed batches stay in `import_rows`. Filter on `import_batches.status='COMMITTED'`.

### (b) G-CATS "Comment(last time)" and other historical fields inside the source row

- `gcat_error_items.last_comment` holds G-CATS **"Comment(last time)"**. It falls back to "Comment" when that column is absent (preview/route.ts:104,174). Each import overwrites it (m155:117), so earlier values exist only in `import_rows.normalized.comment` and `row_data`.
- `raw_source` and `import_rows.row_data` keep every source column under `"<header> [col N]"`. Read them with `pick()` (lib/judgement/gcats-detail.ts:14-25). History-relevant headers:
  - "Comment(last time)" and "Comment"
  - "Status"
  - "Download Date", "Year", "Month"
  - "Judge (OK/NG)" (also stored as `source_judge_label`)
  - "KM Judge (OK/NG)" (`source_km_judge_label`)
  - "Assigned person", "The starting date", "Judgment procedure"
  - "Record of changing to …", "IMDS Reject comment", "KM Comment", "Last Change Date"
- The Judgement page sends only `comment_last_time` to the browser (app/judgement/page.tsx:57). `raw_source` stays on the server (page.tsx:54-55 comment).
- `buildCommentHistory` (lib/judgement/comment-history.ts:22-41) is client-side and in-memory only, over the rows loaded for the current batch. It is not persisted.
- Timestamps: "Comment(last time)" has none. "Last Change Date", "The starting date" and "Download Date" are date-only strings (normalized to YYYY-MM-DD, preview/route.ts:113-121).

### (c) Judgement fields on the item (current values only)

These columns hold only the current value. Each new value overwrites the old one. Earlier values survive only in `register_change_log` (see (d2)) or `import_rows`.

- `judge`, `judge_status`, `ok_comment`, `imds_reject_comment`, `judgement_procedure`, `assigned_person`, `starting_date` (DATE), `last_change_date` (timestamptz), `km_judge`, `km_comment` (m119:12-20)
- `source_judge_label`, `source_km_judge_label` (m155:4-5)
- Nine `*_override` booleans (m155:6-14)
- Automatic decisions are recognisable by `assigned_person = 'Auto-judgement (System)'` (lib/judgement/autojudge.ts:21).
- Read access: all internal roles (m048:337). Link: item id.

### (d) audit_events

Table at m048:262-271, index `(entity_type, entity_id, created_at desc)`.
- **Read:** admin, reviewer, rule_approver only (m048:360). Preparers and viewers get nothing.
- **Insert:** `actor_id is null or actor_id = auth.uid()` (m048:361).
- Every insert in app code ignores the returned error. Audit is best-effort, so gaps are possible.

| action | Where (file:line) | entity_type / entity_id | metadata keys | Link to the item |
|---|---|---|---|---|
| JUDGEMENT_REGISTER_UPDATED / KM_JUDGEMENT_UPDATED | app/api/register/[id]/route.ts:66 | gcat_error_item / item id | changedColumns | **item id** |
| JUDGEMENT_BULK_APPLIED / JUDGEMENT_BULK_UNDONE | app/api/judgement/bulk/route.ts:38-41 (via logChange, called at :118, :167) | gcat_error_item / item id | changedColumns, source:"bulk-judgement" | **item id** |
| JUDGEMENT_BULK_BATCH_APPLIED | bulk/route.ts:126-129 | judgement_bulk_batch / null | itemIds[], decision, succeeded, failed | `metadata @> {"itemIds":[id]}` |
| JUDGEMENT_AUTO_FINAL | app/api/judgement/autorun/route.ts:144-145 | gcat_error_item / item id | decision, kind, reason, signature, triggeredBy, config{kinds, approvedBy, approvedAt} | **item id** |
| JUDGEMENT_AUTO_REOPENED | autorun/route.ts:102 | gcat_error_item / item id | reason, previousJudge | **item id** |
| AUTOJUDGE_CONFIG_CHANGED | autorun/route.ts:75 | autojudge_config / null | before, after (full config) | global (rule/admin) |
| JUDGEMENT_TMC_NEED / _SENT / _CONFIRMED | app/api/judgement/escalations/route.ts:44 | judgement_escalation / **null** | key, answer, note, itemId | `metadata->>itemId` (also the key, which starts with part) |
| JUDGEMENT_MEMORY_SET | app/api/judgement/memory/route.ts:25 | judgement_memory / **null** | partNo (raw), field, value, itemId | `metadata->>itemId` or `metadata->>partNo` |
| JUDGEMENT_REGISTER_BULK_PREPARATION | m202:76-78 | gcat_error_items / **null** | count, errorType, changedColumns | **no item ids** (use register_change_log) |
| JUDGEMENT_FINALIZED | m048:402-403 (approve_judgement RPC) | judgement_run / run id | decision | via `judgement_runs.case_id` |
| IMPORT_STAGED / IMPORT_COMMITTED | see (a) | import_batch / batch id | see (a) | via batch id |
| SUPPLIER_FOLLOWUP_COMPOSED | app/api/followups/route.ts:35 | supplier_followup / followup id | supplierCode, recipient | via `supplier_followups.item_id` |
| SUPPLIER_FOLLOWUP_SENT_VIA_FLOW / _SEND_FAILED | app/api/automation/followups/send/route.ts:74 | supplier_followup / followup id | supplierCode, recipient | via `supplier_followups.item_id` |
| IMDS_TRACKER_SUPPLIER_EMAIL_DRAFTED | app/api/imds-master/followups/route.ts:148-149 | imds_tracker_followup / log id | kind, supplierCode, recipientCount, ccCount, parts (count), attachments | supplier code only |
| IMDS_TRACKER_SUPPLIER_EMAIL_SENT / _FAILED | imds-master/followups/route.ts:175-178 | imds_tracker_followup / log id | kind, test, supplierCode, recipientCount, ccCount, parts, attachments, status | supplier code only |
| IMDS_MASTER_PART_UPDATED | app/api/imds-master/parts/[id]/route.ts:78-84 | imds_master_part / part id | changedColumns, masterKey | tracker part (by part no) |
| IMDS_MASTER_WORKBOOK_IMPORTED | imds-master/import-master/route.ts:317-323 | imds_master_import_batch | fileName, rows, inserted, updated, skipped, contactsImported, sheet | global |
| IMDS_MD_SYSTEM_SEARCH_IMPORTED | imds-master/import-md-system/route.ts:497-506 | imds_mds_import_batch | fileName, totalRows, matched…, staleSkipped, powerAutomate | global |
| EVIDENCE_REGISTERED | app/api/evidence/register/route.ts:17 | evidence / evidence id | caseId, classification, sourcePage/Sheet/Row | `metadata->>caseId` |
| VERIFICATION_TASK_CREATED | app/api/tasks/route.ts:27 | verification_task / task id | caseId, taskType | `metadata->>caseId` |
| SUPPLIER_PRECHECK_SUBMITTED | app/api/prechecks/route.ts:28 | supplier_precheck / id | supplierCode, deliveryPartNo, sourceFormat | part number |
| SUPPLIER_PRECHECK_REVIEWED | app/api/prechecks/[id]/route.ts:40 | supplier_precheck / id | status, supplierCode, partNo | part number |
| REGISTER_SEED_EXPORT, AUTOMATION_TEST_*, SHAREPOINT_MASTER_FETCHED | automation/export:13, automation/test:23, sharepoint/stage:31 | global | rows, transport/ok, file info | global (admin) |
| ACCESS_* / PASSWORD_* / STAFF_ACCESS_REQUESTED | app/api/access/*, app/api/admin/access/[id] | access_request | — | not case related |

Note: `.github/workflows/` contains a stale full copy of `app/` and `supabase/` (for example `.github/workflows/app/api/register/[id]/route.ts:49`). Ignore it for history purposes and consider removing it.

#### (d2) register_change_log

This is a real per-item history table that the brief did not name. It holds before/after values of judgement edits.

- Table: m119:32-41, columns `item_id` (FK, **on delete cascade**), `actor_id`, `changed_columns text[]`, `before_values jsonb`, `after_values jsonb`, `created_at`; index `(item_id, created_at desc)`.
- **Read:** admin and reviewer only (m119:123-124). Preparers, viewers and rule_approver cannot read it.
- Nothing in the app reads this table today (no SELECT anywhere).

Writers:

| Writer | file:line | before_values | after_values |
|---|---|---|---|
| PATCH register | app/api/register/[id]/route.ts:65 | 8 fields + source labels + override flags (read at :37). Excludes last_change_date and judge_status | Only the keys written, including `*_override`, judge_status, last_change_date |
| Bulk apply | bulk/route.ts:33-37 via :118 | assigned_person, starting_date, judgement_procedure, judge, ok/reject comment | Full patch |
| Bulk undo | bulk/route.ts:167-168 | **Only** `{judge, last_change_date}` | Restore patch |
| Autorun final | autorun/route.ts:143 | 6 judgement fields | Patch |
| Autorun reopen | autorun/route.ts:101 | judge, assigned_person, ok_comment, imds_reject_comment | Restore |
| Bulk preparation RPC | m202:71-72 | `to_jsonb(full row)` (includes the whole raw_source) | `to_jsonb(full row)` |

The insert result is never checked in any of the app routes.

### (e) Judgement evaluation traces

- Table `judgement_runs` (m048:182-201): `case_id`, `error_type_label`, `rule_id`, `rule_status`, `recommendation`, `final_decision`, `reason`, `input_snapshot`, `evaluation_trace`, `source_references`, `manual_tasks`, `reviewer_override_reason`, `prepared_by`, `approved_by`, `approved_at`, `created_at`. Index `(case_id, created_at desc)`.
- Written only by `POST /api/judgement/evaluate` when the call is not a dry run and the role is admin, preparer or reviewer (app/api/judgement/evaluate/route.ts:36-50). `case_id` comes from `input.caseId`.
- **There is no item_id column.** The link is through `case_id` = `gcat_error_items.case_id`. The browser passes `row.case_id` (lib/judgement/client-save.ts:7; components/judgement-workspace.tsx:135; components/review-deck.tsx:224).
- `approvals` table (m048:253-260): `judgement_run_id`, `reviewer_id`, `decision`, `comment`, `created_at`. Written only by the `approve_judgement` RPC (m048:398-403).
- RLS: `judgement_runs` and `approvals` are readable by **every authenticated user, including the supplier role** (`using (true)`, m048:346, 358). See the security notes.

**Not traced.** These save paths never insert into `judgement_runs`, so no evaluation trace is stored for them:
- Bulk apply (bulk/route.ts:76-139).
- The ReviewDeck "unchanged engine result" save, which calls bulk apply (components/review-deck.tsx:218-221). Its comment says "saved server-side with the full trace", which is **inaccurate**.
- Autorun FINAL (autorun/route.ts:127-148). Only the `signature` and `reason` go into audit metadata.
- The Register detail editor (components/register-editor.tsx:20), which PATCHes directly.
- Bulk preparation.

Ordering issue: `saveJudgement` writes the run first and then PATCHes (client-save.ts:7-14). A failed PATCH leaves a run with no matching judgement.

### (f) Supplier follow-up logs and outbox

| Table | Columns | Link | RLS read |
|---|---|---|---|
| `supplier_followups` (m119:83-97) | item_id (FK, set null on delete), supplier_code, recipient_email, cc_emails, subject, message_body, status DRAFT/COMPOSED/SENT/CANCELLED, created_by, created_at, composed_at, sent_at | **item_id** (null if composed without an item) | admin, preparer, reviewer (m119:116-117). The supplier sees its own code's rows (m119:226-227). **Viewers cannot read.** |
| `sync_outbox` (m0603:3-17) | kind EXCEL_UPSERT/SUPPLIER_EMAIL, item_id, followup_id, status, attempts, last_error, created_by, created_at, updated_at, sent_at | **item_id** and followup_id | admin, preparer, reviewer (m0603:21-22) |
| `imds_tracker_followup_logs` (m1182:4-20) | supplier_code, supplier_name, recipient_email, cc_emails, subject, message_body, part_count, attachment_name, status PREPARED/SENT/FAILED, error_message, provider_response, sent_by, sent_at, created_at | **supplier_code / supplier_name only.** No part or item ids are stored (imds-master/followups/route.ts:144-147, 153-156) | internal including viewer (m1182:28-30) |

Writers:
- `supplier_followups`: app/api/followups/route.ts:33 and app/api/automation/followups/send/route.ts:70. Status is set to SENT in lib/automation/outbox.ts:46.
- `sync_outbox`: enqueued in lib/automation/outbox.ts:8-12, called from register PATCH :69, bulk :119/:169, autorun :103/:146 and follow-up send :72.

### (g) TMC escalations

- Table `judgement_escalations` (m1181:3-22): `case_key` (unique, `PART|errortype|cas|flow`), `item_id` (**last writer's item**, not a foreign key), `part_no` (memory partKey), `error_type`, `cas`, `flow_id`, `status` NEED/SENT/CONFIRMED, `answer`, `note`, `sent_at`, `answered_at`, `updated_by`, `updated_by_name`, `history jsonb`, `created_at`, `updated_at`.
- `history[]` entries are `{at, by, status, answer, note}`, appended and capped at the **last 50** (escalations/route.ts:32). An upsert overwrites the top-level fields (:35-42). A "reset" clears `sent_at`.
- One row is shared by every identical case (same part, type, CAS and flow).
- RLS read: all internal roles (m1181:30-32).
- Link: `item_id`, or part_no + error_type + cas.

### (h) judgement_memory

- Table at m1180:8-22. Unique `(scope, scope_key, field)` with **upsert** (lib/judgement/memory.ts:59-62). Columns: `scope_key` (memory partKey: uppercased, whitespace removed, hyphens kept), `field`, `value`, `source`, `set_by`, `set_by_name`, `source_item_id`, `created_at`, `updated_at`.
- Only the current value per part and field is kept. **Earlier values are overwritten.** Their history exists only in `audit_events` JUDGEMENT_MEMORY_SET.
- RLS read: all internal roles (m1180:29-31).
- Link: part number (and `source_item_id` = the item that last set it).

### (i) Evidence files

- `evidence` (m048:236-251): `case_id`, `task_id`, `file_name`, `storage_path`, `mime_type`, `file_hash`, `source_page`, `source_sheet`, `source_row`, `classification`, `uploaded_by`, `created_at`.
  - RLS read: **the uploader, or admin, reviewer or rule_approver** (m048:354). Preparers and viewers see only their own uploads.
  - Link: **case_id**.
- `verification_tasks` (m048:203-219): `case_id`, `task_type`, `title`, `status`, `due_at`, `completed_at`, `created_by`, `created_at`, `updated_at`.
  - RLS read: `true`, so any authenticated user including suppliers (m048:350).
- Storage bucket `evidence-private`: the path's first folder is the uploader's uid (m048:371).

### (j) Cases table and other part- or supplier-level sources

- `gcat_cases`: see (a). There is no case-level status history. `workflow_status` and `final_decision` are never updated by app code.
- `confirmations` (m048:221-234) is **unused by the app**.
- `supplier_confirmations` (m0600):
  - Append-only (only select and insert are granted, :36-37), with full history.
  - Columns: supplier_code, delivery_part_no, `part_key` (intake partKey: strips spaces, `-`, `_`, `/`, `.`; lib/intake/keys.ts), family, cas, answers, result_state/comment, source_file_name, submitted_by, submitted_at.
  - RLS read: all internal roles (:33-34).
  - Link: part key + supplier code + family + CAS.
- `supplier_prechecks` (m119:59-81, m157:3-7): delivery_part_no, supplier_code, workflow_status, created_at, reviewed_by, reviewed_at, review_comment. RLS read: editors (m119:107-108). Link: part number.
- `imds_master_parts` and `imds_mds_search_results` (tracker): linked by `part_no_norm`. They hold current tracker state plus MD System lookup rows over time (`imported_at`). RLS read: internal including viewer.

### What is NOT recorded (stated plainly)

1. **Import-driven changes are not logged per item.** A daily commit can rewrite judge, comments, procedure, KM fields, status, last_comment and raw_source on non-overridden fields (m155:113-128). It writes no `register_change_log` row. The only way to reconstruct these changes is to diff `import_rows` across committed batches, and only users who can read `import_batches` can do that.
2. If a cell is blank in the new export, the import writes NULL to non-overridden judgement fields (`excluded.x` is null). The earlier value is only in older `import_rows`.
3. Earlier `judgement_memory` values are overwritten. Their history is only in `audit_events` (admin, reviewer, rule_approver).
4. Escalation history is capped at 50 entries. `item_id` is overwritten by the last writer.
5. No evaluation trace exists for bulk, ReviewDeck-unchanged, autorun or register-editor saves (see (e)).
6. Bulk-undo and auto-reopen change-log rows keep incomplete before values (see the (d2) table).
7. Bulk-preparation audit rows carry no item ids.
8. Audit and change-log inserts are fire-and-forget. A failed insert is silent.
9. Tracker e-mails (`imds_tracker_followup_logs`) have no link to a part or item. A `.eml` draft logged as PREPARED gives no evidence that anything was actually sent.
10. When a result was typed into G-CATS is not recorded. No integration exists, by design. It shows up only indirectly, as label or status changes in the next snapshot.
11. Actor display names are hard to resolve. Most tables store only `actor_id`, and `profiles` is readable only by the user themself or an admin (m048:321). A server route running with the user's session therefore cannot resolve other users' names unless it is an admin. Name text does exist in `judgement_memory.set_by_name`, `judgement_escalations.updated_by_name` / `history[].by`, autorun audit `triggeredBy`, `autojudge_config.approvedBy`, and `assigned_person`.
12. If two rows in one workbook share the same `code`, they collapse into one item and the last row wins. The loop orders by source_row (m155:102), and the preview gives no duplicate-code warning (preview/route.ts:179-188). Both rows remain only in `import_rows`.
13. A manual SQL delete of an item would cascade and wipe its `register_change_log` (m119:34).

---

## Goal 2: Query plan for `GET /api/judgement/history?itemId=…` (no migration)

**Response type**

```ts
type Kind = "import" | "system" | "supplier" | "reviewer" | "judgement" | "rule" | "admin";
type HistoryEvent = {
  at: string | null;                         // ISO timestamp, or YYYY-MM-DD, or null
  atPrecision: "timestamp" | "date" | "none"; // optional extension; lets the UI sort honestly
  kind: Kind; title: string; detail: string;
  actor: { type: "user" | "system" | "supplier" | "import"; id?: string; name?: string } | null;
  source: { table: string; id?: string; column?: string; batchId?: string; sheet?: string; row?: number };
};
type HistoryResponse = {
  item: { id: string; caseId: string; sourceRecordKey: string; partNo: string | null; supplierCode: string | null; errorType: string };
  events: HistoryEvent[];
  sources: Record<string, "ok" | "restricted" | "unavailable" | "error">; // RLS-empty vs table missing
  notRecorded: string[];                                                    // fixed honest caveats (Goal 1 list)
};
```

**Auth.** Use `getAuthContext()`. Allow internal roles only and reject `supplier`. Validate itemId with `UUID` from lib/judgement/ids.ts. Use the caller's RLS session; do **not** use the service role. When a table returns empty because RLS hides it, return `sources[x] = "restricted"`. Decide this from the role, because RLS returns an empty result rather than an error. This avoids implying "no history" when the data is only hidden.

### Step 1 (sequential): load the item

Query `gcat_error_items.select("id,case_id,source_record_key,source_batch_id,source_sheet,source_row,source_first_seen_at,source_last_seen_at,created_at,updated_at,delivery_part_no,supplier_code,error_type_label,source_status,judge,km_judge,assigned_person,starting_date,last_change_date,source_judge_label,source_km_judge_label,last_comment,judge_override,km_judge_override,raw_source").eq("id", itemId).maybeSingle()`.

Return 404 if not found. Extract a few raw fields server-side with `pick()`, then drop `raw_source`. Derive:
- `memKey = memory.partKey(part)`
- `intakeKey = intake/keys.partKey(part)`
- `facts = extractRowFacts(raw_source)` (gives the CAS)

### Step 2 (parallel `Promise.all`)

| # | Query | Event mapping | Ordered by |
|---|---|---|---|
| Q1 | `import_batches.select("id,file_name,status,created_at,committed_at,uploaded_by").eq("status","COMMITTED").order("committed_at",{ascending:false}).limit(90)`, then `import_rows.select("batch_id,source_sheet,source_row,normalized,created_at").in("batch_id",ids).eq("source_case_code",item.source_record_key)` | kind **import**. One event per snapshot where the row appears ("Seen in snapshot <file>"). The first one is "First imported". Then a diff against the previous snapshot of `normalized.sourceStatus`, `sourceJudgeLabel`, `sourceKmJudgeLabel`, `comment` (= Comment(last time)), `okComment`, `imdsRejectComment`, `lastChangeDate`, `assignedPerson`, `judgementProcedure`. Gaps (batches without the row) become "Not in snapshot X (kept, not deleted)". Actor type import, id `uploaded_by`. | `committed_at` (timestamp) |
| Q1 fallback | If Q1 is restricted: use `item.source_first_seen_at` ("First imported") and `source_last_seen_at` ("Last seen in G-CATS snapshot") | import | timestamp |
| Q1b | From the latest snapshot or `raw_source`: "Comment(last time)", source "Last Change Date", "The starting date", "Download Date" | kind import, title "G-CATS comment (last time)" and so on. Anchor each value to the first snapshot where it appeared (from Q1). | Comment(last time): **none**. Source dates: **date-only** |
| Q2 | `register_change_log.select("id,actor_id,changed_columns,before_values,after_values,created_at").eq("item_id",itemId).order("created_at")` | Classify each row (rules below this table) | timestamp |
| Q3 | `audit_events.select("id,actor_id,action,metadata,created_at").eq("entity_type","gcat_error_item").eq("entity_id",itemId)` | Merge with the Q2 row at the same item and ±5 s to add `reason`, `signature`, `config.approvedBy/At` and `triggeredBy`. Keep audit-only rows when the change log is missing (best-effort gap). | timestamp |
| Q4 | `audit_events…eq("entity_type","judgement_escalation").eq("metadata->>itemId",itemId)` and `…eq("entity_type","judgement_memory").or("metadata->>itemId.eq.<id>,metadata->>partNo.eq.<raw part>")` | reviewer: "Marked sent to TMC", "TMC answered OK: note", "Remembered destination=EU" | timestamp |
| Q5 | `judgement_runs.select("id,rule_id,rule_status,recommendation,reason,final_decision,approved_by,approved_at,created_at,manual_tasks").eq("case_id",item.case_id).order("created_at")`, then `approvals.in("judgement_run_id",runIds)` | kind **rule**: "Rules evaluated: <rule_id> (<rule_status>) → RECOMMEND_OK", detail = reason. Approvals and `approved_at` → kind **judgement**: "Finalized FINAL_OK by reviewer", detail = approval comment. | timestamp |
| Q6 | `supplier_followups.select("id,status,recipient_email,subject,created_by,created_at,composed_at,sent_at").eq("item_id",itemId)`, then `sync_outbox.select("id,kind,status,attempts,last_error,created_at,sent_at").or("item_id.eq.<id>,followup_id.in.(…)")` | kind **supplier**: "Follow-up composed" (`composed_at`), "Sent via flow" (`sent_at`). Outbox SUPPLIER_EMAIL failures appear as detail. Optionally EXCEL_UPSERT rows become kind **system** "Synced to Excel master" (`sent_at`) or "Sync failed: last_error". | timestamp |
| Q7 | `supplier_confirmations.select("supplier_code,family,cas,answers,result_state,result_comment,source,source_file_name,submitted_at").eq("part_key",intakeKey).order("submitted_at")`, filtered in code to `supplierKey(supplier_code)` equal to the item's | kind **supplier**: "Supplier self-check: <family> <answers>" | timestamp |
| Q8 | `imds_tracker_followup_logs.select("status,subject,part_count,recipient_email,sent_at,created_at").eq("supplier_code",item.supplier_code).order("created_at",{ascending:false}).limit(20)` | kind **supplier**, detail must say "supplier-level e-mail (N parts); not linked to this case" | timestamp |
| Q9 | `judgement_memory.select("field,value,source,set_by_name,source_item_id,created_at,updated_at").eq("scope","part").eq("scope_key",memKey)` | kind **reviewer** (or system if source=system): "Remembered <field>=<value> for this part" | `updated_at` (latest value only) |
| Q10 | `judgement_escalations.select("case_key,item_id,status,answer,note,cas,flow_id,created_at,history").eq("part_no",memKey).eq("error_type",normalizedType)`, filtered in code by CAS (`facts.cas` or `-`) | One event per `history[]` entry ({at, by, status, answer, note}): kind **reviewer**, actor name = `by` | `history[].at` (ISO string, timestamp) |
| Q11 | `evidence.select("id,file_name,classification,source_page,source_sheet,source_row,uploaded_by,created_at").eq("case_id",item.case_id)` and `verification_tasks.select("id,task_type,title,status,created_by,created_at,completed_at,due_at").eq("case_id",item.case_id)` | kind **reviewer**: "Evidence uploaded", "Task created / completed" | timestamp |
| Q12 | `supplier_prechecks.select("id,workflow_status,mds_id,mds_version,created_at,reviewed_at,review_comment").eq("supplier_code",item.supplier_code).eq("delivery_part_no",item.delivery_part_no)` | kind **supplier** ("Pre-check submitted") and **reviewer** ("Pre-check reviewed: status") | timestamp |
| Q13 (admin/rule context) | `audit_events…eq("action","AUTOJUDGE_CONFIG_CHANGED").lte("created_at", autoFinalAt).order("created_at",{ascending:false}).limit(1)`, only when an AUTO_FINAL exists | kind **admin**: "Auto-judge family <kind> switched on by X on date" (the approval in force) | timestamp |
| Q14 (optional) | `audit_events.eq("entity_type","import_batch").in("entity_id",batchIdsContainingItem)` | Adds the "staged by / committed by" actor to Q1 events | timestamp |

How to classify each Q2 `register_change_log` row:
- `after_values.assigned_person === "Auto-judgement (System)"` → kind **system**, title "Judged <judge> automatically".
- `after_values.judge === null` and `before_values.judge` is set → **judgement**, "Judgement reopened/undone". Use Q3 for the reason.
- `changed_columns` includes `judge` → **judgement**, "Judged OK/NG: <comment>". Show before → after.
- Changes only to `km_*` → **reviewer**, "KM/TMA judge <x>".
- Changes only to `assigned_person`, `starting_date` or `judgement_procedure` → **reviewer**, "Preparation updated".
- Actor: `actor_id`. Resolve names only when admin, otherwise show "user".

### Step 3: synthesize current-state events when no log covers them

- If `judge` is set and Q2 has no row that sets judge, the judgement came from the G-CATS source (or predates logging). Add a **judgement** event: "Judge <x> taken from G-CATS source (label '<source_judge_label>')". `at` = the source Last Change Date (date) or null.
- Never invent timestamps.

### Ordering

1. Sort by `at` ascending. Compare date-only values as the start of that day in Asia/Jakarta, and give them `atPrecision: "date"`.
2. Place `at: null` events right after the snapshot event that first showed them. If there is no anchor, put them in an "Undated" group at the end.
3. Tie-breakers: import < rule < judgement < system < reviewer < supplier < admin, then `source.table` and `source.id`.

**Timestamped (orderable):**
- import_batches.created_at / committed_at
- item.source_first/last_seen_at, created_at, updated_at, last_change_date
- register_change_log.created_at
- audit_events.created_at
- judgement_runs.created_at / approved_at
- approvals.created_at
- supplier_followups.created_at / composed_at / sent_at
- sync_outbox.created_at / updated_at / sent_at
- supplier_confirmations.submitted_at
- judgement_memory.created_at / updated_at
- judgement_escalations.sent_at / answered_at / created_at and history[].at
- evidence.created_at
- verification_tasks.created_at / completed_at
- supplier_prechecks.created_at / reviewed_at
- imds_tracker_followup_logs.created_at / sent_at

**Date-only:**
- item.starting_date
- source "Last Change Date", "The starting date", "Download Date" (normalized YYYY-MM-DD)
- source_year / source_month

**No timestamp:**
- G-CATS Comment(last time), source Judge/KM labels and source Status text
- Current judgement_procedure, ok/reject/KM comments (when not covered by the change log)
- Earlier memory values (lost)

### Performance and safety

- One item read is followed by about 14 parallel reads. Cap each query: Q1 to 90 batches, audit to 200 rows.
- `import_rows` has no `source_case_code` index; the batch_id prefix keeps the scan bounded. Adding `create index on import_rows(source_case_code, batch_id)` would need a migration, so it is not part of this plan.
- Return no `raw_source` and no `row_data`, only the selected diff fields. Classification is already gated at import.

Expected visibility by role:
- **admin, reviewer:** full timeline. Reviewers see import snapshots because the import read policies allow them.
- **preparer:** no change log or audit. Snapshots only for batches they uploaded. Plus runs, follow-ups, confirmations, memory, escalations, their own evidence.
- **viewer:** item, runs, tasks, confirmations, memory, escalations, tracker logs. No follow-ups, change log, audit or snapshots.
- Viewer and preparer timelines will be thin. Show the `sources` map so the UI can say "Change history is visible to reviewers/admins".

---

## Goal 3: Judgement page counters (exact definitions)

**Data scope for everything on the page.** Rows come from the batch with the newest `source_last_seen_at` **and** `source_year = <current calendar year>` (app/judgement/page.tsx:27-32, 42-43), de-duplicated by id (:54). Records missing from the latest snapshot, and other years, are excluded from every counter but **not deleted**.

Field constraints: `judge` and `km_judge` are constrained to OK/NG/NULL (m119:15, 18). `source_status` is free text.

| Counter (UI) | Location | Exact definition |
|---|---|---|
| KPI **To judge** | judgement-workspace.tsx:352 → `piles.toJudge` (:233-234) | `pileOf` = judge blank **and** `upper(trim(source_status)) === "WORKING"` (lib/judgement/piles.ts:16-18) |
| KPI **Judged** | :353 → `piles.judgedTotal` | `judged + waitingTma`, i.e. **every row with judge set, any source_status** (piles.ts:17, 32) |
| KPI **Awaiting KM** | :354 → `piles.waitingTma` | judge set **and** km_judge blank |
| KPI **Prohibited substances** | :355 → `prohibitedPending` (:228-229) | `isProhibitedLabel(error_type_label)` (:42-46: text matches `prohibited\|restricted\|regulated substance` or `^(error type\|no.)?1[4-8]`) **and** `source_status === "WORKING"` (exact, untrimmed) **and** no judge |
| Prohibited hint "N without CAS" | :230 | **All** prohibited-label rows (any status, judged or not) with blank CAS from raw_source facts |
| KPI **Judged by Miko** | :335, 356 | judge set **and** `assigned_person === "Auto-judgement (System)"` |
| JudgeStats ring **%** and "X of Y judged" | components/judgement-overview.tsx:28-31; lib/judgement/overview.ts:55, 62 | `judged` = rows with truthy judge; `total` = all rows in scope; pct = round(judged/total) |
| JudgeStats "**N to judge**" | overview.ts:29, 41-42 | `source_status === "WORKING"` (exact) && !judge |
| JudgeStats **Awaiting KM** | overview.tsx:41, overview.ts:40 | judge && !km_judge (same as the KPI) |
| JudgeStats **Ready / Your answer / Waiting** | overview.tsx:17-19 | From ReviewDeck `needCounts` (review-deck.tsx:117-121) over server candidates that are `inPendingQueue` (lib/judgement/bulk.ts:98: `source_status === "WORKING" && !judge`), minus cards confirmed in this session. Ready = need "ready". Your answer = destination + check + drawing + **manual**. Waiting = supplier + purchasing + tmc + missing. |
| "Biggest issue" | overview.ts:86-101 | Largest red, then amber, then blue item. Its "answer" item excludes `manual`, which is a separate item. KM = summary.km |
| Progress band | overview.ts:59, 64-69 | OK, NG, To judge (exact WORKING), Other = total − ok − ng − pending |
| Pile **To judge** (miko table) | review-deck.tsx:283, 296; miko-table.tsx:40-41 | Before the deck loads: `piles.toJudge`. After it loads: `open.length` (server candidates still open in this session) |
| Pile **Waiting TMA** | miko-table.tsx:11 | `piles.waitingTma` (= the Awaiting KM KPI) |
| Pile **Judged** | miko-table.tsx:12 | `piles.judged` = judge **and** km_judge both set. **This is not the "Judged" KPI.** |
| Error-type dropdown "(n)" | workspace :244-249 | Exact WORKING && !judge per label |
| "Group identical (n)" | :337, 409 | Visible (filtered) rows with exact WORKING && !judge |
| List tabs | :257-260 | pending = exact WORKING && !judge. judged = judge set. km = pile waitingTma. kmdone = pile judged |

### Why the numbers legitimately differ

1. **"Judged" means two things.** The KPI "Judged" counts every judged row (Waiting TMA + Judged pile, piles.ts:32). The pile "Judged" counts only rows where KM/TMA is also done (miko-table.tsx:12). So KPI Judged = pile Waiting TMA + pile Judged.
2. **Awaiting KM is part of Judged.** It is not additional work. To judge + Judged + Other = total.
3. **Different scopes.** To judge counts WORKING rows only. Judged counts judged rows of any status. Unjudged rows that are not WORKING (closed or accepted in G-CATS) count only in the "Other" band and in the ring's denominator. They appear on no KPI tile.
4. **Prohibited substances** is a subset of To judge, restricted by an error-type label regex covering types 14–18 and the word patterns. It does not include numeric 19, which is HOLD. Its hint (missing CAS) counts over all prohibited rows, including judged ones, so the hint can exceed the tile.
5. **Status normalization differs.** `pileOf` trims and uppercases `source_status` (piles.ts:18). Everything else uses exact `=== "WORKING"`: overview.ts:29, workspace :229/:246/:257/:337, bulk.ts:98. A row with "Working" or "WORKING " counts in the To judge KPI and pile but not in JudgeStats "to judge", the pending tab, the deck, or Prohibited. Judge and KM are database-constrained, so they cannot cause the same drift.
6. **The deck is a session snapshot.** ReviewDeck evaluates candidates once on mount (review-deck.tsx:92-108). Realtime UPDATEs from other users update `rows`, and therefore the KPIs and piles (workspace :193-201), but not `cands`. So the To judge pile and Ready/Your answer/Waiting can lag the To judge KPI until reload. Realtime also does not handle INSERTs from a new import.
7. **Ready + Your answer + Waiting = open deck size.** It is not the To judge KPI, for the reasons in items 5 and 6, and because ids that were not found on the server drop out.
8. **Judged by Miko** is a subset of Judged.

---

## Goal 4: Import safety, checked against the code

**1. Historical snapshots are kept: yes.**
- Preview inserts one `import_batches` row and every source row into `import_rows` (app/api/imports/preview/route.ts:200-206). Nothing deletes them: the only `.delete()` calls in app/lib are approval_recipients (app/api/admin/access/recipients/route.ts:38) and security_throttle (lib/security/throttle.ts:8).
- Commit only flips the batch status to COMMITTED (m155:132).
- Caveat: `gcat_error_items.raw_source`, `last_comment`, `source_*`, `source_batch_id` and `gcat_cases.raw_source` hold only the latest snapshot and are overwritten (m155:96-98, 113-119). Per-item history lives only in `import_rows`, which is readable by the uploader, admin and reviewer only (m048:327, 330).

**2. Missing records are never deleted: yes.**
- `commit_import_batch` contains only INSERT … ON CONFLICT DO UPDATE and loops over rows in the batch (m155:82-131). There is no DELETE and no "not in batch" step.
- An absent row keeps its old `source_batch_id` and `source_last_seen_at`.
- Caveat: the Judgement page shows only rows from the newest batch (page.tsx:42), so missing rows disappear from that screen and its counters while remaining in the database.
- FK cascades exist (`gcat_error_items.case_id → gcat_cases` on delete cascade, m048:133; `import_rows → import_batches`, m048:77; `register_change_log → items`, m119:34). They fire only on a manual SQL delete; no app path performs one.

**3. Judgement edits are never overwritten: true only for fields flagged as overridden.**
- On conflict, each of the 9 judgement fields keeps the stored value when its `*_override` flag is true. Otherwise it takes the source value, including NULL (m155:120-128). `judge_status` follows `judge_override` (m155:116).
- Flags are set by:
  - PATCH: only for fields whose value actually changed (app/api/register/[id]/route.ts:54-56), plus `last_change_date_override` always (:58-59).
  - Bulk apply and undo: all six fields (bulk/route.ts:111-113, 158-160).
  - Autorun final and reopen (autorun/route.ts:138-139, 97).
  - Bulk preparation (m202:60-67).
- **Gap 1:** if a user saves a judge or comment equal to the current source-derived value (for example confirming an imported OK unchanged), no override flag is set. A later export with a different or blank cell **will overwrite or NULL it**.
- **Gap 2:** the import bypasses the guard trigger (`set_config('app.gcat_import_batch', …, true)` at m155:80; bypass at m155:31). The OK/NG comment requirement is therefore not enforced for imported values.
- **Gap 3:** there is no recency check. Committing an older workbook after a newer one rolls back source fields and non-overridden judgement fields. Because `source_last_seen_at` becomes now(), the older batch then becomes "latest" for the Judgement page (page.tsx:27-32). The MD-System tracker import does have a stale guard (import-md-system/route.ts:421); the G-CATS import does not.
- **Gap 4:** duplicate `code` values within one workbook silently collapse into one item (see Goal 1, item 12).

---

## Side findings (security or correctness, outside the brief, worth a separate fix)

1. **Probable guard-trigger bypass on pooled connections.** `guard_gcat_judgement_columns` returns early when `current_setting('app.gcat_import_batch', true) is not null` (m155:31). After a transaction-local `set_config` (m155:80), PostgreSQL returns `''`, not NULL, for that placeholder setting for the rest of the session. A PostgREST connection reused after any import commit would therefore skip the KM-role and OK/NG-comment checks for later updates on that connection. A preparer calling the Data API directly could then set `km_judge`. Verify with a test. The fix needs a migration: `coalesce(current_setting(…, true), '') <> ''`.
2. **Tables readable by every authenticated user, including the supplier role** (`using (true)`): `judgement_runs`, `approvals`, `verification_tasks`, `confirmations` and rule tables (m048:340-353, 358).
3. `app/api/register/[id]/route.ts:41-51` contains a duplicated block (identical "Who judged" logic twice). It is harmless.
4. Two different `partKey` normalizations are in use:
   - lib/judgement/memory.ts:20 keeps hyphens. It is used by judgement_memory and escalations.
   - lib/intake/keys.ts strips `- _ / .`. It is used by supplier_confirmations.

   A history endpoint must use the right one per table.
5. The comment at review-deck.tsx:219 claims a "full trace" for the bulk-apply save path. No `judgement_runs` row is written on that path.
6. `.github/workflows/` contains a stale copy of `app/`, `supabase/` and docs.

---

## Summary of history sources available today

- **Per-item, timestamped, with before/after:** `register_change_log` (admin and reviewer only) and `audit_events` with `entity_id = itemId` (admin, reviewer, rule_approver).
- **Per-snapshot source history:** `import_rows` joined to `import_batches` by `source_case_code = source_record_key` (uploader, admin, reviewer). This is the only record of import-driven changes and of earlier G-CATS "Comment(last time)" values.
- **Per-case:** `judgement_runs` and `approvals` (traces only from the single-case save path); `evidence` and `verification_tasks`.
- **Per-item supplier contact:** `supplier_followups` and `sync_outbox`.
- **Per-part:** `supplier_confirmations` (append-only), `judgement_memory` (latest value only), `judgement_escalations.history` (last 50), `supplier_prechecks`.
- **Supplier-level only:** `imds_tracker_followup_logs`.
- **Not recorded:** import-driven field changes as discrete events, earlier memory values, traces for bulk/auto/editor saves, the time a result was entered into G-CATS, and part links for tracker e-mails.
