# Tracker hardening — phase 1

Baseline 217781ed73da99e993b46223700fbc9d290361f1. Tracker-only changes. No database migration or provider activation.

- Stop directory saves after a version conflict; retain local edits and require backup/reconciliation. This is containment, not a full three-way merge.
- Stop persisting shared master snapshots in IndexedDB, remove the legacy cache on startup, and obtain authenticated network data. Legacy directory/browser storage still requires a separate migration.
- Block live composer sends when the source is not current; scheduled runs fail closed when history or attempt logging fails. Prefer stable supplier code for cooldown with legacy name fallback.
- Explicitly label unprocessed budget-exceeded work; durable queue and recovery are not implemented.
- Tracker-scoped keyboard focus and responsive typography adjustments.

## Remaining gates
Repository public visibility needs owner review; do not put real data in fixtures. Durable claims/outbox, delivery state migration, directory merge UI, authenticated E2E, server-generated reports, native WA directory/consent and React migration remain open. No production sending or migration from this PR. Rollback: revert this commit. Existing Judgement paths and shared Power Automate contract untouched.
