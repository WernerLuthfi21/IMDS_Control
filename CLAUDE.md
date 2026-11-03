# Project context for coding agents

Read `README.md`, `docs/SOURCE_REGISTER.md`, `docs/RULE_COVERAGE.md` and `docs/SECURITY.md` before changing the application.

## Non-negotiable rules

- Never process, copy, summarize, index or store any CONFIDENTIAL material. Block UNKNOWN classifications. PROTECTED may be processed under the user's stated permission; keep repository private until redistribution is approved.
- Source material outranks generic domain assumptions. Do not fill missing Toyota/G-CATS policy branches with generic IMDS or regulatory knowledge.
- Preserve source page/sheet/row and source version with every extracted fact or judgement run.
- Do not silently merge duplicate workbook headers or multiple historical master sheets.
- Historical labels are not official Error Type mappings.
- Numerical Error Type 19 is always HOLD pending process-owner reconciliation of the Version 6 Section II / Appendix I conflict.
- Never set final OK/NG from the deterministic rule engine. Human reviewer approval is mandatory.
- Draft/manual rules must not be finalized. Only owner-approved/active rules can pass the database approval RPC.
- No automated external G-CATS submission is implemented. Never claim that the app clicks SEND, ACCEPT, or submits a result externally.
- Keep Supabase service-role secrets out of browser code and source control.

## Technical conventions

- Next.js App Router + TypeScript; React server components by default.
- Supabase SSR auth uses `@supabase/ssr` and publishable/anon keys with RLS.
- Use Decimal.js for mass calculations.
- Place deterministic judgement logic in `lib/judgement/engine.ts` and unit-test every new branch.
- Preserve raw source fields, source row number and duplicate column identity during Excel import.
- Do not add data migration or destructive schema changes without a matching SQL migration and documentation.
- Add tests and update source/rule coverage docs with each rule modification.

## Deployment and integration guardrails

- Current dedicated Supabase target is documented in `docs/DEPLOYMENT_AND_CLAUDE_GUIDE_ID.md`; eight migrations are already applied remotely. Verify remote migration versions before running any migration push. Never reset the remote project.
- Keep the GitHub repository private. Do not commit Excel workbooks, source PDFs, daily G-CATS exports, supplier attachments, database dumps, `.env.local`, `.vercel`, auth state, tokens or production data.
- Do not read or use `CONFIDENTIAL` content. `PROTECTED` is permitted only within the user's authorization and approved private environment; `UNKNOWN` is blocked.
- Microsoft Graph mail send and SharePoint Excel write-back are not implemented. Do not mark them complete until Entra app registration, tenant consent, delegated OAuth, server-only secret storage, approval UX, audit logging and integration tests exist.
- No GXATS / MD SYSTEM endpoints or credentials are configured. Do not invent API paths, credentials, browser automation or fake synchronization status.
- A local syntax parse is not a substitute for `npm run typecheck`, `npm test`, `npm run lint`, `npm run build` and Playwright E2E. Report actual command output.
