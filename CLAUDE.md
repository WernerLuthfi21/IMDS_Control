# Instructions for coding agents

Before changing anything, read `README.md`, then the doc for the area you touch: `docs/RULE_COVERAGE.md` and
`docs/SOURCE_REGISTER.md` (rules), `docs/SECURITY.md` (access, data handling), `docs/ARCHITECTURE.md` (where code lives).
Reply to the user in Indonesian; keep UI text in English unless asked otherwise.

## Non-negotiable rules

### Source material and classification
- Never process, copy, summarize, index or store **CONFIDENTIAL** material. **UNKNOWN** (no label found) is blocked
  until the owner confirms. **PROTECTED** only under the user's permission, in this private repository.
- Source hierarchy: (1) the G-CATS Manual Operation / Manual Judge Flow version designated for the task; (2) the
  controlled Toyota appendix / standard revision; (3) GADSL and named regulatory lists as membership data only;
  (4) historical master rows as precedent only; (5) general IMDS / regulatory knowledge only when asked, labelled as
  external. Never fill a missing Toyota branch with generic knowledge.
- Keep source document, page / sheet / row and version with every extracted fact and judgement run. Keep duplicate
  workbook headers by column position; never merge historical master sheets silently.
- Historical labels (Battery (Pb), Tokusetsu Part number, …) are not official Error Type mappings.

### Judgement
- Numerical **Error Type 19 is always HOLD** until the process owner reconciles the Version 6 Section II / Appendix I conflict.
- Missing input → HOLD / manual, never zero or false. No universal substance threshold.
- Final OK/NG from the engine (auto-judgement) only for rule families an admin / rule approver switched on in
  Auto-judge, only for cases decided completely (no open step, no missing input, encoded flow, comment + procedure),
  never for Error Type 19 or any HOLD. Written as `Auto-judgement (System)`, audited (`JUDGEMENT_AUTO_FINAL`), synced
  like a human save, reopenable. Default OFF + shadow mode. Owner decision of 2026-11-18 (Werner): "OK bisa tanpa
  manusia asalkan final dan tidak perlu input manusia lagi". Everything else needs human approval.
- Draft / manual rules are never finalised. Switching a family on in Auto-judge is the recorded owner approval.

### External systems
- No automated G-CATS submission. Never claim the app clicks SEND / ACCEPT or submits anything. The G-CATS Detail
  export is prepared for TMA and typed into G-CATS by a person.
- Microsoft Graph mail send and SharePoint write-back are not implemented (SharePoint fetch is read-only). Do not mark
  them done without Entra registration, tenant consent, delegated OAuth, server-only secrets, approval UX, audit and tests.
- No GXATS / MD System endpoints or credentials exist. Do not invent APIs, browser automation or sync status.
- Power Automate: the app only hands off JSON. HTTP 202 = "handed off to the flow", not "delivered".

### Secrets and data in git
- Supabase service-role key, Microsoft secrets and flow URLs stay server-side, never in `NEXT_PUBLIC_*`, code or chat.
- Never commit workbooks, PDFs, daily G-CATS exports, supplier attachments, database dumps, `.env*`, `.vercel`,
  auth state, tokens, archives (`*.zip`) or production data. Keep the repository private.

## Engineering conventions

- Next.js App Router + TypeScript, server components by default; Supabase SSR auth with publishable key + RLS.
- Judgement logic lives in `lib/judgement/` (`engine.ts`, `flows.ts`, `auto.ts`). Every new branch gets a unit test;
  every rule change updates `docs/RULE_COVERAGE.md` and `docs/SOURCE_REGISTER.md`. Mass maths uses Decimal.js.
- Shared logic goes in `lib/`, never copied between Judgement and Tracker. The Tracker UI
  (`private/imds-tracker.html`, purple) is approved: bug fixes and integration only.
- Styles use the tokens in `app/globals.css` (`docs/DESIGN-SYSTEM.md`); no hard-coded hex in components. Light and dark
  must both pass the E2E contrast audit.
- Import keeps raw source fields, source row number and duplicate column identity.
- Schema changes: a new SQL migration in `supabase/migrations/` + docs. Before any push run
  `npx supabase migration list --linked` and compare remote and local. Never reset the remote project.

## Checks and reporting

Run and report the real result of `npm run typecheck`, `npm test`, `npm run lint:server`, `npm run build` and
`npm run test:e2e` (CI runs the same: jobs **validate** and **E2E + contrast audit**). Write PASS / FAIL / NOT TESTED;
a local syntax parse is not a substitute.

## Git, deploy, docs

- Branch from `main`, small pull requests, one purpose each. If `gh pr create` fails (GraphQL blocked), use REST:
  `gh api repos/WernerLuthfi21/IMDS_Control/pulls --input pr.json`.
- Vercel is on the Hobby plan: production only builds commits by the project owner. Do not merge yourself; Werner
  merges with *Create a merge commit* (`docs/PANDUAN_SETUP_LENGKAP_ID.md` section 0.5).
- Keep the doc set small: update the existing file listed in `README.md` instead of adding a new one. One-off audits
  and plans go in the pull request description, not in the repository. Record changes in `CHANGELOG.md` by date.
