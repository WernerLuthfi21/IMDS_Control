---
name: imds-gcats-master
description: Use when analyzing Toyota IMDS/G-CATS cases, Error Types, CAS/GADSL/TSZ references, mass checks, substance compliance, evidence or judgement workflows in this project.
---

# Toyota IMDS / G-CATS project skill

## Source hierarchy

1. The supplied Toyota G-CATS Manual Operation / Manual Flow version explicitly designated for the task.
2. The supplied Appendix / controlled Toyota standard revision for the relevant rule.
3. GADSL and other named regulatory reference files as membership/data sources only.
4. Historical master workbook rows as precedent/history, never as independent authority for current rules.
5. General IMDS or regulatory knowledge only when explicitly requested, and clearly label it as external context.

Never silently reconcile conflicting source sections or revisions. Preserve original terms, source version, source page, sheet, row and column identity.

## Confidentiality

- PROTECTED material may be processed according to the user's permission; keep the workspace private and minimize external disclosure.
- CONFIDENTIAL material must not be read, extracted, summarized, indexed, uploaded, copied into prompts, logs, screenshots, source code, tests or knowledge bases.
- UNKNOWN classification is blocked until confirmed.
- Never infer permission from the file extension or its location.

## Judgement guardrails

- Recommendation is not final OK/NG.
- Missing inputs -> UNKNOWN / MANUAL REVIEW or HOLD, never zero/false.
- Numeric G-CATS Error Type 19 is always HOLD until the process owner reconciles the Version 6 Section II / Appendix I conflict.
- Do not map historical-only labels (Battery (Pb), Battery (Cd), Tokusetsu Part number, SCCP and other unverified labels) onto official Error Types without approved mapping.
- Type 8 mass deviation denominator/rounding must come from an approved source; never invent it.
- Type 7 tolerance ranges remain draft until the controlled TSZ2900G revision and applicability are confirmed.
- Substance decisions require CAS → GADSL → TSZ group → exact family flow, plus destination and material/use context where specified.
- No universal prohibited-substance threshold may be inferred.
- Never claim to submit or SEND a result to external G-CATS unless a verified integration exists.

## Engineering standards

- Keep rules deterministic, separately testable, versioned and source-linked.
- Use Decimal.js for mass calculations.
- Preserve raw workbook records and duplicate headers by column position.
- Keep import staged until the user confirms commit.
- Add a unit test and update `docs/RULE_COVERAGE.md` for every rule change.
- Keep Supabase service-role secrets out of browser code.
