# Implementation status — v0.2.2

## Product direction

The primary workspace is the Judgement Register. It is designed around the nine operational G-CATS fields AO–AW rather than a chart-first dashboard.

## Included in this delivery

- Compact register page: search, Error Type filter, paging, record detail and source identity.
- Supplier-facing portal route and role isolation for the supplier pre-check workflow.
- AO–AW editor; reviewer/admin-only KM Judge and KM Comment; per-field website override markers; last-change timestamp and audit history.
- Historical judgement procedure suggestions using independent same-Error-Type, same-part, same-supplier and same-CAS queries.
- Bulk preparation for 2–100 records with the same exact historical Error Type label; can set Assigned person, starting date and procedure only. It cannot apply Judge/KM Judge/comment decisions.
- Daily G-CATS workbook import preview and commit; `code` preferred identity; `No.` excluded as a row identity; no-code cautious file-hash/sheet/row fallback.
- Import batch snapshots, source provenance, comparison counts and source warning labels. Missing rows are preserved; they are not physically deleted.
- Import merge preserves website field overrides and refreshes fields not explicitly overridden.
- Local/OneDrive-synced file change detection via browser File System Access API while the tab is open; manual preview and commit remain mandatory.
- Excel export as a report copy. Direct write-back to local Excel or SharePoint is not implemented.
- Supplier pre-check: manual fields or XLSX/CSV first-sheet header extraction into an editable preview; supplier submissions; internal review; reviewer/admin clearance requires human verification, internally released/final status, IMDS ID and version.
- PDF attachment-only path; the supplied MDS Report PDF is not parsed because its own front page prohibits parsing.
- Supplier PIC contacts; in-app notification record and editable Outlook web compose draft. Automatic email sending through Microsoft Graph is not implemented.
- Supplier attachment retrieval uses a short-lived private-storage signed URL and owner/internal-role checks.
- Evidence/tasks with private Storage and provenance fields; case context carried from the Judgement Detail page.
- CAS/GADSL 2026 V1 and TSZ Appendix 3–6 packaged lookup data.
- Rule evaluator, decision trace, reference provenance, HOLD/manual review guardrails, approval queue and database migrations.
- Docker self-host packaging, Next.js/Vercel project configuration, Vitest and Playwright test sources.

## Not implemented / requires external configuration

- Direct IMDS API or G-CATS API integration; no automatic G-CATS SEND, ACCEPTED or REJECTED synchronization.
- Automatic Excel write-back / live SharePoint workbook editing.
- Microsoft Graph send, inbox webhooks, supplier emails sent by background jobs or message-delivery tracking.
- A scheduled server-side watcher of OneDrive files; current file watcher is browser-tab-scoped only.
- Full parsing of every sheet in the Master workbook; daily import targets `G-CATS Error Log Master Data` or compatible Error Check Log layout.
- Automatic parsing of MDS Report PDFs; prohibited by the supplied sample report's notice.
- Rule-authoring and rule-version approval interface is partial; most rules remain draft/manual review. Numeric Error Type 19 is permanently held until source owner reconciliation.
- Automatic final OK/NG, bulk final decisions or automatic KM review.
- Owner-verified interpretation of TSZ2900G Rev.9, TSZ0001G full standard, TSZ6000G destination table or missing official V6 PDFs.
- Microsoft Graph send and Excel/SharePoint write-back remain unimplemented and require external tenant consent and server-side OAuth code.
- Vercel deployment is not yet live; team consent and private Git repository connection are still required.

## Source data boundaries

- Master workbook is used as the source for the historical distribution and import schema. Supplier/part-level rows are not seeded in the repository; the user must import the allowed source file through the secured app.
- The 19 historical Error Type labels remain distinct from the official 23-number catalogue.
- Historical nonstandard Judge/KM labels are retained as source text and not coerced into an OK/NG decision.
- The source `code` field is used as the preferred record key; daily `No.` is a sequence only.

## Validation status

- TypeScript/TSX transpile syntax and JSON parsing checks were performed during packaging.
- No successful `npm install` occurred in this build environment due to package registry access/timeout; therefore full TypeScript typecheck, ESLint, Vitest execution, Playwright E2E and Next.js production build are not claimed as passing.
- Eight Supabase migrations have been applied to the dedicated `toyota-imds-gcats-control` project (`thjntzkidfsydaiiwbyn`, `ap-southeast-1`). A live check confirmed 21/21 public tables have RLS enabled, all three Storage buckets are private, and key RPCs are not executable by `anon`. The two callable SECURITY DEFINER RPCs are intentional (`commit_import_batch` and `approve_judgement`) and retain role/ownership/reviewer checks; Supabase security advisor still warns about these privileged RPCs. Performance advisor warnings remain for policy composition/init-plan patterns.
- The import routes are implemented, but the Master Data workbook and daily G-CATS export have not been successfully previewed/committed through the running app.
- No Vercel deployment exists yet. Vercel team consent and connecting a private Git repository are still required.

This is a development release, not a Toyota-approved or production-certified judgement platform.

## Supplier self-check intake and saved confirmations (Nov 2026)

- `components/supplier-selfcheck.tsx`: drag XLSX/CSV, paste cells copied from Excel, or attach a PDF. PDFs are attachment-only (the MDS Report states parsing is not allowed) and are linked to a part number through the existing pre-check endpoint.
- `lib/intake/*`: table parsing, header/column detection with per-column confidence (ambiguous or duplicate columns are flagged, never merged), CAS checksum + Excel date-conversion detection, ppm/%/decimal-comma handling, and per-row analysis through `runAutoWorkflow`. Destination (Toyota-owned) is never guessed: results are shown per destination or as "depends on destination".
- `POST /api/self-check/analyze` and `/parse-file` are read-only. `POST /api/self-check/confirm` stores supplier answers in `supplier_confirmations` (migration `20261106000000_supplier_confirmations.sql`, append-only, RLS: supplier writes own code only).
- `/api/judgement/auto` reads the latest confirmation for the same supplier code + part key + family + CAS and applies it automatically as a "Supplier confirmation on file" step. It is self-reported; the reviewer still saves OK/NG.
- Admin: Settings → Team & access edits display name, role and supplier code (`PATCH /api/admin/profiles/[id]`, RLS `profiles_update_admin`).
- Migration must be applied to the remote project by the owner (not applied from the sandbox). Until then saving shows a clear error and the admin side behaves as "no confirmation".

## Error Type 24, more automated flows, SharePoint read (Nov 2026)
- Application44ERROR is numbered **24** in this application (user directive 2026-11-06; Appendix I lists it as 19). No.19 stays Prohibited substance(Benzene) and numeric 19 stays HOLD until the process owner confirms. Rule id is now `RULE-APP24-APPLICATION44`; older `judgement_runs` rows keep the old id string.
- New automated flows (V5.1.10 Appendix II): Application Code 71 (Pb in aluminium), Cl-paraffins/SCCP, and 16 No.14 flows that share the standard chart (`data/reference/gcats-v5110-t1-flows.json`). Still HOLD with a PDF page: Arsenic, Benzidine/azo, glycols, HFC, nitrosamines, PFOA, PBDE, aziridinyl, BNST, Benzene, DMF, perchlorate, PAH, UV-328, dioxane, perborate, and members of "all members" families whose CAS is not listed.
- SMS Mass and Application44ERROR use the saved supplier confirmation (migration `20261106000100`).
- SharePoint: read-only fetch of one master workbook into the import preview (see `docs/SHAREPOINT_SETUP.md`). Write-back and push real time are NOT implemented.


## Power Automate bridge
- Implemented (outbox, dispatcher, bulk sequential supplier e-mail, Excel upsert on every register save). **NOT TESTED** against a real flow; migration 20261106000300 not applied remotely. See `docs/POWER_AUTOMATE_SETUP.md`.
