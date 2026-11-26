# Tracker hardening — phase 1

Baseline 217781ed73da99e993b46223700fbc9d290361f1. Tracker-only changes. No database migration or provider activation.

- Stop directory saves after a version conflict; retain local edits and require backup/reconciliation. This is containment, not a full three-way merge.
- Stop persisting shared master snapshots in IndexedDB, remove the legacy cache on startup, and obtain authenticated network data. Legacy directory/browser storage still requires a separate migration.
- Block live composer sends when the source is not current; scheduled runs fail closed when history or attempt logging fails. Prefer stable supplier code for cooldown with legacy name fallback.
- Explicitly label unprocessed budget-exceeded work; durable queue and recovery are not implemented.
- Tracker-scoped keyboard focus and responsive typography adjustments.

## Remaining gates
Repository public visibility needs owner review; do not put real data in fixtures. Durable claims/outbox, delivery state migration, directory merge UI, authenticated E2E, server-generated reports, native WA directory/consent and React migration remain open. No production sending or migration from this PR. Rollback: revert this commit. Existing Judgement paths and shared Power Automate contract untouched.

## Integrated communication workspace
Native Tracker WhatsApp tab with explicit country normalization, direct PIC selection only from a successfully loaded directory, per-message consent attestation and re-review, masked session queue, copy/open/manual reported state. No provider calls, persistent consent or receipts. New fixture E2E covers consent reset, local number rejection without country, queue and manual confirmation. Added keyboard navigation and safe handling of missing settings or oversized master snapshots. Full migration and DB-backed automation remain release-gated.

## Further data and dispatch checks
Directory waits for authenticated settings load and refuses automatic upload of unverified legacy local data; retains dirty state if edits arrive during a save. Master source errors, partial snapshots and contact truncation are explicit. Non-recap live mail must reference current shared master parts belonging to the selected supplier; live supplier PDF is generated on the server from validated parts (the legacy browser PDF remains available for draft/test). This intentionally changes live PDF formatting to prioritize isolation. Custom recipient overrides, recap policy, durable delivery states and authenticated data tests remain pending approval/verification.

## React migration workbench
Authenticated parallel `/tracker-workbench` route, scoped CSS module and existing Next fonts, system/light/dark preferences. Read-only master metrics, filters, grouped model/supplier/action queue, exception list, master contact coverage, report scope, sanitized recent email attempts, integration readiness. All mutations and legacy reports use existing Tracker routes. No cutover: row metrics are stored-row based, not yet proven equivalent to legacy deduplication or browser defaults. No provider activation. Added unit tests for status, vendor grouping and date validity. Shared AppShell change is limited to exact preview path; existing Judgement routes retain original shell.

## Automation foundation and release blocker
Tracker-scoped same-origin guards for send and schedule endpoints; outcome classification distinguishes handoff, provider acceptance, permanent rejection and ambiguous failure. Existing database status columns remain compatible; explicit outcome is stored in provider_response. State-transition unit tests included. SQL candidate in docs/tracker-outbox-candidate.sql describes unique runs/jobs, atomic claim, fencing, append-only outcome events and quarantine recovery. It is NOT applied or wired to live dispatch; consent policy, approvals, cross-channel reservations and real database tests are required. Linked migration metadata diverges from repository (remote-only versions and local versions not listed remotely); no schema changes or reset. System theme and early theme selection added to legacy Tracker.
