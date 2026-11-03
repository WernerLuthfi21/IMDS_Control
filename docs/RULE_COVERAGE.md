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
