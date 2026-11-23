# Architecture

## Runtime

- **Next.js 16 App Router + TypeScript**: server components by default, route handlers under `app/api`.
- **Supabase**: Auth (SSR with `@supabase/ssr`, publishable key + RLS), PostgreSQL (migrations in `supabase/migrations/`),
  private Storage buckets (import staging, supplier attachments, evidence).
- **IMDS Tracker**: `private/imds-tracker.html` + `private/shared-master-sync.js`, served by `app/imds-tracker/route.ts`
  behind the same login. Its UI is approved; changes are fixes and integration only.
- Libraries: ExcelJS (workbook preview/export), Decimal.js (mass), Vitest (unit), Playwright (E2E + contrast audit).

## Modules (one login, one shell)

| Module | Route | Main code |
|---|---|---|
| Judgement: Judge table (Miko, decks per Error Type, piles To Judge / Waiting TMA / Judged, auto-judge panel), All cases, G-CATS Detail for TMA | `/judgement` | `components/judgement-workspace.tsx`, `lib/judgement/*` |
| Daily G-CATS Update (import, preview, commit, SharePoint fetch) | `/daily-update` | `components/import-workbook.tsx`, `app/api/imports/*` |
| Supplier Pre-check / Self-check | `/supplier-precheck` | `components/supplier-selfcheck.tsx`, `app/api/self-check/*`, `app/api/prechecks/*` |
| Supplier Follow-up and Power Automate panel | `/follow-up` | `lib/followup/*`, `app/api/automation/*` |
| Substance References (CAS / GADSL / TSZ) | `/substances` | `lib/reference-data.ts`, `lib/cas.ts` |
| Judgement Rules: flow charts + error types & sources | `/rules` | `components/flow-library.tsx`, `lib/judgement/flows.ts` |
| Settings (account, judgement, tracker, team & access, system) | `/settings` | `components/settings-tabs.tsx` |
| IMDS Tracker (purple) | `/imds-tracker` | `private/*`, `app/api/imds-master/*` |

Command palette: Ctrl/⌘ K (modules, part / CAS / supplier search, theme).

## Judgement logic

- `lib/judgement/engine.ts`: deterministic checks (mass with Decimal.js, comments, HOLD guardrails).
- `lib/judgement/flows.ts`: G-CATS Manual Flow Ver.7 charts; `flowChart()` draws them for the Rules page by running
  the same code with every answer.
- `lib/judgement/auto.ts`: rule family per Error Type (`detectKind`) and the recommendation with its steps.
- `lib/judgement/review.ts`, `piles.ts`, `deck.ts`: what each card still needs and which pile it is in.
- Final OK/NG: a person, or auto-judge for owner-enabled families only (`docs/RULE_COVERAGE.md`). Error Type 19 is always HOLD.

## Main data flows

1. **Daily import**: upload to private staging → server finds the Error Log sheet/header → preview keeps raw row JSON
   (`raw_source`, keys `<header> [col N]`) → person commits → RPC merges source fields into the register.
   Identity is `code`; a row TMA has not coded yet gets the same key its code will have: Download Date (YYYYMMDD) +
   `No.` padded to 3 digits (`lib/judgement/source-key.ts`). Rows missing from a later export are kept; website edits
   are protected by per-field override flags.
2. **Judging**: card answers → `/api/judgement/*` re-runs the rules → save writes the AO–AW fields, change log and
   audit event → optional `EXCEL_UPSERT` job in `sync_outbox` for Power Automate.
3. **TMA package**: `/api/judgement/detail` builds the G-CATS Detail per part number (JSON or Excel). A person types the
   TMA-approved result into G-CATS; nothing is sent by the app.
4. **Tracker**: MD System / master uploads → `imds_master_*` tables → outbox → Power Automate writes the Excel Super
   Master; Excel edits come back through `/api/imds-master/sync-from-excel`.
5. **Supplier**: self-check parses the supplier's file, predicts the G-CATS checks, stores confirmations; follow-up
   e-mails go through one payload (`lib/followup/payload.ts`) to the e-mail flow.
6. **Automatic follow-ups**: Vercel Cron (24 daily jobs) → `/api/cron/followups` → per automation (`schedule.ts`):
   reminder to the TMMIN PIC, then `scheduled-run.ts` renders the template server-side (`render.ts`), resolves contacts
   from the Directory strata (`directory.ts`), adds PDF / Excel / summary PDF (`summary-pdf.ts`) and standard files
   (`library.ts`, unchanged) and hands each e-mail to the flow.

## API groups (`app/api`)

| Group | Purpose | Who |
|---|---|---|
| `access/*`, `auth/forgot`, `admin/*` | Access requests, password help, approvals, roles, notification recipients | Public forms (rate-limited) / admin |
| `imports/*`, `sharepoint/*` | Staged daily import, preview, commit, history; read-only SharePoint fetch | preparer / admin |
| `judgement/*` | evaluate, auto, autorun, bulk, memory, escalations, history, detail | internal roles per route |
| `register/*`, `approvals/finalize`, `tasks`, `evidence/*` | Register edits and export, finalisation RPC, tasks, private evidence | internal roles |
| `self-check/*`, `prechecks/*` | Supplier self-check and pre-check workflow | supplier (own code) / internal review |
| `followups`, `automation/*`, `suppliers/contacts` | Follow-ups, Power Automate dispatch / status / test, PIC directory | internal roles |
| `imds-master/*` | Tracker data, MD System import, master import/export, Excel reverse sync, automations (status / preview / draft / test reminder / send now), standard files | internal roles; reverse sync by shared secret |
| `cron/followups` | Weekly automatic follow-up (runs only on the saved WIB day/hour, once per slot) | Vercel Cron with `CRON_SECRET` |
| `reference` | CAS → GADSL / TSZ lookup | authenticated |

Routes check identity and role; RLS enforces record access. The service-role key is used only in server routes that
must create accounts or accept the Excel reverse sync.

## Trust boundaries

- No service-role key or Microsoft secret reaches the browser.
- CONFIDENTIAL and UNKNOWN sources are blocked at upload and must never enter code, prompts, tests or logs.
- Suppliers are isolated by `supplier_code` on their profile (RLS) and see only Self-check.
- No connection to IMDS, G-CATS, GXATS or MD System; no automatic SEND/ACCEPT. Microsoft Graph mail send and SharePoint
  write-back are not implemented (SharePoint fetch is read-only, `docs/SHAREPOINT_SETUP.md`).
- Power Automate: the app only hands off JSON; HTTP 202 means "handed off", not "delivered".

## Deployment

Vercel (web) + Supabase (data). `Dockerfile` / `docker-compose.yml` package the web app only for future self-hosting;
a Supabase-compatible Auth / PostgreSQL / Storage endpoint is still needed. Setup steps: `docs/PANDUAN_SETUP_LENGKAP_ID.md`.
