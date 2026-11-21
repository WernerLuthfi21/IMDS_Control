# Source register and provenance

Only explicitly authorized PROTECTED/INTERNAL/PUBLIC sources may enter the application. CONFIDENTIAL source material and content must never be read, extracted, copied, indexed, uploaded, stored, summarized or used in prompts, logs, tests, screenshots or skill knowledge bases. Unknown classification is blocked until the owner confirms it.

| Source | Use in application | Status / limitation |
|---|---|---|
| `Master Data All IMDS Project_new.xlsx` — `G-CATS Error Log Master Data` | Historical judgement distribution, daily Error Log importer layout, nine AO–AW fields and procedure suggestion basis | 5,515 historical data rows; header row 4; historical records are not automatically live/open cases. The source workbook is not embedded as raw supplier/part data in the repository. |
| Master workbook — `IMDS Master Data Collection` and other part sheets | Separate project/progress and reference tabs | Sheets remain separate; importer currently targets the G-CATS Error Log sheet only and does not silently merge every sheet. |
| Master workbook — `Mass Check (TSZ2900)` | Extracted TSZ2900 mass-range reference | Reference-only pending controlled TSZ2900G Rev.9 verification. |
| Master workbook — `template email` | Historical supplier follow-up wording patterns | Generalized templates are suggestions; verify with the case evidence and current approved communication policy. Contact email addresses are not invented. |
| `1.G-CATS Manual Operation.pdf` — Version 6, 5 Mar 2026 | Error Type catalogue, Appendix I criteria, AO–AW field descriptions and G-CATS process | Conflicts with Section II No.19. |
| `2.G-CATS Manual Flow.pdf` — Version 6 | Appendix II flow branches for errors and substance families | Some flows require process owner review and additional controlled source context. |
| `1.G-CATS judgment Ver 5.1.10.pdf` | Historical version comparison | Not treated as authority over Version 6. |
| `7.G-CATS operation - How to.pdf` | Operational steps, SMS-BR and New SMS usage | External G-CATS transaction is not automated. |
| `5.How to find Mass tolerance in drawing.pdf` | Drawing/tolerance verification approach | Human evidence remains required. |
| `Appendix 3 - 6, MCCP judgeflow.xlsx` | MCCP / substance flow references | Draft/appendix reference; not automatically promoted to an approved active rule. |
| `Appendix3.TSZ0001G Substance Group List.xlsx` | TSZ substance groups | Packaged in `appendix3-tsz-substance-groups.json`. |
| `Appendix4.TSZ0001G x POPs Substance List.xlsx` | POPs list | Packaged in `appendix4-pops.json`. |
| `Appendix5.TSZ0001G x EU REACH ANNEX XVII List.xlsx` | REACH Annex XVII list | Packaged in `appendix5-reach-annex-xvii.json`. |
| `Appendix6.TSZ0001G x EU REACH ANNEX XIV List.xlsx` | REACH Annex XIV list | Packaged in `appendix6-reach-annex-xiv.json`. |
| `GADSL-Reference-List_2026_V1.xlsx` | GADSL lookup/deletions | Packaged as 2026 V1 reference datasets. |
| `IMDS Tracker (2).html` | UI/UX reference for navigation, local source-file refresh and tracker interactions | Used as a reference only; the new application uses a simpler compact layout and does not copy ornamental glass styling. |
| `MDSReport_73230-0KN60-A.pdf` | Example of supplier pre-check attachment boundary | Page 1 says parsing is not allowed. PDF is attachment-only and is not parsed by this application. |
| Master prompt and prior workflow screenshots | System scope and user workflow requirements | Where a planning note conflicts with an original source, preserve the discrepancy and request process-owner resolution rather than silently reconciling it. |

## Master workbook structure used

- `G-CATS Error Log Master Data`: 5,515 historical rows; header row 4; the nine AO–AW workflow fields match the operator/KM fields described in the manual.
- Historical workbook uses 19 distinct Error Type labels. These labels are not a substitute for the official numeric Error Type catalogue, which lists 23 entries.
- The workbook contains about 459 distinct historical judgement procedure strings. The suggestion endpoint groups these by exact Error Type and ranks independent same-part, same-supplier and same-CAS context matches.
- `Judge` and `KM Judge` historical columns include values beyond exact `OK` / `NG`. Nonstandard values are preserved as original source labels and are not coerced into active judgements.
- The `code` column is the preferred source identity. `No.` is a repeating sequence and is not an identity key. For rows without code, importer uses a conservative source fallback.

## Material source conflict

The Version 6 manual's Section II system error list describes Error Type 19 as `Prohibited substance(Benzene)`, while Appendix I's judgement criteria assigns No.19 to `Application44ERROR`. The engine holds numeric Type 19. A literal historical `Application44ERROR` label remains separate and is not automatically remapped by number.

## Historical-only labels

Examples: `Battery (Pb)`, `Battery (Cd)`, `Tokusetsu Part number`, and `Prohibited substance(SCCP)`. They are preserved as source labels and require owner-approved mapping before activation.

## Classification and handling

The user permits PROTECTED documents to be processed under their authorization and expressly prohibits CONFIDENTIAL information. Keep protected source materials in approved private infrastructure. Never bundle the entire master workbook, raw supplier/part rows, supplier PIC email addresses or MDS report into public source control. UNKNOWN classification must be blocked.

## Governance amendment 2026-11-18

The repository owner allowed system-final OK/NG for complete cases in rule families switched on in Auto-judge (see `CLAUDE.md` and `docs/RULE_COVERAGE.md`). The source references behind each family are unchanged: TSZ2900G Rev.9 (mass tolerance), Appendix I (SMS mass, Application 44 supplier answers), Pb TOYOTA Policy Table and Appendix II No.10 (Pb), Appendix II No.14–18 (substances). Error Type 19 remains HOLD because of the Version 6 Section II / Appendix I conflict.

## Purchasing supplier code master (added 2026-11-18)

`data/reference/purchasing-supplier-code-master.json` — 222 supplier codes from `Supplier_Code.xlsx` ("Supplier Code master (Purchasing)", sha256 8499377a…), extracted 2026-11-14 in Jasmine's G-CATS Auto-Judgement and confirmed **PROTECTED** by the repository owner on 2026-11-18. Used only by the No.21 WARP Part number rule (`lib/judgement/warp.ts`). Replace the file when Purchasing issues a new master and record the new version here.

TMMIN destination codes → rule regions (`lib/judgement/destinations.ts`) come from the same application's code (A–Z codes, V split Israel/other, X split Russia/India).

## MCCP judge flow and Appendix 3–6 re-check (added 2026-11-18)

- `G-CATS Manual Judgment Flow - MCCP.pdf` and `3. MCCP judgeflow - RI CM 202602 en.pdf` (same 9-slide deck, G-CATS Chemistry Manager Function (Regulatory Information), 7 Jan 2026; slide 8 marked PROTECTED and "Reference: MCCP judge flow (draft)"). Encoded as the draft flow `mccp` in `lib/judgement/flows.ts` (`MCCP_SOURCE`, `MCCP_REGULATED` = EU, JP "as of 2026 May"). Because the source calls it a draft, the system never finalises it. Replace `MCCP_REGULATED` when Appendix 4 lists more regulatory countries for MCCP.
- `Appendix 3 - 6 MCCP judgeflow.xlsx` (two identical copies), Appendix 3, 4, 5, 6 workbooks uploaded 2026-11-18: compared cell by cell with the packaged JSON (`appendix3…`, `appendix4-pops.json`, `appendix5…`, `appendix6…`) — no differences apart from `_x000D_` line-break encoding. Appendix 4 header: "First release: 2026MAR05". Packaged data unchanged.
- The "TSZ0001 Update" sheet lists TSZ0001G numbering for ver 27 / 28 / 29 (e.g. MCCP is #52 in ver 27/28 and #8 in ver 29; "Potentially MCCP containing substances" is new #11 in ver 29). Appendix 3 still uses ver 27 numbers, so the application keeps showing ver 27 numbers. Not reconciled — process owner to confirm when Appendix 3 moves to ver 29.
- Workbooks and PDFs themselves are not committed.

## G-CATS Manual Flow Ver.7 (added 2026-11-18)

- `3.G-CATS_Manual_Flow_Ver_7.pdf` (38 pages, every page PROTECTED 関係者外秘, TMC-MED(KM)). Becomes the primary source for the flows it contains (No.6, 7, 9, 10–14, 16–19); see `docs/RULE_COVERAGE.md` for each change against Ver.5.1.10. Its remarks say the appendices were updated in **July 2026** and it numbers them differently (Ver.7 "Appendix 2" = group list, "Appendix 3" = POPs list, "Appendix 4" = Annex XVII, "Appendix 5" = Annex XIV). The packaged appendices are the "First release 2026MAR05" files (our Appendix 3–6). **Request the July 2026 appendices** from the process owner and replace the packaged JSON when they arrive.
- Ver.7 numbers MCCP as **No.19**. The CLAUDE.md rule "Numerical Error Type 19 is always HOLD" is unchanged; the process owner must decide whether Ver.7 resolves the Version 6 Section II / Appendix I conflict.
- Also uploaded 2026-11-18 and read for context only (not encoded): `1.G-CATS_judgment_Ver_5.1.10.pdf` (already the previous source), `2.G-CATS_Manual_Flow.pdf`, `1.G-CATS_Manual_Operation.pdf`, `7.G-CATS_operation_-_How_to.pdf`, `5.How_to_find_Mass_tolerance_in_drawing.pdf`. None of them were committed.

## Uploads of 2026-11-18 (afternoon) — classification check

- `1.G-CATS_Manual_Operation_3.pdf` and `2.G-CATS_Manual_Judge_Flow.pdf`: marked PROTECTED (関係者外秘) — permitted; not committed.
- `Master Data All IMDS Project_new.xlsx`: Microsoft sensitivity label "Public"; already registered above. Words like "confidential" inside it are IMDS data values (confidential substances), not a document label.
- `gcatsFAQ.pdf` (image only), `gcatsSLA.pdf`, `3.G-CATS_Operation_-_How_to_-.pdf`, `CheckImdsStructure_…_86140YYA50.xlsx`: **no classification label found → UNKNOWN → blocked**, not read beyond the label check. ("IS CONFIDENTIAL" in the structure file is an IMDS column header.) Confirm the classification before they are used.
- `GCATS_TMMIN_20261106.xls` (daily export): not opened; the G-CATS Detail view reads the same columns from the committed register (`raw_source`).
- The G-CATS Detail layout (TMA package) follows the user's screenshot of TMC's G-CATS Detail screen.

## Uploads of 2026-11-21 — reference lists and manuals

Owner statement (Jasmin, 2026-11-21): all files below are **PROTECTED**, none CONFIDENTIAL; full reading permitted.
GADSL Reference List 2026 V1, Appendix 3 / 4 / 5 (and the A3–A6 + MCCP judge-flow workbook), G-CATS Manual Flow Ver.7,
G-CATS Manual Flow, G-CATS Manual Operation, G-CATS judgment Ver.5.1.10. Appendix 3–6 rows were compared with
`data/reference/*.json`: identical (only a Japanese note in the #27 CAS cell differs). The CAS search failures came from the
lookup, not the data: GADSL family rows (GADSL # / REF #) were ignored. Fixed; see `RULE_COVERAGE.md` "CAS → Appendix 3".

