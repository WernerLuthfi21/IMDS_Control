# Architecture

## Runtime

- Next.js App Router: server-rendered register pages and route handlers.
- React + TypeScript: compact enterprise workspace and form state.
- Supabase Auth: user identity; new accounts receive `viewer` by default.
- PostgreSQL: source cases, error items, AO–AW judgement fields, import batches/snapshots, suppliers, pre-checks, follow-ups, tasks, evidence, rule versions and audit events.
- Supabase Storage: private buckets for import staging, supplier pre-check attachments and evidence.
- ExcelJS: server-side XLSX/CSV preview and field mapping.
- Decimal.js: decimal-safe mass comparisons.
- Playwright / Vitest: E2E and unit test suites.

## Main data flows

1. **G-CATS daily import**: user uploads workbook to a private staging bucket → server detects the Error Log sheet/header → preview normalizes fields and retains raw row JSON → user confirms → PostgreSQL RPC commits the snapshot and merges source fields into the editable register.
2. **Judgement editing**: operator updates only the desired AO–AW values → API checks identity/role and OK/NG comment rules → field-level override flags protect explicit website edits from later imports → change log and audit event are written.
3. **Historical suggestions**: server queries exact Error Type and independent same-part/supplier/CAS contexts → groups repeated procedure strings → displays ranked suggestions without auto-deciding.
4. **Bulk preparation**: internal user selects same-label Error Type rows → API confirms all selected items share one exact label → writes Assigned person/start date/procedure and field-level overrides → no Judge or KM decision is changed.
5. **Supplier pre-check**: supplier enters fields or uploads XLSX/CSV to private storage → server maps known headers into editable preview → submission is recorded → internal reviewer checks source → only reviewer/admin can clear after confirming original MDS status/final version in IMDS.
6. **Supplier follow-up**: internal preparer selects a stored PIC → API records a portal notification and Outlook compose payload → user reviews and sends the draft manually.
7. **Evidence**: case-specific task is created → file is uploaded by a signed URL to private storage → server verifies object existence and registers source page/sheet/row metadata.

## Identity and merge strategy

- `code` is the preferred stable identity from the G-CATS Error Log source.
- `No.` is a daily sequence and is not used as identity.
- If no code exists, import fallback uses a file-hash + sheet + row token. Reordered rows in a new file may become new observations rather than risking a false merge.
- Each upload is retained as an `import_batches` and `import_rows` snapshot.
- Rows absent from the latest file are preserved; there is no destructive delete-by-absence.
- Per-field override flags distinguish website-edited judgement values from source values and control later import refresh.

## Deployment profiles

- Local preview: no persistent data; packaged reference and evaluator only.
- Persistent local development: Docker + Supabase CLI.
- Initial personal hosting: Vercel web frontend + private Supabase project.
- Future self-host: Docker web container and independently provisioned self-hosted Supabase-compatible Auth/PostgreSQL/Storage endpoint.

The web app does not depend on Vercel-specific database/storage features. The Docker Compose file runs the web app only; it does not bundle the full Supabase stack.

## Trust boundaries

- No service-role key is sent to the browser.
- API routes and RLS enforce role and record access.
- CONFIDENTIAL and UNKNOWN sources are blocked by the import/upload path and must not be introduced through source code, prompts, tests, logs or reference data.
- The supplier portal is isolated by the supplier code on the authenticated profile and RLS. Supplier attachments use private storage and short-lived signed retrieval URLs.
- Bulk preparation runs as `SECURITY INVOKER`; reviewer update access is RLS-scoped and KM field changes remain trigger-restricted to reviewer/admin.
- The MDS Report PDF sample is attachment-only; parsing is deliberately disabled.
- Outlook is an editable deep link, not an email-send integration.
- External IMDS/G-CATS API, SEND and ACCEPTED/REJECTED synchronization are not implemented.
