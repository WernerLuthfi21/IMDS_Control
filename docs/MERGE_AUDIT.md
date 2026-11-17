# Merge audit: IMDS G-CATS Control (A) × G-CATS Auto-Judgement by Jasmine (B)

Scope: A = this repository. B = Jasmine's single-file `index.html` ("G-CATS Auto-Judgement", runs fully in the browser, data in localStorage). Only B's **code and structure** were reviewed. B's embedded data blocks (`refs-data` ±2.2 MB, `sample-data` ±170 KB) contain Toyota/TMMIN data of unconfirmed classification and were **not** read, copied or committed.

Decision rule for "best of both": (a) agreement with the source documents, (b) test coverage, (c) how easy the result is to understand, (d) speed, (e) consistency with `CLAUDE.md`. If B is better but conflicts with a rule, the idea is taken, not the code.

## Feature matrix

| Area | A (this repo) | B (Jasmine) | Winner / action |
|---|---|---|---|
| Storage, users, audit | Supabase + RLS, roles, `audit_events`, `register_change_log`, realtime | localStorage per browser, typed name + role picker | **A**. B's data does not survive a browser or reach colleagues. |
| Daily G-CATS import | Staged import, duplicate-header preservation, classification gate, snapshots | Own XLSX unzip/reader, `normalizeGcats` | **A** (governed). B's zero-dependency reader noted as fallback idea. |
| Engine coverage | Mass tolerance TSZ2900G with Decimal.js, SMS 6, App 44, Pb policy table + App.71 flow, Appendix II No.14–18 flows, GADSL/TSZ0001G/POPs/REACH lookups, Type 19 HOLD, unit-tested | Appendix II flow data (`FLOWS`), destination codes `DEST_CODES`, WARP part-number rule | **A** for the engine; **B ideas**: WARP rule, TMMIN destination-code mapping. |
| Identical cases | Exact-match groups by SHA-256 signature of facts + trace, human applies per group, undo | `groupIdentical` + group answers | **A** (stricter signature); kept as "Group identical cases". |
| Auto-judgement | Recommendation only (until 2026-11-18) | `applyWarpAuto`, `applySelfCheckJudgement` write `FINAL_OK` as System | **Merged (this PR)**: system-final for complete cases in switched-on families, shadow mode, accuracy check, reopen, full audit. Type 19/HOLD never. |
| "Don't ask again" | Supplier answers reused from `supplier_confirmations` | Answers kept per part key in localStorage | **Merged (this PR)**: `judgement_memory` in Supabase for destination, tolerance class, Toyota-owned flow answers; shown with who/when. |
| Supplier self-check | Supplier portal + pre-check + confirmations reused by the engine | Self-check library with quote + sheet + line as evidence | **A** storage; **B idea** to add: show the supplier's quoted text and line next to the reused answer. Next PR. |
| TMC/TMNA/TME/TDEM escalation | Flow returns HOLD "Contact TMC" | Tracks NEED → SENT → CONFIRMED and holds final until answered | **B idea**, next PR: escalation tracker on top of HOLD cases. |
| Follow-up e-mail | Unified e-mail center (Tracker), Power Automate transport, test mode | Template text + resubmit tracking | **A**; resubmit tracking idea → Tracker. |
| Exports | exceljs XLSX, PDF, CSV | Own XLSX writer, PDF, summary stats | **A**. |
| Theme | Green (Judgement) / purple (Tracker), light + dark, automated contrast audit at 0 issues | Purple, light + dark | **A**, upgraded to green glass skeuomorphism (this PR). |
| Mascot / 3D | none | **not present in the file** | **New, original** "Miko" cat SVG (≈2 KB, 6 moods, reduced-motion aware). No 3D library added: the gain does not justify the weight. |

## Conflicts and resolutions

1. **Final without a human** (B writes `FINAL_OK`; A's rule forbade it). Resolved by the repository owner on 2026-11-18: allowed under the conditions in `docs/RULE_COVERAGE.md`. `CLAUDE.md` amended explicitly.
2. **Data classification of B's embedded data**: not imported. WARP needs the Purchasing supplier-code master; it will be added only when Werner confirms the classification and supplies it through the governed import.
3. **Terminology**: B "Judgment Workspace" = A "Judgement"; B "Approver/Internal Reviewer" = A roles `reviewer/preparer/admin`, `rule_approver`. A's names kept.

## Risks / unknown

- Migrations `20261110000000_tracker_settings.sql` and `20261118000000_judgement_memory_autojudge.sql` must be applied in Supabase before settings and memory are stored. Until then auto-judge stays in preview and memory is empty (the UI says so).
- Live Supabase, Power Automate and real data are not reachable from the build sandbox; behaviour against production data is NOT TESTED here.
- Accuracy depends on the encoded flows; run the accuracy check before switching families on.

## Next PRs

1. Self-check evidence quotes (sheet/line) next to reused supplier answers.
2. TMC escalation tracker (NEED → SENT → CONFIRMED) for HOLD cases that say "Contact TMC".
3. TMMIN destination code → region mapping (from B's code) so imported destination codes fill memory automatically.
4. WARP supplier-code rule once the supplier master's classification is confirmed.
