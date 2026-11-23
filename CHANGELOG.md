# Changelog

## 2026-11-23

### Automatic: clearer preview; summary e-mail sends only the Tracker's Executive summary PDF
- Preview: two panes. On the left the e-mails of the run (supplier, parts, first recipient, Will send / Skipped);
  on the right the selected supplier's e-mail (To, CC folded, subject, file chips, full text, skip reason, Outlook
  draft). Previous / Next and arrow keys; one dropdown on a phone. No long scrolling.
- Summary to all suppliers: only ONE file, the Tracker's own **Executive summary PDF** (same function as the button).
  - The page saves it to the server: when Follow-up → Automatic opens (data changed or over an hour old), before a
    preview or "Send now", every 2 hours while open, or with "Update it now".
  - Missing or older than 7 days at sending time → the summary is not sent and the reminder says so.
  - The server-built summary PDF and the `pdf-lib` dependency are removed.
- Fix: "Skipped" chips and results used the class `.skip` of the skip-to-content link, so they were positioned off
  screen. They now use their own class.

### Follow-up → Automatic: several automations, reminder before sending, previews and drafts; standard files
- Automatic follow-ups moved from Settings to **Follow-up → Automatic**. Several automations, each with:
  - its own type: follow-up per supplier, request per supplier, or **summary to all suppliers** (one e-mail with a
    server-built summary PDF: totals plus submitted / not submitted / rejected / working per supplier);
  - how often (**every week, every 2 weeks, every month**: week 1–4 or the last week), days and hour (WIB);
  - models, parts, template, sender, CC and files.
- Guardrails:
  - a **reminder e-mail to the TMMIN PIC** before every run (default 24 h, to the sender's address) listing every
    e-mail, recipient and file;
  - **Skip next run**, Switch on/off, Send now (confirm), a test reminder, per-run limit, minimum gap;
  - one run per slot, and a history of reminders and runs.
- **Preview this run** shows every e-mail with its full text; each one can be downloaded as an Outlook draft with its
  real attachments. Nothing is sent from the preview.
- **Standard files** replace the generated check form. Your own files (e.g. the IMDS Supplier Check Form template) are
  uploaded once and attached **exactly as uploaded**, chosen per manual e-mail or per automation.
  - New route `/api/imds-master/attachments`; admin / preparer can edit.
  - Migration `20261123010000_tracker_attachment_library.sql`.
- Removed: the generated, pre-filled check form (`lib/followup/check-form.ts`).

### Supplier contacts in strata, weekly automatic follow-up, IMDS Supplier Check Form
- Directory: contacts in five strata — IMDS PIC (To), **Additional contacts** (“Always CC”, “To” or info only; paste a
  list like `"Name" <mail>; …`), Middle management, Top management and **Director** (split from top management).
  Each stratum is a numbered card with its count; “What the e-mails will use” lists To and every CC option.
- No IMDS PIC → the e-mail goes To middle management (staff / supervisor, else department head / GM) instead of being
  blocked; the composer marks it “via middle mgmt”. Switch in Settings → E-mail templates (“No IMDS PIC?”).
- Composer: CC options Middle management / Top management / **Director** / PUD buyer; “Always CC” contacts are added
  automatically; tidier To column (first address + count, source tag).
- PUD buyers: built-in e-mails for Puguh, Luthfy, Omen, Irman, Taris, Liza, Aries, Bangun, Fifi and Regia, used when
  the Directory has none (`lib/followup/directory.ts` and the Tracker page; a test keeps both lists equal).
- Directory “Restore backup / update file” accepts a **merge** update file: adds suppliers, fills fields without
  overwriting the team's manual edits (except corrections marked in the file), appends additional contacts.
- **IMDS Supplier Check Form** (attachment option in the composer and the schedule): guide, checking list, information
  form with the supplier's outstanding parts, IMDS supplier code (Z008 + code), ID/version, plan date, the findings
  G-CATS recorded for each part number before, an AUTO CHECK column (mass deviation ≠ 0, Misc. ≥ 10 %, mass outside
  the drawing tolerance, prohibited substance without remains/purpose, ID/version missing), dropdowns, and the
  current contacts to confirm. Generated on demand, never stored.
- **Weekly automatic follow-up**: Settings → Automatic follow-up (days, hour WIB, type, template, sender, models,
  CC, attachments, per-run limit). `/api/cron/followups` runs from 24 daily Vercel cron jobs (Hobby plan), checks the
  WIB slot, claims it once in `audit_events`, renders the same template server-side and hands each e-mail to Power
  Automate (HTTP 202 = handed off). Needs `CRON_SECRET` + `SUPABASE_SERVICE_ROLE_KEY`. Preview and “Send now” in
  Settings; last runs listed. Off by default.

### Tracker: supplier due date → "Apply to all parts" of that model
- Each model row in "Due dates for this supplier" now shows either "✓ All N parts follow this date" or a button
  "Apply to all N parts · M differ" that gives the date (supplier due date, else the model deadline) to every part of
  that supplier × model, also parts that had their own date ("This part only"). It asks once, then saves to the shared
  master and the Excel sync.
- Setting a supplier due date still applies it to all parts of that model automatically (now after a short pause, so
  typing a date does not save half-typed dates), and the part rows below refresh at once.

### Tracker: sidebar follows light/dark, larger centred 3D cubes, tidy phone top bar
- The sidebar now follows the theme like the top bar: white with violet accents in light, plum in dark (tokens only;
  the active item, counts, avatar and logo frame keep their contrast in both).
- The 3D cubes on the Overview are larger and centred in their column (desktop, tablet), and sit centred above the
  title on a phone instead of being cut off or covering it.
- Phone top bar: buttons stay on one row, the search gets its own row below, the theme button is icon-only, and the
  "Live · N parts" notice moved to the bottom so it no longer covers the top bar.
- Fix: a stray merge marker in the Tracker CSS dropped the part-dialog field style.

### E-mail: sign-off, footer per sender, default font, tidier body, clearer send screen
- Every supplier e-mail (Tracker and Judgement) ends with a sign-off, added once only. It is configurable in Settings →
  E-mail templates: the shared signature plus a `short = full name` list (`{sendername}`; defaults Werner → Abdullah
  Luthfi Werner, Ayu → Eka Tarisa Ayu Putri). A template that already ends with "regards"/"sincerely" keeps its own.
- New: **footer per sender**. Each sender can have its own footer (name, title, phone). It replaces the shared
  signature for that sender only; empty means the shared signature is used. Same rule in the browser and on the server
  (`footerFor`).
- New: **default e-mail font** (Calibri, Arial, Segoe UI, Verdana, Tahoma, Aptos, Times New Roman; 9–16 pt). Only a
  known family and size are accepted, so no arbitrary CSS reaches the e-mail.
- Tidier HTML body: blank lines become paragraphs, "•"/"-" and "1." lines become real lists, links are clickable, an
  ALL-CAPS line (IMPORTANT NOTES) is bold. Everything is still escaped. Outlook drafts (.eml) now carry the same HTML
  as `multipart/alternative`, with the plain text kept as a fallback.
- Settings shows a live preview of the selected template with the chosen sender's footer and font (sample values).
- Send screen: labelled send modes (Safe test / Outlook drafts / Live send), folded sending options, a sticky action
  bar that says what the button does, an e-mail-style preview with files, an in-page confirmation listing the
  recipients, and a finish card. On a phone, supplier rows become cards.
- Docs: the e-mail flow's Select maps `ContentBytes` = `base64ToBinary(item()?['contentBytes'])`.
### Tracker: supplier list and summary PDF
- The whole supplier row opens the supplier (no need to hit the name). The name is plain bold text, not a link.
- The table no longer squeezes the name column on narrower windows: Status hides below 1180 px and rows become cards below 1000 px.
- Executive summary PDF, priority suppliers: a **Submitted n / all parts** column next to **Not Submitted n / all parts**.

### Tracker: parts workbench in the supplier drawer
- One **Target date** column (the submission plan).
  - A model deadline change sets every part of the model; a supplier × model due date sets that supplier's parts.
  - A single part can still be changed.
  - The cell says where the date came from (model deadline / supplier due / this part only).
  - Saved to `submission_plan` in the shared master (kept over imports) and queued for the Excel sync.
- **Part search** in the drawer.
- Every row shows **Check**, **Stop run** and **Move…** (other supplier or model, status kept).
- Rows can be selected (bulk bar) or **dragged** onto the Check / Stop run / Move lanes.
- **Supplier clarification file:** drop the supplier's Excel on the drawer.
  - Dead → Stop run; no data / not theirs → Check; Continue with a tracker model → Move.
  - Every line is shown first and can be changed. Nothing is applied until Apply.
- **Check** tab (all models) and **Stop run log** with the part's last identity and Restore.
- **Rejected** is a general status.
- These features were first built in the closed PR #61 and are rebuilt here on the new shell.
- Server: `POST /api/imds-master/part-ops` (set-target, to-check, resolve, stop-run, restore, reassign), rules in `lib/imds-master/part-log.ts` (tested). It needs migration `20261119020000` (part_log key).

### Database fixes from the closed 2026-11-19 pull requests
- `20261119010000_tracker_due_dates.sql` no longer drops the `autojudge_config` settings key. The old version failed on the live database with 23514.
- `20261119020000_tracker_part_log.sql` adds the `part_log` key used by the Tracker's Check tab and Stop run log.
- `20261119030000_role_helpers_no_rls_recursion.sql` ends the 54001 role-check loop that broke uploads for every account but the first. The same SQL was already given to Werner on 2026-11-19; running it again is safe.
- `tests/settings-key-check.test.ts` fails if a later migration drops an earlier settings key.

## 2026-11-21

### One surface system: Judge board and Tracker look like one app
- Judge board: the felt-table skin, always-light paper cards, 3D orbs and yellow glows are replaced by the theme
  tokens (flat tiles, state as a dot or edge, one accent outline for "selected"); the case card follows light/dark;
  counts and part numbers in the mono face; evidence lines in the body font.
- Tracker: same shell structure as the app (full-height sidebar with the same brand block, back button, nav sizes and
  user row; full-width top bar; 24px page title; flat tiles; status = dot + word, no emoji) but its own character:
  plum sidebar, violet surfaces and accents, small cube mascot. Judgement stays green, Tracker stays purple.
- Fix: Excel formula cells without a cached value were stored and shown as `{"formula":"_xlfn…"}` (e.g. supplier
  contact e-mail in Suppliers). Importers now keep the cached result or nothing; existing rows are cleaned when shown.

### Tracker on the shared type system (approved by Jasmin, 2026-11-21)
- Tracker CSS uses the same eight `--text-*` steps as Judgement (127 sizes; 24 sizes → 8, display numbers above
  32px keep their size) and four weights (650/720/750/800 → 600/700).
- Tracker `--f-mono` is now JetBrains Mono (it was Century Gothic), so part numbers and counts line up like in Judgement.

### Judge flashcard in its own file
- `components/judge-flashcard.tsx` holds the flashcard (decision, evidence, comment, keyboard); `review-deck.tsx`
  keeps the deck state and data (512 → 360 lines). No behaviour change.

### Judge card A3: evidence and "recommended, not final"
- Each card lists what the engine answered from the row or a master ("Answered from the row", JetBrains Mono),
  e.g. the mass-deviation maths, the four-phthalate sum, the Purchasing master lookup.
- A recommendation that still needs a person (e.g. WARP code found in the Purchasing master) shows a dashed
  "Recommended OK — not final" line above the question, and the card asks Purchasing's Y/N directly instead of
  landing in "missing". Nothing becomes final without that answer.

### Design system A1b: one type scale in the Judgement CSS
- All 558 font sizes in `app/globals.css` now use the eight `--text-*` steps (30 sizes → 8; nothing below 11px).
  Sizes map to the nearest step; 8–10.5px become 11px.
- Font weights 650/750/800/850/900 map to 600/700 (9 weights → 4). Hero `clamp()` headings are unchanged.

### Design system A1a: self-hosted fonts, data face, type-scale tokens, UI audit script
- `scripts/audit-ui.mjs` (dev only) prints the design-debt numbers for Judgement and the Tracker.
- Questrial (Century Gothic fallback) and JetBrains Mono are self-hosted with `next/font`; the runtime Google
  Fonts import is gone from `app/globals.css`.
- Codes and numbers (`.mono`, `code`, rule codes, destination codes) use JetBrains Mono with tabular digits.
- Type-scale tokens `--text-xs … --text-3xl` and line-height tokens added; `docs/DESIGN-SYSTEM.md` → Type.
### CSP nonce for app pages
- `proxy.ts` sets a fresh CSP nonce per request (`'nonce-…' 'strict-dynamic'`); inline scripts without it are
  blocked. The Tracker keeps its own policy (inline handlers). Tests: `tests/security-headers.test.ts`, E2E header check.

### Security headers on every route; "Handed off" wording
- Enforced Content-Security-Policy and `nosniff`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`,
  COOP and (production) HSTS for all routes (`lib/security/headers.ts`, `next.config.ts`). The Tracker gets only the
  extra hosts it already uses. Details and next steps (nonce, SRI for Tracker CDN scripts) in `docs/SECURITY.md`.
- Supplier follow-up results say **Handed off** instead of "SENT": HTTP 2xx from the flow is a hand-off, not
  delivery (CLAUDE.md).
### One confirmation dialog for bulk and irreversible actions
- `components/ui/confirm-dialog.tsx` replaces all six `window.confirm` calls (Auto-judge run, bulk apply, bulk undo,
  confirm decided cards, supplier e-mail hand-off, clear MDS for IMDS). Themed, focus-trapped, Esc cancels, shows
  the count and consequence; from 50 items the person types the count before the button unlocks.
### No hex colours in components
- Icon tints and the automation test notes use theme tokens (`.ic-amber`, `.ic-muted`, `.ic-blue`, `.ic-green`,
  `var(--green)` / `var(--red)`) instead of hard-coded hex, so they follow light/dark. Only the Miko illustration
  keeps its own artwork colours.

### Judge: more cases decided from the row, reliably, and faster bulk evaluation
- No.8 Mass deviation is computed from (A) and (B) (Decimal.js); the reviewer is asked only when a mass is missing.
- No.9 "TOYOTA?" answers No from the material name too (blank / `***` still asks); refrigerant (HFC) likewise.
- Phthalates: the total of the four CAS in the same material is summed from the other rows of the part
  (`lib/judgement/material-group.ts`) and answers the Manual Flow question; masked contents keep it open.
- WARP: a code in the Purchasing master now recommends OK but keeps the Purchasing step open (never auto-final);
  supplier "code is wrong" wins first. The old auto-OK contradicted 59 historical judgements.
- Bulk preview / apply and auto-run load supplier confirmations and phthalate sibling rows once per batch instead of
  one query per case.
- Master Data replay: auto-final eligible cases 109 → 346 (976 with the destination remembered), 0 disagreements.
  Tests: `tests/judge-automation.test.ts`.

### CAS search follows GADSL families into Appendix 3
- A CAS that is a member of a GADSL family now reaches the Appendix 3 (TSZ0001G) group of that family, e.g. 26027-38-3
  → GADSL #160 → TSZ0001G #73 "4-Nonylphenol, branched and linear, ethoxylated" (shown as "not listed in Appendix 3"
  before). Lead / mercury / arsenic / cadmium compounds, azo dyes, HCFC / HBFC, SCCP / MCCP, organotins and PFAS
  (PFOA, PFOS, PFHxS, PFCAs via the GADSL row hierarchy) are linked too: 635 → 3,018 of 7,066 GADSL CAS rows.
- Each link says how it was found (CAS in Appendix 3, GADSL family, member name). Links that need a check (TSZ0001G
  table not in the appendices, different carbon range) carry a caution and are never finalised automatically.
- Rule path and Substance References show the GADSL family. Tests: `tests/gadsl-family-link.test.ts`.

### Documentation cleanup

- Removed a stale copy of the whole early project under `.github/workflows/` (about 100 files: old code, eight old
  migrations and docs); only `ci.yml` runs there. Removed the committed v0.2.2 deployment ZIP; `*.zip` is now ignored.
- Docs reduced from 41 Markdown files to 12. Merged: access requests → `docs/SECURITY.md`; API overview →
  `docs/ARCHITECTURE.md`; deploy / Claude workflow and local start → `docs/PANDUAN_SETUP_LENGKAP_ID.md`; the two old
  Power Automate guides → `docs/POWER_AUTOMATE_ALL_FLOWS.md` (Lampiran A–D, column names updated to `KEY` / `NO.`);
  project skill → `CLAUDE.md`. Removed outdated v0.1/v0.2 troubleshooting, status, test-plan, user-guide, merge-audit
  and one-off audit reports (open audit items moved to `README.md`).
- `README.md`, `CLAUDE.md` and the `docs/RULE_COVERAGE.md` status table rewritten from the current code. No code change.

## 2026-11-19

### Tracker supplier e-mail attachments match the Tracker PDF; due dates per supplier × model
- **The e-mailed supplier PDF is now the Tracker's own "Supplier PDF".** The browser draws it and the server attaches it. It used to be a plain text PDF built on the server, and the server version is now only a fallback.
- **Supplier PDF fixes:**
  - Page 1 no longer loses the PIC line and the deadline boxes. A header repaint drew a white page over them, which left a blank gap.
  - The legend fits on the last table page more often.
  - Each emoji is embedded once, so the files are much smaller.
  - The label reads PROTECTED.
- **Excel error values are cleaned everywhere.** `{"error":"#N/A"}` / `#REF!` no longer reach suppliers: the importers store nothing for Excel error cells, and the e-mail Excel, the server PDF and the Excel sync clean the old values (`lib/imds-master/clean-cell.ts`).
- **Due dates:**
  - Each supplier panel can set a due date per model. Empty means the model deadline applies.
  - Model deadlines are now shared for the whole team; they were browser-only before.
  - Both are stored under the settings key `due_dates`.
  - The supplier due date is used in the supplier PDF, the e-mail `{deadlines}` text and the "nearest deadline" per supplier.
  - Needs migration `20261119010000_tracker_due_dates.sql`. Until it is applied, due dates stay in the browser and the Tracker says so.

### Supplier e-mail HTTP 400 from the Teams-webhook trigger
- **Files now travel in a new `files` field. `attachments` is always empty.**
  - Cause: the standard "When a Teams webhook request is received" trigger reads a JSON field named `attachments` as Teams cards. It rejected PDF and Excel files with HTTP 400 before the flow ran.
  - In the flow: Select → From `body('Parse_JSON')?['files']`. The schema in `docs/power-automate/supplier-email.schema.json` has the new field.
- **Clearer errors:** when a flow answers with an error, the website now shows the first 300 characters of the response next to the status code.

### Tracker + Power Automate fixes
- **Faster Excel sync:** new Office Script `docs/power-automate/UpsertRows.ts`, run with the standard "Run script from SharePoint library" action.
  - One Excel call per batch instead of two per row.
  - Updates by key and adds missing rows. It never deletes, keeps formula columns, keeps leading-zero codes, and writes `=`-prefixed values as text.
  - Works for the Tracker (`PartMaster`/`KEY`) and the Judgement Register (`JudgementRegister`/`code`). Tested against a mock workbook.
  - `POWER_AUTOMATE_TRACKER_BATCH` sets the rows per request (default 25; 200 with the script).
- **Supplier e-mail flow:**
  - The payload now also carries `bodyHtml` (escaped, line breaks kept), so Outlook needs no expression.
  - The guides attach every file through Select; the old `first(...)` only sent one attachment.
  - The guides set the trigger to "Anyone" with concurrency 1.
- **Tracker:**
  - Excel sync counts say "handed to the flow" (HTTP 202 is not a confirmed write).
  - A missing template config shows a clear message instead of a JSON error.
  - Sidebar classification label set to PROTECTED.

### Stable keys for rows without a TMA code
- **The `code` column is filled only after TMA judges a case.** Rows without a code used to get the key `fallback:<file hash>:<sheet>:<row>`, which changed with every export. Judgements on those rows were lost after the next import, and the Excel flow never found them.
- **New import key:** uncoded rows are keyed `code:` + Download Date (YYYYMMDD) + No. padded to 3 digits. All 4,841 coded rows in the Master Data follow this rule, so the key is the same one TMA's code gives later. Logic: `lib/judgement/source-key.ts` (tests: `tests/source-key.test.ts`). The original `code` stays empty in `source_code`, so "TMA has not coded it yet" is still visible.
- **Migration `20261119000000_rekey_uncoded_gcat_rows.sql`** (apply manually, **before the next import**) moves the existing fallback records to the new key once:
  - Idempotent; tested on Postgres 16 with fixtures.
  - When several old keys point to the same row, the one with an internal judgement wins.
  - Rows whose key already exists, or whose date or No. cannot be read, are skipped. Nothing is deleted.
- **The import preview warns** when records with the old key still exist, and reports how many rows were keyed by derivation.

## 2026-11-18

### Fieldbook overhaul, case history, rule path, command palette, safety fixes
- **Audit first:** UX/accessibility, domain/history and performance audits ran before the redesign (reports in git history at `07c6473`; open items are listed in `README.md`). Tokens and rules are in `docs/DESIGN-SYSTEM.md`.
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

### Judge + Auto-judge on one table, decks per error type, one shell standard
- **One tab:** Auto-judge opens as a panel on Miko's table (Judge tab). The separate Auto-judge tab is gone; Settings → Judgement and "Judged by Miko" open the panel.
- **Decks and piles:** every Error Type is a deck of cards (count, ready / you / wait bar); a card is dealt from its deck. The To Judge / Waiting TMA / Judged piles show the case on top (part number, error type, OK/NG).
- **Miko 3D:** soft-toy shading (light, rim shadow, glossy eyes, blush), calm float / blink / ear twitch, a happy hop with sparkles after a save. Deal and save flights are smoother (GPU transforms, eased paths).
- **Contrast, type and size system:** Century Gothic everywhere (app and Tracker; IBM Plex Mono and other fonts removed, minimum 10.5px), one height (36px), radius (14px cards / 12px buttons / pills) and border (1.5px) on the table; brighter text on the felt; option labels no longer wrap ("Other").
- **One shell standard** for Judgement and Tracker: brand · Back to menu · navigation · Toyota Indonesia logo · user row (Settings, Sign out) · "Confidential · internal use only". Sign-out and settings left the Judgement top bar; the Tracker gets the same user row (`POST /auth/signout`). Theme button shows icon + label in both.
- **Favicon:** Miko on green (`app/icon.svg`), also used by the Tracker.

### Miko's judgement table, real workflow piles, drag-and-drop fixed
- **Workflow piles** (`lib/judgement/piles.ts`, 11 tests): To Judge = WORKING without an internal judgement (the only remaining work); Waiting TMA = judgement saved, KM/TMA judge empty (already judged, never dealt again); Judged = judgement and KM filled; Other = not WORKING and not judged. Every count on the Judgement page uses these definitions (KPI tiles, statistics, Auto-judge). Duplicate ids count once. New list filter "TMA/KM done".
- **Miko's table (Judge):** emerald felt, Miko as dealer with a status line, the three piles as physical card stacks with real counts (click Waiting TMA / Judged to review their records read-only), rule-family chips and the case as a physical card. The card is dealt from the To Judge pile; after the server confirms the save it is stamped "JUDGED · OK/NG" and flies to the pile its real status belongs to (Waiting TMA), the counts update and the next card is dealt. A failed save keeps the card, the input and shows the error. Reduced motion: no flights.
- **Auto-judge** uses the same table with the three piles; its behaviour is unchanged.
- **Drag and drop:** the Daily G-CATS import and the Supplier pre-check boxes said "Drop … here" but had no drop handler (the browser opened the file instead). New `DropZone` used by Daily update, Supplier pre-check and Evidence: drag highlight, extension and size check before anything starts, file name and size, remove button, keyboard (Enter/Space). A file dropped elsewhere on a page no longer makes the browser leave the app. Self-check and Tracker drop boxes no longer flicker; the Tracker overlay clears when a drag leaves the window and a drop next to a box is refused instead of opening the file.

### Judge tab tidy-up, Century Gothic, no manual pile
- **Fixed:** an unterminated CSS comment in `app/globals.css` swallowed ~150 lines (flashcard facts, answer buttons, statistics ring) — the cards looked unstyled in production.
- **Judge tab redesign:** stacks are a wrapping grid (no sideways scroll) with a small 3D orb per Error Type; one toolbar (filters · Confirm N · refresh); the flashcard has navigation in its header, the part number with a supplier chip (the long source key is a tooltip), facts as a compact two-column list, and the decision panel with a 3D OK/NG badge, the reason in one line, the comment window and Confirm (Enter). Side preview cards removed. Phone: stacks collapse to compact tiles.
- **Font:** Century Gothic for the app (Questrial / URW Gothic as fallbacks where Century Gothic is not installed).
- **No manual judgement pile:** substances without a dedicated chart use the general supplier step (draft, never auto-final); No.8 Mass deviation, No.9 Not specified substances and No.20 Supplied is not SMS are encoded (auto-judge family `other`); TMC-only/unknown types, Error Type 19 and undated Pb cells go to the TMC pile.

### One Judge tab, G-CATS Detail for TMA, flow charts, tabbed Settings
- **Judge tab** (Overview and flashcards together): a statistics bar (% judged, biggest issue, decided by rules / your answer / waiting on others / awaiting KM), colour-coded **stacks per Error Type** with their own counts and a "Full auto" mark when the rules decide every card (e.g. WARP part number), and a **horizontal flashcard carousel** (previous · current · next). On each card the decision is the biggest element; decided cards in a stack can be confirmed together. Answer/confirm logic is unchanged.
- **Comment window** on every decided card: the comment to save, the G-CATS "Comment(last time)" for the part, and the comments already used for the same Error Type + decision (click to reuse) with a "same as N× before" / "new wording" check, so results stay consistent for TMA and G-CATS (`lib/judgement/comment-history.ts`).
- **G-CATS Detail (TMA)** tab: one page per delivery part number laid out like TMC's G-CATS Detail screen (header, Check / Error Type / Comment / Comment(last time) rows, SMS mass block, record of changing to OK/NG), with an Excel export per part or for every part whose errors are all judged. Labelled "prepared by the app, typed into G-CATS by a person"; nothing is sent (`lib/judgement/gcats-detail.ts`, `/api/judgement/detail`).
- **Rules → Flow charts**: every implemented judge flow drawn as a decision tree by running the engine with every answer (`flowChart` in `lib/judgement/flows.ts`). Identical branches merged; date-dependent exemptions follow today's date. Source register in its own tab.
- **Settings** tabs: My account / Judgement / IMDS Tracker / Team & access / System & security, linking to where each setting lives.
- Daily G-CATS Update, Supplier Pre-check (tabs) and Rules fit one laptop screen; green brand sidebar in light and dark.
- **CI**: new `E2E + contrast audit` job (Playwright) on the pages that render without a database, light and dark, with an automated WCAG contrast check.
- No rule, judgement-logic or schema change.

## 2026-11-07

### One supplier e-mail contract for Tracker and Judgement
- New shared module `lib/followup`: one recipient resolver (Part List MAIN PIC EMAIL first, directory PIC as fallback, CC/Marketing/SPV copied, a supervisor is never the primary recipient) and one e-mail payload (version 2) used by both Tracker and Judgement. The payload is a superset of the old shapes, so existing flows keep working.
- Fixed: the Judgement follow-up picked the first active contact of ANY role (it could be the SPV) and sent no CC. It now uses the shared resolver and stores CC.
- Sender selection: `FOLLOWUP_SENDERS` allow-list + a "Send as" selector in the Tracker follow-up screen. Requests for a mailbox that is not on the list are rejected, so nobody can send as someone else. (Judgement retries from the outbox use the flow's default account.)
- Duplicate-send guard: a supplier e-mailed within `FOLLOWUP_MIN_GAP_HOURS` (default 24) is skipped unless forced; "Send all" reports these separately from failures.
- Attachments over 10 MB are refused before the flow is called.
- `docs/POWER_AUTOMATE_ALL_FLOWS.md`: single map of the four flows, env vars and a test order. The trigger schema in it is generated from code and a test fails if they drift.
- 21 new tests (142 total). No schema change.

### MD System import: correct "current record" selection
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
