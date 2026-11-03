# Changelog

## 0.2.2 — Deployment preparation (2026-11-03)

- Added deployment + Claude Code handover instructions in Indonesian.
- Bound `.env.example` to the dedicated Supabase project using its public publishable key only.
- Added the authenticated-only Data API grants migration and aligned local migration version prefixes to the eight migrations already applied remotely.
- Added explicit status for unverified workbook imports, unfinished Microsoft Graph / SharePoint integration, and unavailable GXATS / MD SYSTEM APIs.
- No production-readiness claim: dependency install, build, typecheck and E2E still require a working package registry/runtime and test execution.

## 0.2.1 — Runtime hotfix

- Added missing `CalendarClock` and `ArrowRight` Lucide imports used by the Judgement Register page.
- Added Windows runtime recovery instructions.
