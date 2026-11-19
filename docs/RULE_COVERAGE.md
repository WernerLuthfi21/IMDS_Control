# Rule coverage and activation status

| Error Type / family | Current implementation | Activation status |
|---|---|---|
| 1 Region | Manual verification task and source-trace note | Source-listed; manual |
| 2 Supplier Code | Supplier code verification workflow | Source-listed; manual |
| 3 Part number | SMS/source part number verification workflow | Source-listed; manual |
| 4 preliminary IMDS | Preliminary/final check; supplier pre-check readiness | Source-listed; manual confirmation |
| 5 Material module nor Semi-component | Component-only submission instruction | Source-listed; manual confirmation |
| 6 SMS Mass | Supplier confirmation branches and source comments | Draft for process-owner approval |
| 7 Mass tolerance range | Drawing-mass + MA–MF lookup in TSZ2900G Rev.9; calculate TSZ Min/Max and 10% buffer (Min × 0.9, Max × 1.1); route outside-buffer cases to supplier A/B confirmation | Recommendation-only / draft for process-owner approval; controlled revision and applicability still require confirmation |
| 8 Mass deviation | Holds for approved percentage basis | Manual review; denominator/rounding unresolved |
| 9 Not specified substance | 10% and multi-material branches | Draft for process-owner approval; denominator/material basis must be verified |
| 10 ELV (Pb) | Application ID, destination and policy evidence guardrails; Application 71 manual branch | Manual review; exact policy row and destination evidence required |
| 11 ELV (Cd) | Human review and source flow reference | Manual review required |
| 12 ELV (Hg) | Human review and source flow reference | Manual review required |
| 13 ELV (Cr6+) | Human review and source flow reference | Manual review required |
| 14 Prohibited substance | CAS → GADSL → TSZ → family flow workflow | HOLD / manual; no universal threshold |
| 15–18 specific prohibited substances | Substance-family route and evidence task | Manual review required |
| 19 | Numeric Error Type always HOLD | Owner reconciliation required due source conflict |
| 20–23 | Manual verification tasks | Source-listed; manual |
| MCCP draft workbook flow | Data preserved as draft reference | Not activated |
| Battery (Pb), Battery (Cd), Tokusetsu Part number, SCCP historical labels | Preserved independently from official numeric catalogue | Historical-only; owner mapping required |

## Type 7 tolerance calculation and historical evidence

The operational screening uses the source workbook columns AY–BG: look up tolerance using Drawing Mass and class MA–MF; calculate Min = Drawing Mass − tolerance and Max = Drawing Mass + tolerance; calculate the additional buffer as Min × 0.9 and Max × 1.1; compare IMDS mass against the expanded buffer. The guided application shows both the core range and expanded buffer. The branch mapping currently follows the TMMIN process-owner instruction for this implementation: core range → supplier actual/calculated mass confirmation; outside core but inside buffer → drawing confirmation; outside buffer → supplier A/B confirmation. Historical free-text comments are inconsistent across some rows and are retained as history, not treated as rule authority. This rule remains draft pending process-owner approval.

## Historical suggestion behavior

The procedure suggestion service groups imported history only within the exact historical Error Type label. It queries same part, same supplier and same CAS independently and ranks matching procedure strings. Suggested OK/NG comments are historical examples, not approved templates for the new record. No result is auto-copied into the active Judge/KM Judge fields.

## Final decision

The judgement service creates a recommendation and trace only. `finalDecision` stays `PENDING`. The final approval RPC requires a reviewer/admin/rule approver and an approved/active rule version, and checks recommendation polarity. Current draft/manual branches remain blocked from finalization until rule governance and source-owner validation are completed.

### Auto-judgement (amended 2026-11-18, repository owner decision)

`lib/judgement/autojudge.ts` + `POST /api/judgement/autorun` may write a FINAL OK/NG on the register (`gcat_error_items.judge`) without a human, under all of these conditions:

| Condition | Where enforced |
|---|---|
| Master switch on, shadow mode off, the case's rule family switched on (mass, sms, app44, pb, substance) by an admin/rule approver; who and when is stored in `autojudge_config` and `audit_events` | `decideAuto`, `PUT /api/judgement/autorun` |
| Case is WORKING and not judged | `decideAuto`, `.is("judge", null)` on update |
| Engine decided completely: no MANUAL / NEEDS_INPUT step, no missing input, encoded flow with an outcome that matches, comment and procedure present (the same strict test as exact-match bulk) | `evaluateBulkCandidate().eligible` |
| Never Error Type 19, never HOLD, never `manual` kind | `decideAuto` |
| Written as `Auto-judgement (System)`, `JUDGEMENT_AUTO_FINAL` audit with reason, signature and the config snapshot, `register_change_log`, Excel outbox like a human save | autorun route |
| Reopen with a reason (`JUDGEMENT_AUTO_REOPENED`) | autorun route `action: "reopen"` |

Default: OFF with shadow mode on. "Accuracy check" compares the engine with decisions people already made before any family is switched on. This is final inside this application only; nothing is submitted to G-CATS.

### Judgement memory

Toyota-owned answers (vehicle destination, mass tolerance class from the drawing, `usCarpet`, `nonEuReq`) are stored once per delivery part in `judgement_memory` and reused by the single-case check, bulk preview and auto-judge. The UI shows "Remembered from <who> on <date>"; picking a new answer replaces it. Supplier answers stay in `supplier_confirmations`.

## Automatic row workflow (feat/judgement-auto-workflow)

| Step | Automated | Source |
|---|---|---|
| CAS → GADSL 2026 V1 | Yes (uses `referenceNumber` when the GADSL number cell is merged/blank) | GADSL Reference List 2026 V1 |
| CAS → TSZ0001G group and judge flow | Yes | Appendix 3 |
| POPs / REACH XVII / XIV matches | Yes (by TSZ group number) | Appendix 4–6 |
| "Judgement procedure" text (AQ) | Generated from the steps above | — |
| Assigned person / starting date (AO/AP) | Set server-side from the signed-in account on first judgement | — |
| Pb policy: Application ID × destination → OK/NG | Yes, plain cells only. Date-flip entries (`2026~NG`) and Application ID 71 are HOLD | V5.1.10 Appendix II No.10 |
| Mass tolerance (Type 7) | Masses read from the row; the user only picks the class MA–MF | TSZ2900G Rev.9 |
| Other prohibited-substance flows (HCB, PCB, PFOA, phthalates, …) | Steps 1–4 only; remaining branches are NOT encoded and return HOLD | V5.1.10 Appendix II No.14 |

Automatic results are recommendations. Final OK/NG is always a human save.

## Substance and ELV flows (G-CATS Manual Flow Ver.7, updated 2026-11-18) — `lib/judgement/flows.ts`

Primary source since 2026-11-18: **G-CATS Manual Flow Ver.7** (TMC-MED(KM); its appendices are "updated July 2026"). Charts Ver.7 does not repeat keep the **G-CATS judgment Ver.5.1.10 Appendix II** chart. Every run stores its source in `flow.source` and in the procedure text. CAS → family mapping is still `data/reference/gcats-v5110-cas-families.json` (713 CAS, Ver.5.1.10 pp.76–86); group routing uses the Appendix 3 "Substance Judge flow" column. Numerical Error Type 19 stays HOLD (non-negotiable) — note that Ver.7 numbers MCCP as No.19; the process owner has to reconcile this with the Version 6 Section II / Appendix I conflict.

| Flow (Ver.7 page) | Status | Change vs. Ver.5.1.10 |
|---|---|---|
| No.11 ELV (Cd) p.19, No.12 ELV (Hg) p.20, No.13 ELV (Cr6+) p.21 | Encoded, new kind `elv` (`tests/manual-flow-v7.test.ts`) | New (was manual). Application ID 20 / threshold / supplier from the row; Hg asks JP/North America (destination "Other" asks `naDest`) and Application ID 46. |
| No.14 POPs generic p.22 | Encoded | New. Destination → Appendix 4 check (A/B/C, the TSZ row and the destination column are shown in the question) → supplier / TMC. |
| No.14 EU REACH Annex XVII p.23 | Encoded | EU path no longer HOLD: Appendix 5 check (A/B/C) with the entry shown. |
| No.14 EU REACH Annex XIV p.24 | Encoded | New. Sunset-date question shows the Appendix 6 sunset date. |
| No.14 Benzidine / Azodyes p.25, HFC p.27, PFOA p.28, Perchlorate p.31 | Encoded | New (were HOLD). Group names, part names and material names answered from the row when they match. |
| No.14 HCB p.26 | Encoded | **Changed**: Ver.7 has no EU 0.001wt% branch — intent → supplier in Japan? |
| No.14 Phthalate p.29, PCB p.30, Pyrrolidones p.32, No.16 DBT p.33, No.17 DOT p.34 | Encoded | Same logic. |
| No.18 SCCP p.36 | Encoded | **Changed**: supplier first (contains / input mistake → NG), then EU? (non-EU → report to TMC), then <0.15% (OK) / NG + report. Paraffin oil 85422-92-0 keeps the Ver.5.1.10 p.58 pre-question. |
| No.19 MCCP p.37 — error type `Prohibited(MCCP)` | Encoded, **draft** | Regulatory countries EU, JP come from the draft MCCP deck (RI CM 2026-02, "as of 2026 May"); Appendix 4 has no MCCP row. A person may confirm; auto-judge never finalises it (`draftFlow` → SKIP). Takes precedence over SCCP when the error type says MCCP. "Potentially MCCP containing substances" (TSZ ver29 #11) are not routed. |
| No.10 Pb Application Code 71 p.18, Pb TOYOTA Policy Table pp.10–17 | Encoded | Table checked row by row: ID 62 → standard pattern, ID 75 → NG EU/TW only, ID 76 → OK everywhere. IDs 68, 79, 86 (bare "2026~") stay HOLD. |
| No.7 Mass tolerance raw-material branch p.3 | Encoded (engine branch now fed from the row) | Outside the buffer + Delivery Part name "Raw Material": heavier than the drawing → OK "Confirmed with Drawing.", else NG. |
| Methanol (Ver.5.1.10 p.49), 0.1wt% "T1" charts, GADSL 190 PFAS precedent | Encoded (Ver.5.1.10 / precedent) | Not in Ver.7. |
| No.8 Mass deviation (Appendix I), No.9 Not specified substances (Ver.7 p.4), No.20 Supplied is not SMS (Appendix I) | Encoded, kind `other` | New. No.8: reviewer reads both masses (>±1% → NG with the Appendix I comment; within → TMC). No.9: TOYOTA material / IMDS Committee / ≤10% / multi material, from the row where possible. No.20: Purchasing/supplier Y → OK, N → NG "Toyota Supplied Part No is incorrect.[component]". |
| Substances without a dedicated chart (glycols, nitrosamines, PBDE, aziridinyl, BNST, benzene, DMF/DMAC, MDA, pitch, PAH, TCEP, arsenic No.15, groups with "Refer to TSZ0001G") | **General step** (draft, never auto-final) | The step every Ver.7 chart shares: supplier input mistake → NG "Supplier input mistake."; it contains → report the P/N to TMC. The Ver.5.1.10 page is kept on the card. |

There is no "Manual judgement" pile any more: unknown or TMC-only error types (22/23), Error Type 19 and Pb policy cells with an unconfirmed date go to the **TMC** pile with the reason; data gaps (no CAS, no drawing mass) go to **Missing data**.

Question piles: vehicle questions (destination, North America, U.S. carpet, non-EU requirement) → "Vehicle destination"; appendix / TSZ / IMDS-data questions → "Reviewer check"; supplier questions → "Supplier answer".

**Re-approval:** auto-judge approvals are tied to the rule set (`RULESET = gcats-manual-flow-ver7`). An approval saved for an older rule set no longer finalises anything (WOULD_FINAL with the reason) until an admin saves the Rules panel again ("Re-approve for G-CATS Manual Flow Ver.7").

### Review cards: one answer for the same question (`lib/judgement/deck.ts`)

Pending cases are sorted into piles by what they still need (`lib/judgement/review.ts`). An answer given on one card is applied (checkbox on, can be switched off) to every other undecided card with the same question:
vehicle destination, drawing tolerance class and Toyota-owned flow answers → same delivery part; supplier / Purchasing answers → same supplier code + delivery part + CAS + error type + question. Cards without a part number or supplier code never share. Each card is re-checked by the same `/api/judgement/auto` rules; cards that become decided can be confirmed one by one (Enter) or together ("Confirm all N", with the OK/NG split shown). Every save keeps its own trace. Tests: `tests/deck-answers.test.ts`.

### TMC escalation (`judgement_escalations`)

When an Appendix II flow ends in "Contact TMC/TMNA/TME/TDEM" (or "Report … to TMC first"), the case shows a TMC strip: NEED → SENT → CONFIRMED (answer OK/NG + note). The answer is stored per case key (part + error type + CAS + flow) and reused for identical cases by the single-case check, exact-match bulk and auto-judge (`4) TMC confirmation: …` is added to the procedure). Nothing is sent to TMC by the application; the reviewer records what TMC answered.

### No.21 WARP Part number (`lib/judgement/warp.ts`)

Supplier code found in the Purchasing supplier code master and the company name matches (or the record has no company name) → OK "Confirmed by Purchasing Div.". Code missing or name differs → the reviewer records Purchasing's answer (Y → OK "Confirmed by Purchasing Div.", N → NG "Supplier code is incorrect."). Auto-judge family `warp`.

## Supplier self-check: predicted G-CATS checks (2026-11-18)

| Check | Supplier is asked | Toyota keeps |
|---|---|---|
| WARP Part number (No.21): supplier code not in the Purchasing master | "Is supplier code X correct?" (Y/N, once per part). N → NG "Supplier code is incorrect." in the judgement; Y → Purchasing still confirms | Purchasing confirmation |
| Mass tolerance (TSZ2900G) | A/B up front, when any class puts the mass outside the buffer | Tolerance class (drawing). A class a supplier typed earlier is no longer used by the judgement |
| ELV Cd / Hg / Cr6+ / Pb, identified by CAS when the file has no Error Type | The flow's supplier questions (stored per CAS) | Destination, Pb policy date rows |
| CAS on neither GADSL 2026 V1 nor TSZ0001G Appendix 3 | Nothing; shown as "no prohibited-substance error expected" | — |

Confirmations are stored in `supplier_confirmations`. The new family `warp` needs migration `20261118030000_supplier_confirmations_warp.sql`. Tests are in `tests/intake.test.ts`.

## Appendix 3 element families (2026-11-19)

- Appendix 3 lists four families as "<element> and its compounds, all members" with CAS "Various": #5 Cadmium, #20 Lead, #21 Mercury, #42 Arsenic.
- By that wording every substance of the element belongs to the family. A GADSL substance whose name contains the element (stems `lead|plumb`, `cadmium`, `mercur`, `arsen`) is therefore matched to it.
- This is `lib/reference-data.ts` `groupsByName`, shown in the rule path as "matched by the GADSL substance name".
- Before this, short names (Lead, Mercury, Cadmium) were skipped and the rule path said "not listed in Appendix 3". Example: 7439-92-1 Lead → #20 → No. 10 ELV (Pb).
- GADSL CAS with a TSZ0001G group: 140 → 1,002 of 6,503.
- Tested in `tests/tsz-element-families.test.ts`. Nickel and other substances that are not TSZ0001G groups stay unmatched (no group is invented).

