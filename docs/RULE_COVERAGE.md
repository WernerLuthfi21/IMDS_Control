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

## Substance flows (G-CATS judgment Ver.5.1.10, Appendix II) — `lib/judgement/flows.ts`

CAS → family mapping: `data/reference/gcats-v5110-cas-families.json` (713 CAS, PDF pp.76–86). Results are recommendations only; a human saves OK/NG. Numerical Error Type 19 stays HOLD.

| Flow | Status |
|---|---|
| Pyrrolidones (p.53), DOT (p.57), DBT (p.56), HCB (p.36), PCB (p.42), Phthalates (p.40), Methanol (p.49) | Encoded (tests in `tests/auto-workflow.test.ts`) |
| GADSL 190 PFAS (precedent-based, not in the PDF), Annex XVII non-EU path | Encoded, simplified; EU Annex XVII entry conditions → HOLD |
| Benzidine/azo, glycols, HFC, nitrosamines, PFOA, PBDE, triorganotin, aziridinyl, BNST, benzene, DMF, MDA, perchlorate, pitch, PAH, TCEP, arsenic, Cl-paraffins | NOT encoded → HOLD with the PDF page |
| Code meaning of destination/application codes (TSZ6000G / Manual 2) | Not available; Pb table unchanged |

### TMC escalation (`judgement_escalations`)

When an Appendix II flow ends in "Contact TMC/TMNA/TME/TDEM" (or "Report … to TMC first"), the case shows a TMC strip: NEED → SENT → CONFIRMED (answer OK/NG + note). The answer is stored per case key (part + error type + CAS + flow) and reused for identical cases by the single-case check, exact-match bulk and auto-judge (`4) TMC confirmation: …` is added to the procedure). Nothing is sent to TMC by the application; the reviewer records what TMC answered.
