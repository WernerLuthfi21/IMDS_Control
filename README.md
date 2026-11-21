# IMDS / G-CATS Control Center

Internal TMMIN tool for IMDS material-compliance work: judge the daily G-CATS Error Check Log against the Toyota
G-CATS Manual Flow, prepare the result for TMA, follow up suppliers, and track IMDS submissions. One login, two
workspaces: **Judgement** (green) and **IMDS Tracker** (purple).

> Not a Toyota-approved decision system. It is not connected to IMDS, G-CATS, GXATS or MD System and never sends a
> result to G-CATS. Final OK/NG is made by a person, except rule families an admin explicitly switched on in
> Auto-judge. Error Type 19 is always HOLD.

Live: <https://imds-gcats-control.vercel.app> (Vercel) · data: Supabase project `thjntzkidfsydaiiwbyn` · repository private.

## What it does

- **Judgement** (`/judgement`)
  - **Judge**: Miko's table. Decks per Error Type, piles To Judge / Waiting TMA / Judged, and one card at a time
    with the rule path, case history and a comment window that checks wording against history. The auto-judge panel
    sits on the same table.
  - **All cases**: the register table.
  - **G-CATS Detail (TMA)**: per part number in the layout of TMC's G-CATS Detail screen, with Excel export.
    The result is typed into G-CATS by a person after TMA approves.
- **Daily G-CATS Update**: drop the Error Check Log, preview, then commit by hand. The key is TMA's `code`, or for
  rows not coded yet, Download Date + `No.` (the same value the code will have). Website edits are never overwritten.
- **Supplier Pre-check / Self-check**: the supplier checks a file before Toyota does; the app predicts which G-CATS
  checks will fire (WARP, ELV, prohibited substance, mass).
- **Supplier Follow-up**: one e-mail contract for Judgement and Tracker, sent through Power Automate.
- **Judgement Rules**: every implemented flow drawn as a flow chart, plus Error Types and sources.
- **Substance References**: CAS → GADSL 2026 V1 / TSZ Appendix 3–6.
- **IMDS Tracker** (`/imds-tracker`): models, parts, MD System status, supplier follow-up.
- **Settings**: account, judgement, tracker, team & access, system.
- **Ctrl/⌘ K**: jump to any module, or search a part, CAS or supplier.

## Run locally

Node.js 22.16.0+ and npm 11.21.1+.

```powershell
npm install
Copy-Item .env.example .env.local   # Supabase URL + publishable key
npm run dev                          # http://localhost:3000
```

Full setup (Supabase, first admin, Vercel, Tracker master sheet, Power Automate), in Indonesian:
[`docs/PANDUAN_SETUP_LENGKAP_ID.md`](docs/PANDUAN_SETUP_LENGKAP_ID.md).

## Tests and CI

| Command | What |
|---|---|
| `npm run typecheck` | TypeScript |
| `npm test` | Vitest unit tests (rules, flows, imports, follow-up payload, …) |
| `npm run lint:server` | ESLint on `app/api` and `lib` |
| `npm run build` | Next.js production build |
| `npm run test:e2e` | Playwright on the pages that render without a database, light + dark, with a WCAG contrast audit |

GitHub Actions runs **validate** (typecheck, lint, unit tests, build) and **E2E + contrast audit** on every pull request.
Not covered automatically: signed-in pages (Judgement, Tracker, register) and real Power Automate / SharePoint tenants.

Still required before calling it production-certified: owner-approved expected outcomes for every Error Type, role and
storage-isolation tests with separate users, and backup / restore / key-rotation checks.

## Deploy

Open a pull request; Vercel builds a Preview and CI runs. **Werner merges** with *Create a merge commit*. Vercel Hobby
only builds production from the project owner's commits. Details: `docs/PANDUAN_SETUP_LENGKAP_ID.md` section 0.5.

## Documentation

| File | Read it for |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Non-negotiable rules for anyone (or any agent) changing the code |
| [`docs/PANDUAN_SETUP_LENGKAP_ID.md`](docs/PANDUAN_SETUP_LENGKAP_ID.md) | Setup and deploy, step by step (Indonesian) |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Modules, data flows, API groups, trust boundaries |
| [`docs/RULE_COVERAGE.md`](docs/RULE_COVERAGE.md) | What the engine does per Error Type, auto-judge conditions |
| [`docs/SOURCE_REGISTER.md`](docs/SOURCE_REGISTER.md) | Which source documents are used, their classification and conflicts |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Classification policy, roles, access requests, Supabase Auth settings |
| [`docs/POWER_AUTOMATE_ALL_FLOWS.md`](docs/POWER_AUTOMATE_ALL_FLOWS.md) | Every Power Automate flow, payload and test order |
| [`docs/POWER_AUTOMATE_STANDARD_ID.md`](docs/POWER_AUTOMATE_STANDARD_ID.md) | The same flows without a Premium licence (Indonesian) |
| [`docs/SHAREPOINT_SETUP.md`](docs/SHAREPOINT_SETUP.md) | Read-only SharePoint fetch: what exists, what is missing |
| [`docs/DESIGN-SYSTEM.md`](docs/DESIGN-SYSTEM.md) | Design tokens, colours, type, components |
| [`CHANGELOG.md`](CHANGELOG.md) | What changed, by date |

## Open items

From the UX / accessibility / performance audit of 2026-11-18 (full reports in git history, commit `07c6473`):

- One accessible confirm dialog to replace `window.confirm` / `prompt` (8 places).
- `/approvals`, `/evidence`, `/imports`, `/register/[id]` have no menu entry; `/cases` redirects twice.
- The register editor can set OK/NG without the rule engine.
- Inline hex colours in the automation panel and evidence pages (dark mode 2.4–2.7:1).
- About 179 dead CSS selectors and older style layers in `app/globals.css`.
- Flow charts: nodes are focusable buttons, but there are no tree / list semantics yet.

Not implemented on purpose until approved: Microsoft Graph mail send, SharePoint write-back, TOTP MFA / SSO, any
G-CATS / IMDS / MD System connection.
