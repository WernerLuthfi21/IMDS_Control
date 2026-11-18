# Changelog

## Unreleased — One Judge tab, G-CATS Detail for TMA, flow charts, tabbed Settings (2026-11-18)

- **Judge tab** (Overview and flashcards together): a statistics bar (% judged, biggest issue, decided by rules / your answer / waiting on others / awaiting KM), colour-coded **stacks per Error Type** with their own counts and a "Full auto" mark when the rules decide every card (e.g. WARP part number), and a **horizontal flashcard carousel** (previous · current · next). On each card the decision is the biggest element; decided cards in a stack can be confirmed together. Answer/confirm logic is unchanged.
- **Comment window** on every decided card: the comment to save, the G-CATS "Comment(last time)" for the part, and the comments already used for the same Error Type + decision (click to reuse) with a "same as N× before" / "new wording" check, so results stay consistent for TMA and G-CATS (`lib/judgement/comment-history.ts`).
- **G-CATS Detail (TMA)** tab: one page per delivery part number laid out like TMC's G-CATS Detail screen (header, Check / Error Type / Comment / Comment(last time) rows, SMS mass block, record of changing to OK/NG), with an Excel export per part or for every part whose errors are all judged. Labelled "prepared by the app, typed into G-CATS by a person"; nothing is sent (`lib/judgement/gcats-detail.ts`, `/api/judgement/detail`).
- **Rules → Flow charts**: every implemented judge flow drawn as a decision tree by running the engine with every answer (`flowChart` in `lib/judgement/flows.ts`). Identical branches merged; date-dependent exemptions follow today's date. Source register in its own tab.
- **Settings** tabs: My account / Judgement / IMDS Tracker / Team & access / System & security, linking to where each setting lives.
- Daily G-CATS Update, Supplier Pre-check (tabs) and Rules fit one laptop screen; green brand sidebar in light and dark.
- **CI**: new `E2E + contrast audit` job (Playwright) on the pages that render without a database, light and dark, with an automated WCAG contrast check.
- No rule, judgement-logic or schema change.

## Unreleased — One supplier e-mail contract for Tracker and Judgement (2026-11-07)

- New shared module `lib/followup`: one recipient resolver (Part List MAIN PIC EMAIL first, directory PIC as fallback, CC/Marketing/SPV copied, a supervisor is never the primary recipient) and one e-mail payload (version 2) used by both Tracker and Judgement. The payload is a superset of the old shapes, so existing flows keep working.
- Fixed: the Judgement follow-up picked the first active contact of ANY role (it could be the SPV) and sent no CC. It now uses the shared resolver and stores CC.
- Sender selection: `FOLLOWUP_SENDERS` allow-list + a "Send as" selector in the Tracker follow-up screen. Requests for a mailbox that is not on the list are rejected, so nobody can send as someone else. (Judgement retries from the outbox use the flow's default account.)
- Duplicate-send guard: a supplier e-mailed within `FOLLOWUP_MIN_GAP_HOURS` (default 24) is skipped unless forced; "Send all" reports these separately from failures.
- Attachments over 10 MB are refused before the flow is called.
- `docs/POWER_AUTOMATE_ALL_FLOWS.md`: single map of the four flows, env vars and a test order. The trigger schema in it is generated from code and a test fails if they drift.
- 21 new tests (142 total). No schema change.

## Unreleased — MD System import: correct "current record" selection (2026-11-07)

- `import-md-system` no longer lets the last file row win. When a part has several rows, the current record is chosen by rule: a cancelled-by-sender record never supersedes a live one, newest full timestamp wins, and parts with several live IMDS IDs (or a version/date conflict) are flagged instead of guessed. Example from real data: `681010K160` (live v2 listed before a cancelled v1) previously ended up as "cancelled".
- IMDS STATUS and ID / Ver now follow MD System (accepted -> ACCEPTED, in process / not yet browsed -> TMMIN WORKING, rejected -> REJECTED). Never overwritten: manual overrides, `DEAD (NEW SMS)`, `NOT TO BE COLLECTED`, ACCEPTED downgrades, unmapped statuses (cancelled/modified). These are flagged in `extra_fields.mdReview`.
- Files older than the master's current data are skipped, so dragging an old export cannot roll data back.
- Full wall-clock timestamp is now read from "last status changed"; part numbers with a design-change suffix (`82172KK010D`) fall back to the 10-character part number.
- Pure rules live in `lib/imds-master/md-current.ts` with 16 tests. Back-test on the hand-maintained Part List LATEST: 1871 non-ambiguous parts identical, 0 unexplained mismatches. No schema change.

## 0.2.2 — Deployment preparation (2026-11-03)

- Added deployment + Claude Code handover instructions in Indonesian.
- Bound `.env.example` to the dedicated Supabase project using its public publishable key only.
- Added the authenticated-only Data API grants migration and aligned local migration version prefixes to the eight migrations already applied remotely.
- Added explicit status for unverified workbook imports, unfinished Microsoft Graph / SharePoint integration, and unavailable GXATS / MD SYSTEM APIs.
- No production-readiness claim: dependency install, build, typecheck and E2E still require a working package registry/runtime and test execution.

## 0.2.1 — Runtime hotfix

- Added missing `CalendarClock` and `ArrowRight` Lucide imports used by the Judgement Register page.
- Added Windows runtime recovery instructions.

- 2026-11-18: redeploy for review-card duplicate-id fix (#48)
