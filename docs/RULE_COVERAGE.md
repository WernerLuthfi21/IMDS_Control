# Rule coverage and activation status

Source of truth: `detectKind()` in `lib/judgement/auto.ts` (which rule family an Error Type belongs to) and
`selectFlow()` / `DEFS` in `lib/judgement/flows.ts` (which Manual Flow chart runs). Every flow is drawn on
**Rules → Flow charts**. A family is finalised automatically only when an admin / rule approver switched it on in
Auto-judge (see *Auto-judgement* below); everything else needs a person.

| Error Type | Rule family (`kind`) | What the engine does | Details |
|---|---|---|---|
| 6 SMS Mass | `sms` | Supplier confirmation A/B with the source comments | — |
| 7 Mass tolerance range | `mass` | TSZ2900G Rev.9 class MA–MF, Min/Max and ±10 % buffer (Decimal.js); raw-material branch (Manual Flow Ver.7 No.7) | *Type 7* below |
| 8 Mass deviation · 9 Not specified substances · 20 Supplied is not SMS | `other` | Manual Flow Ver.7 charts `massDev`, `notSpec`, `notSms` | *Substance and ELV flows* |
| 10 ELV (Pb) | `pb` | Pb TOYOTA Policy Table by Application ID + destination; Application 71 chart; undated policy cells go to TMC | *Substance and ELV flows* |
| 11 ELV (Cd) · 12 ELV (Hg) · 13 ELV (Cr6+) | `elv` | Manual Flow Ver.7 charts | *Substance and ELV flows* |
| 14–18 Prohibited substance | `substance` | CAS → GADSL → GADSL family (GADSL # / REF #, PFAS parents) → TSZ group → family chart (POPs, REACH XVII / XIV, phthalate, PFOA, DBT, DOT, SCCP, …); without a dedicated chart: general supplier step (draft, never auto-final). No universal threshold | *Substance and ELV flows* |
| 19 | — | **Always HOLD** (TMC pile) until the Version 6 Section II / Appendix I conflict is reconciled. The MCCP chart exists but is draft | `SOURCE_REGISTER.md` |
| 21 WARP Part number | `warp` | Supplier code against the Purchasing master | *No.21 WARP* below |
| Application 44 error | `app44` | Supplier confirmation A/B | — |
| 1–5, 22–23 and any type without a G-CATS rule | `manual` | No encoded rule: TMC pile, "ask TMC and record the answer" | — |
| Battery (Pb), Battery (Cd), Tokusetsu Part number, SCCP historical labels | — | Kept as historical labels; never mapped to an official Error Type without owner approval | `SOURCE_REGISTER.md` |

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

## Automatic row workflow

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
| No.8 Mass deviation (Appendix I), No.9 Not specified substances (Ver.7 p.4), No.20 Supplied is not SMS (Appendix I) | Encoded, kind `other` | New. No.8: |(A) − (B)| × 100 / (A) computed with Decimal.js from columns 23/24 (>1% → NG with the Appendix I comment; within → TMC); asked only when a mass is missing. No.9: "TOYOTA?" answered from the material name both ways (match → Yes, any other readable name → No; blank or `***` → asked); IMDS Committee stays a human question (no list exists); ≤10% / multi material from the row where possible. No.20: Purchasing/supplier Y → OK, N → NG "Toyota Supplied Part No is incorrect.[component]". |
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

Supplier says the code is wrong → NG "Supplier code is incorrect." first. Purchasing's answer (Y → OK "Confirmed by Purchasing Div.", N → NG) decides next. A code found in the Purchasing master with a matching name only **recommends** OK: the Purchasing step stays MANUAL, so the case is never auto-final. Reason (2026-11-21): in the Master Data, 59 of 601 such cases were judged NG by people — the same codes are OK for one part and NG for another, so the master alone is not reliable enough. The flow keeps the Purchasing question open (`purchasingWarp`), so the review deck shows "Recommended OK — not final" with the Y/N question; one click confirms it (or Bulk).

## Supplier self-check: predicted G-CATS checks (2026-11-18)

| Check | Supplier is asked | Toyota keeps |
|---|---|---|
| WARP Part number (No.21): supplier code not in the Purchasing master | "Is supplier code X correct?" (Y/N, once per part). N → NG "Supplier code is incorrect." in the judgement; Y → Purchasing still confirms | Purchasing confirmation |
| Mass tolerance (TSZ2900G) | A/B up front, when any class puts the mass outside the buffer | Tolerance class (drawing). A class a supplier typed earlier is no longer used by the judgement |
| ELV Cd / Hg / Cr6+ / Pb, identified by CAS when the file has no Error Type | The flow's supplier questions (stored per CAS) | Destination, Pb policy date rows |
| CAS on neither GADSL 2026 V1 nor TSZ0001G Appendix 3 | Nothing; shown as "no prohibited-substance error expected" | — |

Confirmations are stored in `supplier_confirmations`. The new family `warp` needs migration `20261118030000_supplier_confirmations_warp.sql`. Tests are in `tests/intake.test.ts`.

## CAS → Appendix 3 (TSZ0001G) link

`lookupSubstance()` in `lib/reference-data.ts`, in this order (first that matches wins; `tszLinks[].matchedBy`):

1. **cas**: the CAS is written in the Appendix 3 "CAS No." cell.
2. **gadsl-family**: the GADSL family of the CAS (member row REF # → family row with the same GADSL #) has the same name
   as an Appendix 3 group (e.g. 26027-38-3 → GADSL #160 "4-Nonylphenol, branched and linear, ethoxylated, all members"
   → TSZ0001G #73). PFAS families nest by the GADSL text "identified in rows X to Y"; the Appendix 3 PFAS groups match on
   their second line (PFOA → #26, PFOS → #27, PFHxS → #28, PFCAs → #76).
3. **member-name**: GADSL "Diorganotin compounds" is split into Appendix 3 #59 (dibutyltin) and #60 (dioctyltin) by the
   member's substance name.
4. **substance-name**: last resort, the member's own name against an "all members" group; always flagged for confirmation.

"selected" groups that name their CAS (or whose TSZ0001G table rows are in Appendix 3, e.g. Table 9 phthalates) match by
CAS only. A link carries a **caution** (the step stays `MANUAL`, so it is never auto-final) when Appendix 3 points to a
TSZ0001G table that is not in the uploaded appendices (Tables 4, 5, 6, 7, 8, 11) or the carbon range differs (#76 C9–C14
vs GADSL C9–C21). Coverage over all 7,066 GADSL rows with a CAS: 635 linked before, 3,018 after (2026-11-21). GADSL
families that are not in TSZ0001G (cobalt, nickel, "Hazardous Substances including SoC", …) stay unlinked on purpose.

## Automation check against the Master Data (2026-11-21)

Every rule change is re-run over the 5,515 rows of `G-CATS Error Log Master Data` (see `docs/SOURCE_REGISTER.md`). A case counts as auto-final eligible only with no open step (no NEEDS_INPUT / MANUAL) and an encoded flow.

| Step | Eligible with no human answer | Disagree with the human judge |
|---|---|---|
| Before this change | 109 | 0 |
| After (mass deviation computed, TOYOTA No from the row, four-phthalate total, WARP to MANUAL) | 346 | 0 |
| Same, when the vehicle destination is remembered for the part | 976 | 0 |

- No.8 Mass deviation: 71 rows, computed for all; 70 of 70 judged rows agree.
- Phthalates, "total of the four CAS in the same material below 0.1wt%?": the sum of the four CAS rows with the same part, supplier, component part no., material name and download date (`lib/judgement/material-group.ts`). Checked on 179 rows: every "Below 0.1wt%" OK has a sum below 0.1 and every NG a sum of 0.1 or more. A masked or missing content keeps the question open.
- Air conditioner (HFC p.27) still asks when the part name does not say air conditioner: the Master Data has no non-air-con HFC rows to prove an automatic "No".
- Still a human / external answer by design: supplier "Confirm to supplier" (1,623), mass tolerance class (426), vehicle destination (768, remembered per part after the first answer), SMS supplier (117), IMDS Committee material (70), Purchasing for WARP (873). Historical labels (Battery (Pb), Tokusetsu, …) stay unmapped.
