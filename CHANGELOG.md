# Changelog

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
