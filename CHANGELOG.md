# Changelog

## Unreleased: stable keys for rows without a TMA code (2026-11-19)

- **The `code` column is filled only after TMA judges a case.** Rows without a code used to get the key `fallback:<file hash>:<sheet>:<row>`, which changed with every export. Judgements on those rows were lost after the next import, and the Excel flow never found them.
- **New import key:** uncoded rows are keyed `code:` + Download Date (YYYYMMDD) + No. padded to 3 digits. All 4,841 coded rows in the Master Data follow this rule, so the key is the same one TMA's code gives later. Logic: `lib/judgement/source-key.ts` (tests: `tests/source-key.test.ts`). The original `code` stays empty in `source_code`, so "TMA has not coded it yet" is still visible.
- **Migration `20261119000000_rekey_uncoded_gcat_rows.sql`** (apply manually, **before the next import**) moves the existing fallback records to the new key once:
  - Idempotent; tested on Postgres 16 with fixtures.
  - When several old keys point to the same row, the one with an internal judgement wins.
  - Rows whose key already exists, or whose date or No. cannot be read, are skipped. Nothing is deleted.
- **The import preview warns** when records with the old key still exist, and reports how many rows were keyed by derivation.

## Unreleased: Fieldbook overhaul, case history, rule path, command palette, safety fixes (2026-11-18)

- **Audit first:** UX/accessibility, domain/history and performance audits are in `docs/audit/`. `docs/UX-AUDIT.md` shows what was fixed and what is still open. Tokens and rules are in `docs/DESIGN-SYSTEM.md`.
- **Safety:**
  - Judgement shortcuts (Enter, 1–9, ←/→) work only while focus is on the judgement table. Enter on a link no longer saves a judgement.
  - Auto-judge switches are staged and saved only with "Save and approve". Roles without rights see a read-only summary.
- **Case context next to the card:** *Rule path* shows the engine's own steps, the result, and a link that lights up the same path on the flow chart. *History* (`GET /api/judgement/history`) builds a timeline from existing records only. It has no migration, invents no timestamps, and shows which sources are restricted or unavailable.
- **Flow charts:** pan by dragging, arrow keys or wheel; zoom with buttons, Ctrl+wheel or + / −; fit; reset; step details; the case path is highlighted and centred (`lib/judgement/flow-path.ts`, 6 tests).
- **Command palette:** Ctrl/⌘ K jumps to any module, searches a part, CAS or supplier in the register, and switches the theme.
- **Miko** shows the table's real state: working, waiting, warning (draft flow), celebrate (batch done) and more. Clicking it shows the pile meanings and shortcuts. Idle loops are off.
- **Counters:**
  - One `isWorking()` test is used everywhere.
  - "All judged" (KPI) and "Judged" (pile) no longer share a name.
  - "Awaiting KM" is now "Waiting TMA" everywhere.
- **Accessibility:**
  - Global focus ring.
  - Skip link and `aria-current` in the navigation.
  - 37 labels tied to their fields.
  - Keyboard-reachable self-check upload.
  - Mobile search and sidebar fixes.
  - Error and not-found pages.
  - Light-theme greys and HOLD amber pass 4.5:1 on paper.
- **Performance (measured):**
  - /supplier-precheck JS: 3.87 MB → 0.78 MB. The CAS helpers moved to `lib/cas.ts`, so the GADSL list is no longer shipped to supplier browsers.
  - Sign-out is a form post, which removes supabase-js from most routes (−63 KB gzip).
  - Substance lookups are indexed: 16 ms → 0.002 ms by name, 0.96 → 0.20 ms by CAS.
  - Mass cases no longer run the check twice.
  - The mascot pauses while off screen.
- **Supplier self-check + judgement engine:**
  - The check predicts which G-CATS check each line will hit: WARP when the supplier code is not in the Purchasing master, ELV by CAS, prohibited substance, mass.
  - It summarises the supplier's data: part numbers, supplier code and whether it is registered, and the likely checks.
  - Suppliers answer only what they can confirm. WARP gets "is code X correct?". The destination and the drawing's tolerance class always stay with Toyota.
  - PDFs with real text are read (CAS + %) without a new dependency. Old .xls files get a clear Save-As/paste message.
- **Power Automate:**
  - New guide using standard connectors only (`docs/POWER_AUTOMATE_STANDARD_ID.md`): a Teams webhook trigger and a daily supplier reminder flow.
  - HTTP 202 is recorded as "handed off to the flow".
  - `scripts/build_judgement_register.py` refills the JudgementRegister master from Master Data All IMDS.
- **Fixes:** Final NG button style; FINAL_NG shown red; literal `\n` in the bulk confirm; sidebar classification label set to PROTECTED; follow-up page names both e-mail paths.

## Unreleased — Judge + Auto-judge on one table, decks per error type, one shell standard (2026-11-18)

- **One tab:** Auto-judge opens as a panel on Miko's table (Judge tab). The separate Auto-judge tab is gone; Settings → Judgement and "Judged by Miko" open the panel.
- **Decks and piles:** every Error Type is a deck of cards (count, ready / you / wait bar); a card is dealt from its deck. The To Judge / Waiting TMA / Judged piles show the case on top (part number, error type, OK/NG).
- **Miko 3D:** soft-toy shading (light, rim shadow, glossy eyes, blush), calm float / blink / ear twitch, a happy hop with sparkles after a save. Deal and save flights are smoother (GPU transforms, eased paths).
- **Contrast, type and size system:** Century Gothic everywhere (app and Tracker; IBM Plex Mono and other fonts removed, minimum 10.5px), one height (36px), radius (14px cards / 12px buttons / pills) and border (1.5px) on the table; brighter text on the felt; option labels no longer wrap ("Other").
- **One shell standard** for Judgement and Tracker: brand · Back to menu · navigation · Toyota Indonesia logo · user row (Settings, Sign out) · "Confidential · internal use only". Sign-out and settings left the Judgement top bar; the Tracker gets the same user row (`POST /auth/signout`). Theme button shows icon + label in both.
- **Favicon:** Miko on green (`app/icon.svg`), also used by the Tracker.

## Unreleased — Miko's judgement table, real workflow piles, drag-and-drop fixed (2026-11-18)

- **Workflow piles** (`lib/judgement/piles.ts`, 11 tests): To Judge = WORKING without an internal judgement (the only remaining work); Waiting TMA = judgement saved, KM/TMA judge empty (already judged, never dealt again); Judged = judgement and KM filled; Other = not WORKING and not judged. Every count on the Judgement page uses these definitions (KPI tiles, statistics, Auto-judge). Duplicate ids count once. New list filter "TMA/KM done".
- **Miko's table (Judge):** emerald felt, Miko as dealer with a status line, the three piles as physical card stacks with real counts (click Waiting TMA / Judged to review their records read-only), rule-family chips and the case as a physical card. The card is dealt from the To Judge pile; after the server confirms the save it is stamped "JUDGED · OK/NG" and flies to the pile its real status belongs to (Waiting TMA), the counts update and the next card is dealt. A failed save keeps the card, the input and shows the error. Reduced motion: no flights.
- **Auto-judge** uses the same table with the three piles; its behaviour is unchanged.
- **Drag and drop:** the Daily G-CATS import and the Supplier pre-check boxes said "Drop … here" but had no drop handler (the browser opened the file instead). New `DropZone` used by Daily update, Supplier pre-check and Evidence: drag highlight, extension and size check before anything starts, file name and size, remove button, keyboard (Enter/Space). A file dropped elsewhere on a page no longer makes the browser leave the app. Self-check and Tracker drop boxes no longer flicker; the Tracker overlay clears when a drag leaves the window and a drop next to a box is refused instead of opening the file.

## Unreleased — Judge tab tidy-up, Century Gothic, no manual pile (2026-11-18)

- **Fixed:** an unterminated CSS comment in `app/globals.css` swallowed ~150 lines (flashcard facts, answer buttons, statistics ring) — the cards looked unstyled in production.
- **Judge tab redesign:** stacks are a wrapping grid (no sideways scroll) with a small 3D orb per Error Type; one toolbar (filters · Confirm N · refresh); the flashcard has navigation in its header, the part number with a supplier chip (the long source key is a tooltip), facts as a compact two-column list, and the decision panel with a 3D OK/NG badge, the reason in one line, the comment window and Confirm (Enter). Side preview cards removed. Phone: stacks collapse to compact tiles.
- **Font:** Century Gothic for the app (Questrial / URW Gothic as fallbacks where Century Gothic is not installed).
- **No manual judgement pile:** substances without a dedicated chart use the general supplier step (draft, never auto-final); No.8 Mass deviation, No.9 Not specified substances and No.20 Supplied is not SMS are encoded (auto-judge family `other`); TMC-only/unknown types, Error Type 19 and undated Pb cells go to the TMC pile.

## Unreleased — One Judge tab, G-CATS Detail for TMA, flow charts, tabbed Settings (2026-11-18)

- **Judge tab** (Overview and flashcards together): a statistics bar (% judged, biggest issue, decided by rules / your answer / waiting on others / awaiting KM), colour-coded **stacks per Error Type** with their own counts and a "Full auto" mark when the rules decide every card (e.g. WARP part number), and a **horizontal flashcard carousel** (previous · current · next). On each card the decision is the biggest element; decided cards in a stack can be confirmed together. Answer/confirm logic is unchanged.
- **Comment window** on every decided card: the comment to save, the G-CATS "Comment(last time)" for the part, and the comments already used for the same Error Type + decision (click to reuse) with a "same as N× before" / "new wording" check, so results stay consistent for TMA and G-CATS (`lib/judgement/comment-history.ts`).
- **G-CATS Detail (TMA)** tab: one page per delivery part number laid out like TMC's G-CATS Detail screen (header, Check / Error Type / Comment / Comment(last time) rows, SMS mass block, record of changing to OK/NG), with an Excel export per part or for every part whose errors are all judged. Labelled "prepared by the app, typed into G-CATS by a person"; nothing is sent (`lib/judgement/gcats-detail.ts`, `/api/judgement/detail`).
- **Rules → Flow charts**: every implemented judge flow drawn as a decision tree by running the engine with every answer (`flowChart` in `lib/judgement/flows.ts`). Identical branches merged; date-dependent exemptions follow today's date. Source register in its own tab.
- **Settings** tabs: My account / Judgement / IMDS Tracker / Team & access / System & security, linking to where each setting lives.
- Daily G-CATS Update, Supplier Pre-check (tabs) and Rules fit one laptop screen; green brand sidebar in light and dark.
- **CI**: new `E2E + contrast audit` job (Playwright) on the pages that render without a database, light and dark, with an automated WCAG contrast check.
- No rule, judgement-logic or schema change.

## Unreleased — One supplier e-mail contract for Tracker and Judgement (2026-11-07)

- New shared module `lib/followup`: one recipient resolver (Part List MAIN PIC EMAIL first, directory PIC as fallback, CC/Marketing/SPV copied, a supervisor is never the primary recipient) and one e-mail payload (version 2) used by both Tracker and Judgement. The payload is a superset of the old shapes, so existing flows keep working.
- Fixed: the Judgement follow-up picked the first active contact of ANY role (it could be the SPV) and sent no CC. It now uses the shared resolver and stores CC.
- Sender selection: `FOLLOWUP_SENDERS` allow-list + a "Send as" selector in the Tracker follow-up screen. Requests for a mailbox that is not on the list are rejected, so nobody can send as someone else. (Judgement retries from the outbox use the flow's default account.)
- Duplicate-send guard: a supplier e-mailed within `FOLLOWUP_MIN_GAP_HOURS` (default 24) is skipped unless forced; "Send all" reports these separately from failures.
- Attachments over 10 MB are refused before the flow is called.
- `docs/POWER_AUTOMATE_ALL_FLOWS.md`: single map of the four flows, env vars and a test order. The trigger schema in it is generated from code and a test fails if they drift.
- 21 new tests (142 total). No schema change.

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

- 2026-11-18: redeploy for review-card duplicate-id fix (#48)
