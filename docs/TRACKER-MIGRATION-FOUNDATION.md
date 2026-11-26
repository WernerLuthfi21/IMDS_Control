# Stage 8 — Tracker migration foundation
Baseline: main `217781e`, migration checkpoint `ac85b9d`, reference PR #91 `27f9904`. The temporary `/tracker-migration` route uses AppShell, scoped Violet Liquid Glass tokens and the original three cube geometry. Its appearance initially inherits an explicit legacy `imds-theme` preference and otherwise follows System. Tracker appearance changes write only `imds-tracker-theme`. The skip link preserves the selected view. Standalone packaging includes both private legacy runtime files.
 
The dev-only /tracker-migration/fixture is enabled only by TRACKER_TEST_FIXTURE=1 with NODE_ENV=development and no Supabase configuration; it contains synthetic local controls, no session impersonation and no provider/database calls. It is not an authenticated test. CI screenshots from this fixture are not baseline authenticated screenshots.
 
Stage 9 must migrate actual view contents and preserve all old functions, query/hash compatibility and source-state behavior. No route cutover, provider activation, permission changes, schema changes or real sends. Rollback: abandon/revert this branch; /imds-tracker and all API paths remain unchanged. Review public-repository classification before any protected fixture or data is introduced.

## Stage 9A checkpoint

Overview and Model Tracker render in React and TypeScript in the existing AppShell. They read the original `tracker-data` and `due_dates` APIs, with the legacy model IDs, duplicate consolidation, status precedence, dates, model health and browser recap format. The comparison fixture has ten source rows, nine consolidated rows, two excluded exceptions, four submitted out of seven active parts, and two priority suppliers. The existing route still owns the manual workbook and Graph sources, reports, supplier editing and composer. Shared-master rows stay in preview memory. The preview reads existing model preferences and recap history, and saves recaps to the existing format. Synthetic recaps use a fixture-only key.

Preview links preserve the model/status scope in the legacy Tracker. The existing Reports view focuses its PDF control. The existing Follow-up view opens its composer for a reminder or recap. The handoff carries no send, download or commit command.

| Stage | Views | Evidence and remaining work |
| --- | --- | --- |
| 8 | Shell, theme, mascot | Mode isolation, before-hydration theme, skip-link focus and nested tabs covered by Playwright. |
| 9A | Overview, Model Tracker | Synthetic shared-master comparison covers all five KPIs, model order, supplier priorities, drill-down, focus, contrast and responsive widths. Source imports and communication continue through the legacy handoffs below. |
| 9B | Suppliers, Directory | Supplier lookup and scoped legacy navigation are available. Native filters, drawer, dates, edits, imports, contact strata, matching, backup and restore still need parity. |
| 9C | Check, Reports | Legacy screens own triage, stop/restore log, report options, validation, PDF/XLSX and report sorting. Native views and generated-file comparison are pending. |
| 9D | History, Settings | Overview can save compatible recaps. Native history comparisons and settings for deadlines, display, imports, reconnect and sync are pending. |
| 9E | Follow-up | Legacy composer handoff works. Native queues, recipients, templates, attachments, automation, previews and draft/send contract comparison are pending. |

## PR #91 reconciliation

| Commit | Disposition |
| --- | --- |
| `6d41c5c` | Take the Tracker-only focus and typography patterns into the React presentation. Assess version conflicts, stale-cache policy, dispatch refresh, history errors and cooldown identity in Stage 10. |
| `a84e45a` | Reuse keyboard and compact-layout patterns. Preserve the baseline manual WhatsApp link. Review the added consent and manual queue in Stage 10. |
| `3da5175` | Test source completeness and attachment ownership in Stage 10. Moving supplier PDF generation server-side changes the visible PDF and needs its own comparison and decision. |
| `37c4263` | Keep AppShell and legacy-parity TS read model on the active preview route. Workbench row counts use different duplicate semantics. |
| `ce3a544` | Use isolated, before-hydration System preference. Review same-origin guards, dispatch outcomes and outbox candidate independently in Stage 10. |
| `ee60a3e` | Review report snapshot semantics as a separate hardening decision. Scheduler time budgets and uncertain outcomes belong in Stage 10. |
| `2dc2817` | Wire migration UI to the existing versioned due-date API. Recipient restrictions and required explicit version/origin checks belong in Stage 10. |
| `27f9904` | Test exact supplier-name lookup, wildcard characters and duplicate vendor codes with synthetic data before adopting recipient scope in Stage 10. |

## Stage 10 preparation · Functional hardening

Scope this in its own PR after owner approval. Establish phase zero with a synthetic directory and synthetic source snapshots. Keep Excel write-back outbox identity separate from communication job identity.

1. Document data authority by field for the shared master, workbook import and reverse sync, Directory, attachment library and settings. Define the expected version at import, merge, confirmation and write. Cover concurrent writers, failed/paginated source reads and a second browser with stale state.
2. Define a persistent run keyed by automation and intended WIB slot, and jobs keyed by run, stable supplier/contact identities, channel and purpose. Pin the approved scope, template revision, attachment identity and recipient scope. Record append-only outcomes using a job and attempt identity. Keep sensitive message bodies and contacts out of diagnostics.
3. Use atomic claims and cooldown reservations. Fence completion and recovery by claim token, handle lease expiry and retry only when the result proves that no handoff occurred. Quarantine ambiguous failures for operator reconciliation. Keep handoff, provider acceptance and human-reported outcome distinct.
4. Validate exact recipient scope, current contacts, consent, opt-out, purpose and cooldown when queuing and immediately before handoff. Prove that duplicate triggers and parallel workers cannot dispatch twice. Account for past name-keyed history during migration to stable supplier identifiers.
5. Keep WhatsApp manual through a user-reviewed draft and explicit open/copy. Require a selected contact and recorded consent, track an operator-reported outcome, allow cancel/recovery, and retain an audit trail. Test with fake contact data and a stubbed action handler.
6. Review the proposed outbox SQL and grants from PR #91 separately. Validate constrained status transitions, service-role-only worker operations, RLS, queue recovery and rollback on an isolated database before proposing any production change. Keep the current Power Automate payload and HTTP 202 handoff semantics.

## Stage 11 preparation · Verification and reversible cutover

1. Build a fixture matrix for authenticated admin, preparer, reviewer, viewer, supplier and signed-out sessions. Include duplicate/empty/unknown rows, hidden and unassigned models, overwritten and missing dates, Directory conflicts, scope mismatches, no-consent recipients and ambiguous scheduler outcomes. Cover existing negative permissions and unchanged Judgement navigation and behavior.
2. Compare the exact legacy and React results from the same fixture per view, including counts, ordering, scope, part IDs, rounding, handoff payload, labeled statuses and file bytes where deterministic. Compare PDF pages/text and XLSX cell values/sheets where metadata varies. Test all source connection and storage schemas with pre-existing browser data.
3. Capture desktop, tablet and mobile with explicit Light and Dark and with System after OS change. Record first paint, keyboard access, focus return, nested tabs and draft retention, contrast failures and document-level overflow. Make screenshots and payload checks reproducible and label synthetic data.
4. Require a passing migration matrix plus green install, typecheck, lint, tests, build and E2E on the exact branch head. Obtain the owner's sign-off on the remaining UI, data and provider gates.
5. Propose an opt-in same-origin route switch after parity. Keep a protected, directly accessible legacy route and forward existing query and hash values. Verify that page-level polling and automation do not run twice. Keep API paths, browser storage and server authority compatible so traffic can return immediately.
6. Rollback trigger: broken role isolation, incorrect counts/files, failed writes, duplicate handoff or any parity regression. Disable the approved route switch, direct people to legacy, and verify both the role gate and the canonical legacy response. Keep new writes and audit history available for reconciliation. The pre-cutover rollback is to revert or discard the migration commits.

Release status: **NO-GO for canonical cutover** while native 9B–9E workflows, protected role coverage, and full contract parity remain open.
