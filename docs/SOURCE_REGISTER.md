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
