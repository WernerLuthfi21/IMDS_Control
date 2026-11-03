# IMDS / G-CATS Judgement Register

A full-stack development application to centralize Toyota G-CATS Error Log work, maintain the nine AO–AW judgement fields, compare daily Error Check Log snapshots, reuse historical procedures, and support a supplier-side pre-check workflow.

> **Status:** development release v0.2.2. This is not a Toyota-approved decision system and is not connected to the live IMDS or G-CATS systems. Human verification and approval remain mandatory. Some source branches remain HOLD / MANUAL REVIEW.

## Product focus

The main screen is the **Judgement Register**. It is not a KPI-first dashboard. Each imported G-CATS record carries source identity, Error Type, part/supplier information, source sheet/row and the operational judgement fields:

- Assigned person
- The starting date
- Judgment procedure
- Judge (OK/NG)
- Comment of Record of changing to “OK” (Required)
- IMDS Reject comment
- KM Judge (OK/NG)
- KM Comment
- Last Change Date

The TMA KM fields are role-restricted to reviewer/admin. Bulk preparation can apply Assigned person, starting date and a common procedure to selected records with the same exact Error Type. Bulk actions cannot set Judge or KM Judge.

## Implemented capabilities

- Compact, responsive Judgement Register with search, Error Type filter, pagination and record detail editor.
- Nine-field AO–AW register editor; field-level website override tracking; audit/change history writes.
- Historical procedure suggestions grouped from imported records and ranked by exact part, CAS and supplier context.
- Bulk preparation for repeated Error Type records (assignment, start date and procedure only).
- Daily G-CATS workbook staging, preview, comparison and manual commit; source `code` is the preferred stable key, never daily `No.`.
- Safe refresh semantics: each upload remains an import snapshot; missing rows are not physically deleted; explicit website field edits are protected from later source refreshes.
- Export to Excel as a read-only report copy. The website database is the canonical editable register; it does not silently write back to a local Excel file.
- Browser-side local/OneDrive-synced workbook change detection while the tab remains open (File System Access API); detection is not background sync and commit remains manual.
- Supplier pre-check workspace: manual entry or XLSX/CSV header-based field extraction; previewed values remain editable; PDF is attachment-only.
- Internal supplier pre-check review workflow; only reviewer/admin can clear for IMDS after explicit human source verification, internally released status, final/non-preliminary MDS, IMDS ID and version.
- Supplier PIC contact directory, in-app portal notification record and editable Outlook compose draft. Email is not sent automatically.
- Evidence/tasks with private storage and source page/sheet/row provenance.
- CAS / GADSL 2026 V1 and TSZ Appendix 3–6 reference lookup.
- Rule evaluator with decision trace and HOLD / MANUAL REVIEW guardrails; final judgement remains human-controlled.
- Supabase PostgreSQL migrations, RLS, audit tables, Docker self-host packaging and Playwright/Vitest test sources.

## Quick start (Windows PowerShell)

Requirements: Node.js 22.16.0+ (Node 22 LTS is recommended) and npm 11.21.1+.

```powershell
npm install -g npm@11.21.1
npm -v
npm install
Copy-Item .env.example .env.local
npm run dev
```

Open `http://localhost:3000` in a browser after Next.js prints its Local URL. Do not type the URL as a PowerShell command.

Without Supabase credentials the app only supports a limited local preview: packaged references and evaluator can be exercised, but persistent register, imports, accounts, evidence, supplier submissions and approvals require Supabase.

## Supabase local development

Install Docker Desktop and Supabase CLI, then run:

```powershell
npx supabase start
npx supabase db reset
```

Copy the local Supabase API URL and publishable/anon key to `.env.local`:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_LOCAL_PUBLISHABLE_OR_ANON_KEY
MAX_IMPORT_FILE_MB=20
```

Create a user through Supabase Auth. New users default to `viewer`. Promote an authorized initial administrator through the SQL editor:

```sql
update public.profiles set role = 'admin' where email = 'admin@example.com';
```

Apply all migrations with `npx supabase db reset` on a fresh local database. Do not put service-role keys in browser variables.

## Daily G-CATS update

1. Sign in as `preparer` or `admin`.
2. Open **Daily G-CATS Update** and upload the latest Error Check Log `.xlsx`.
3. Select the source classification. `CONFIDENTIAL` and `UNKNOWN` are blocked.
4. Review source sheet, header row, field detection, row counts, new/refresh/same-snapshot comparison and warnings.
5. Commit only after review.

The importer targets `G-CATS Error Log Master Data` or a compatible Error Check Log layout. The Master Data workbook has multiple separate sheets; this importer does not merge all sheets into one table. `code` is used as the stable source identity where present. `No.` is a repeating display sequence and is never used as an identity. Rows without `code` use a cautious file-hash + sheet + row fallback; row movement may create a new row rather than risk a false merge.

Each batch is stored as a snapshot. Missing records are retained in the register; they are not physically deleted just because they are absent from a later export. Website-edited AO–AW fields are protected by per-field override flags.

## Excel and OneDrive behavior

The optional browser file connection can detect changes to a locally accessible workbook (including a OneDrive-synced file) while the application tab is open and permission remains granted. This is **change detection**, not a server-side scheduled sync. The app stages and previews each changed file before manual commit.

Excel export is a read-only report copy. There is no direct write-back to a local workbook or SharePoint workbook. Microsoft Graph write-back would require an approved integration and `Files.ReadWrite` permission.

## Supplier pre-check

The supplier page supports manual data entry or XLSX/CSV drag-and-drop. A preview scans common headers and maps supplier code/name, part number/name, IMDS ID/version, MDS status and preliminary status into an editable form. The supplier must check the values before submission.

The supplied MDS Report PDF explicitly states that parsing is not allowed. Therefore PDF is permitted only as an attachment for authorized human review; the application will not parse its contents. A file upload or self-reported “Internally released” value does not prove source state. Internal review must verify the original MDS in IMDS. Only reviewer/admin can clear a submission for IMDS after the explicit check.

## Supplier follow-up / Outlook

Internal users can select a supplier PIC from the contact directory, create an in-app portal notification and open an editable Outlook compose draft with recipient, CC, subject and body. The application does not claim the message was sent. Automatic send through Microsoft Graph is not included and requires Microsoft tenant/IT consent.

## Rules and data limitations

- Historical Error Type labels are preserved exactly and not silently mapped to the official 23-number catalogue.
- Numeric Error Type 19 remains HOLD because the supplied Version 6 source conflicts between Section II and Appendix I.
- Historical labels such as `Battery (Pb)`, `Battery (Cd)`, `Tokusetsu Part number` and `Prohibited substance(SCCP)` remain historical-only until an owner-approved mapping exists.
- TSZ2900 tolerance values extracted from the workbook are reference-only pending controlled TSZ2900G Rev.9 verification.
- Error Type 8 mass deviation is not automatically evaluated until the denominator/rounding basis is approved.
- Substance-specific branches require the exact CAS, GADSL/TSZ membership, family flow, use context and destination; no universal limit is invented.
- G-CATS SEND / ACCEPTED / REJECTED is not automated. The tool does not connect to IMDS or G-CATS production.

## Deployment

Initial personal deployment target: Vercel + a private Supabase project. Keep this repository private unless all code/data references and redistribution rights have been cleared. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and any required operational environment variables in Vercel. Apply migrations to the intended database and configure Supabase Auth redirect URLs.

For future self-hosting, `Dockerfile` and `docker-compose.yml` package the web application. A separate Supabase-compatible PostgreSQL/Auth/Storage endpoint is still required; the Compose file does not bundle the full Supabase stack.

## Validation status

The source package includes Vitest and Playwright tests. Eight database migrations have been applied to the dedicated Supabase project and 21/21 public tables were verified with RLS enabled. However, the build environment did not complete `npm install` because the package registry timed out. A full Next.js production build, full typecheck, lint, unit-test run, E2E run, and import preview/commit using both supplied Master Data and a daily G-CATS export have **not** passed. No Vercel deployment has been published yet. Review `docs/DEPLOYMENT_AND_CLAUDE_GUIDE_ID.md` for the deployment handover and exact remaining blockers.

See `docs/IMPLEMENTATION_STATUS.md`, `docs/USER_GUIDE.md`, `docs/SOURCE_REGISTER.md`, `docs/RULE_COVERAGE.md`, `docs/API_SPEC.md` and `docs/SECURITY.md`.
