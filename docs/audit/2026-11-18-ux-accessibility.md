# IMDS / G-CATS Control Center: UX and Accessibility Audit

Scope: every route under `app/` plus the components each route renders, `app/globals.css` and `app/login/login.css`. The audit was read-only and static: no browser was run, and contrast figures were computed from the hex values in the CSS. Standard: WCAG 2.2 AA.

Snapshot note: another process changed `app/globals.css` during the audit. It went from 1500 to 1547 lines at 19:18 WIB, when a "FIELDBOOK DESIGN SYSTEM" token layer was appended (lines ~1501–1547). Line numbers 1–1500 below are stable. Lines 1501+ refer to that new layer and may move.

Severity: Critical, High, Medium, Low. Priority: P0 (fix now) to P3 (backlog).

---

## 0. Global shell: `app/layout.tsx`, `components/app-shell.tsx`, `app/loading.tsx` (applies to every route)

| Problem | Evidence (file:line) | Severity | Recommendation | Priority |
|---|---|---|---|---|
| No skip link to main content. A keyboard user must tab through the brand, the back link, 7 nav links, the logo, settings, sign out, the menu, workspaces, search, the sync pill and the theme toggle before reaching the page | components/app-shell.tsx:58-79 | Medium | Add `<a class="sr-only-focusable" href="#main">Skip to content</a>` and `id="main"` on `.content-area` | P1 |
| The active nav item has only a class (`nav-active`) and no `aria-current="page"`. The `<nav>` has no `aria-label` | app-shell.tsx:64 | Medium | Add `aria-current={isActive ? "page" : undefined}` and `aria-label="Main"` | P1 |
| Routes that are not in the nav (/approvals, /evidence, /imports, /register/[id], /setup-required) fall back to "Judgement Register". The breadcrumb and the highlighted nav item are then wrong | app-shell.tsx:53, :78 | Medium | Map every route to a label. Show no active item when nothing matches | P2 |
| Mobile drawer: the menu button has no `aria-expanded`/`aria-controls`. There is no Escape to close and no focus move into or back out of the drawer. The off-canvas sidebar (`transform:translateX(-100%)`) stays in the tab order, so focus lands on invisible links (2.4.7, 2.4.11) | app-shell.tsx:59-61, :78; globals.css:9 | Medium | Add `inert`/`visibility:hidden` while closed, Escape to close, focus management and `aria-expanded` | P1 |
| Global search cannot be used at ≤800px. The input and `kbd` are `display:none`, and the form only expands on `:focus-within`, but nothing inside it can receive focus | globals.css:9 (`.global-search input,.global-search kbd{display:none}` and `.global-search:focus-within input{display:block}`) | High (mobile/tablet) | Make the search icon a real button that toggles the input, or keep the input visible but narrow | P1 |
| Global search is shown to suppliers, but it pushes to /judgement, which redirects suppliers back. The feature does nothing for them | app-shell.tsx:54, :78; app/judgement/page.tsx:19 | Medium | Hide search for `role==="supplier"` | P2 |
| The Settings icon in the sidebar user row appears for suppliers, but the layout redirects suppliers away from /settings, so the link is dead | app-shell.tsx:71; app/layout.tsx:20-21 | Medium | Render it only for internal roles | P2 |
| Three different "back to workspace" controls on one screen: sidebar "Back to menu", topbar "Workspaces", and on /judgement a third "Menu" link | app-shell.tsx:62, :78; judgement-workspace.tsx:374 | Low | Keep one (the sidebar) | P3 |
| The non-interactive "PRIVATE WORKSPACE" pill and the interactive `SyncPill` link use the same `.environment-pill` style, so the user cannot tell which is clickable. At ≤480px both are hidden, which also hides the Excel sync status | app-shell.tsx:78; sync-pill.tsx:33; globals.css:631 | Low | Give the link a button/link style. Keep the sync status on mobile as an icon | P3 |
| Footer "V0.2.2 ↗" shows an external-link arrow on a plain `<span>`, which suggests a link that does not exist | app-shell.tsx:80 | Low | Remove the arrow or link to CHANGELOG | P3 |
| The sidebar footer says "Confidential · internal use only", but the app's policy (Settings → System) says CONFIDENTIAL material is prohibited and the data is PROTECTED. This mislabels the classification | app-shell.tsx:74 vs app/settings/page.tsx:33 | Medium | Change to "PROTECTED · internal use only" | P2 |
| No `error.tsx` or `not-found.tsx` anywhere in `app/`. Server errors and `notFound()` (register/[id]) fall back to unstyled Next defaults | `find app -name error.tsx` → none | Medium | Add root `error.tsx` (retry, back to workspace) and a styled `not-found.tsx` | P2 |
| Global `loading.tsx` is the only loading state: a 3px bar with no skeleton, even for /judgement, which pages 1000-row chunks on the server before the first paint | app/loading.tsx:2; judgement/page.tsx:36-53 | Low | Add a route-level skeleton for /judgement | P3 |
| `SyncPill` POSTs `/api/automation/dispatch` from every open internal tab every 60s. That is a side effect with no visible indication | sync-pill.tsx:13-25 | Low | Show "retrying…" in the pill. Consider a single leader tab | P3 |

---

## 1. `/workspace`: app/workspace/page.tsx

| Problem | Evidence | Severity | Recommendation | Priority |
|---|---|---|---|---|
| The workspace-card focus ring `#69a77a` on `--bg #f6f7f8` is 2.64:1, below 3:1 for a focus indicator (1.4.11) | globals.css:46 | Medium | Use `--accent`/ink-coloured 2px outline + offset | P2 |
| The page is rendered outside the app frame, with its own topline, sign-out and theme button. This is a third shell variant (`auth-shell`, `workspace-selector-shell`, `app-frame`) | app-shell.tsx:56-57; workspace/page.tsx:14 | Low | Accept, but share the header component and tokens | P3 |
| The workspace-card CSS is defined in 7 places (light, isolated, both-themes, Fieldbook) | globals.css:44-87, 177, 264, 724-752 | Low | See section 15 | P3 |
| Empty, loading and error states are not applicable. The redirects cover unconfigured, unauthenticated and supplier users | workspace/page.tsx:10-12 | n/a | n/a | n/a |

---

## 2. `/judgement`: judgement-workspace.tsx, review-deck.tsx, miko-table.tsx, judgement-overview.tsx, autojudge-card.tsx, cat-stage.tsx, gcats-detail-view.tsx

| Problem | Evidence | Severity | Recommendation | Priority |
|---|---|---|---|---|
| **The Enter key saves a judgement from anywhere on the page.** The global `keydown` handler confirms the decided card on Enter unless the target is INPUT/TEXTAREA/SELECT/BUTTON. Enter on a focused `<a>` (sidebar nav, "Back to menu", "Workspaces", SyncPill, "Menu") or on a `<summary>` therefore calls `preventDefault()` and saves OK/NG instead of navigating | review-deck.tsx:384-397 (esp. :392) | Critical | Limit shortcuts to focus inside the card (`cardRef.contains(e.target)`), or exclude `a, summary, [role]` and anything focusable. Never write on a bare keypress outside the card | P0 |
| **Single-character shortcuts 1–9 answer the question, and by default apply the answer to all similar cards too** (`all` defaults to `true`). This fails WCAG 2.1.4 Character Key Shortcuts: they cannot be turned off and are not limited to focus. A stray keypress can update N cases | review-deck.tsx:354, :393, :457 | High | Activate only while the card has focus, add a setting to disable shortcuts, and default "also answer N more" to off | P0 |
| `confirm()` for bulk apply uses `\\n` inside a template literal. The dialog shows a literal "\n\n" instead of line breaks | judgement-workspace.tsx:294 | Medium | Use `\n` (or a real dialog) | P1 |
| Native `window.prompt`/`window.confirm` are used for consequential actions: reopening an automatic decision (reason captured via `prompt`), bulk apply, bulk undo, confirm-all. They cannot be styled, carry no context or audit preview, and any reason shorter than 3 characters fails silently | judgement-workspace.tsx:143-144, :294, :314; review-deck.tsx:268; autojudge-card.tsx:70 | Medium | One accessible `<dialog>` component with focus trap, labelled reason field and inline validation | P1 |
| **Same label, different number.** The "Judged" KPI shows `piles.judgedTotal` (judged + waiting TMA), but the "Judged" pile in Miko's table shows `piles.judged` (TMA/KM done). Two tiles on the same route carry the same word and different counts | judgement-workspace.tsx:234, :353; miko-table.tsx:12, :41 | High | Rename the KPI to "Judged (all)" or the pile to "TMA done". One glossary for To judge / Waiting TMA (= Awaiting KM) / Done | P1 |
| Terminology drift for one state: "Awaiting KM" (KPI, JudgeStats), "Waiting TMA" (pile), "judged · awaiting TMA/KM" (pile sub-label), tab id `km` | judgement-workspace.tsx:354; judgement-overview.tsx:41; miko-table.tsx:11 | Medium | Pick one term | P2 |
| Three separate count visualisations of the same piles (`JudgeStats` ring/dl, the `jw-kpis` tiles shown only in list view, the `Piles` in the deck). The view switch changes which one is visible | judgement-workspace.tsx:359-362, :381-383, :389-398 | Medium | One persistent queue header across views | P2 |
| The "To judge" list filter uses an exact `source_status !== "WORKING"`, while the KPI count uses `pileOf()` (trim + upper-case). The list and the count can disagree | judgement-workspace.tsx:257 vs lib/judgement/piles.ts:17-19 | Low | Filter with `pileOf(r)==="toJudge"` | P2 |
| The view switcher uses `role="tablist"`/`role="tab"` but has no `tabpanel`, `aria-controls`, roving tabindex or arrow keys. Same pattern in `Decks` (`role="tab"` buttons) | judgement-workspace.tsx:369-373; miko-table.tsx:50-51 | Medium | Use a real tabs pattern, or plain buttons with `aria-pressed` | P2 |
| The case drawer (`aside.jw-drawer`) opens without moving focus into it and does not return focus to the row button on close. Escape is bound on `window` | judgement-workspace.tsx:345-350, :444-451 | Medium | Focus the drawer heading on open and restore focus to `jw-rowbtn` on close | P1 |
| The whole flashcard `<article>` has `aria-live="polite"`, so every comment keystroke, answer and re-check re-announces the full card | review-deck.tsx:405 | Medium | Remove `aria-live` from the card. Announce outcomes through the existing `rd-notice role=status` only | P1 |
| Chips with `role="radio"` (destination, class, OK/NG) have no arrow-key or roving-tabindex behaviour. Every chip is a tab stop | judgement-workspace.tsx:55-57, :175-178 | Low | Use native radio inputs styled as chips | P2 |
| The "To judge" pile button does nothing once a stack is open (`if (stacks[0] && !stack)`), yet it keeps `aria-pressed=true` | review-deck.tsx:298 | Low | Make it reopen the first stack or reset filters | P3 |
| The "Judged by Miko" KPI always has `on:false` and `aria-pressed=false`, while behaving as a toggle for the Auto-judge panel | judgement-workspace.tsx:356, :360 | Low | Use `aria-expanded` tied to `autoOpen` | P3 |
| Errors and notices lack live regions: `queryError` (no role), `jx-bulk-notice` (no role) | judgement-workspace.tsx:377, :413 | Medium | `role="alert"` for the error, `role="status"` for the notice | P2 |
| For a human (non-auto) pending row, the drawer says "Recorded automatically as <you> · <today>" before anything is saved | judgement-workspace.tsx:156 | Low | Change to "Will be recorded as …" | P3 |
| Comment textareas: "Required" appears only as a placeholder, with no `aria-required`. The label switches between "IMDS reject comment" and "Record of changing to OK" | judgement-workspace.tsx:179-180 | Low | `required aria-required="true"` plus a visible "(required)" | P3 |
| **Auto-judge master switch, shadow mode and family toggles save on a single click with no confirmation**, so one click can enable automatic FINAL writes. No success feedback follows a save | autojudge-card.tsx:147-151, :96-105 | High | Confirmation dialog for enabling live mode or a family (show name/date that will be recorded), plus a "Saved by X at Y" toast | P0 |
| The Auto-judge settings panel opens for any role via `?autojudge=settings` (`showSettings=openSettings`). Checkboxes are disabled only while busy or when settings are missing, not when the user lacks rights (`canConfigure`). Non-approvers see editable toggles whose saves fail on the server | autojudge-card.tsx:37, :146-151; settings/page.tsx:16 | Medium | `disabled={!info.canConfigure || …}` plus a "read-only" note | P1 |
| `CatStage` re-renders on every `pointermove` across the window. The decorative cat sits inside a `<button>` whose accessible name is a joke line | cat-stage.tsx:25-38, :50 | Low | Throttle, or skip when the page is idle. Make the mascot non-interactive or `aria-hidden` | P3 |
| Animations: the JS fly/deal animations respect reduced motion (good: review-deck.tsx:251, :360). `.jw-kpi:hover` and `.mt .jc:hover` transforms are not guarded | globals.css:678, :1336 | Low | Wrap hover transforms in `prefers-reduced-motion:no-preference` | P3 |
| G-CATS Detail: the part list silently cuts off at 300 items and the export at 200 parts, with no "showing N of M" | gcats-detail-view.tsx:64, :66 | Medium | State the truncation and offer paging | P2 |
| G-CATS Detail: the "Copied" feedback is not announced. The SMS table has two "Min" headers without context. Table headers have no `scope` | gcats-detail-view.tsx:84, :102, :106 | Low | `role="status"` for copy, explicit "Drawing mass min" / "Actual mass min" headers | P3 |
| `.gd-btn:focus-visible{outline:#2a10b8}` gives 1.54:1 on the dark surface. The `jw-kpi` focus ring `#86d3a5` gives about 1.8:1 on light tiles | globals.css:1185, :679 | Medium | Token-based focus ring, ≥3:1 in both themes | P2 |
| States. Empty: `jx-empty` "No current-year source records" (:378), "No matching cases" (:439), `jx-no-groups` (:424), deck `mt-slot done` (review-deck.tsx:318-319), `gd-empty` (gcats:76, :107). Loading: "Shuffling the deck…" with a progress bar (review-deck.tsx:295, :320), "Running the automatic checks…" (judgement-workspace.tsx:158), "Loading the detail…" (gcats:77). Error: `jx-error`, plus a "Try again" button in the deck (review-deck.tsx:317) | – | Note | Reasonable coverage, but five different empty-state styles on one route (see section 14) | P3 |

---

## 3. `/rules`: app/rules/page.tsx, components/flow-library.tsx

| Problem | Evidence | Severity | Recommendation | Priority |
|---|---|---|---|---|
| The flow chart is a tree of nested `<div>`s with no list or tree semantics. A screen reader hears a flat run of questions and outcomes with no branch relationships | flow-library.tsx:84-100 | High | Render as nested `<ul>`/`<li>` (or `role="tree"`). Prefix each branch with its label ("If Yes:") | P1 |
| The chart scroll area `.fl-stage` is not focusable (`tabIndex` missing), so keyboard users cannot scroll wide or tall charts. Zoom uses the non-standard CSS `zoom` property | flow-library.tsx:70 | Medium | `tabIndex={0} role="region" aria-label`. Use `transform:scale` + container sizing | P2 |
| The tabs (Flow charts / Error types & sources) have `role="tab"` with no tabpanel or arrow keys | flow-library.tsx:36-39 | Low | Same fix as /judgement tabs | P2 |
| The page heading is built by `FlowLibrary` (`fl-head`) rather than the shared `.page-heading`. That gives a different spacing and badge layout from the other pages | flow-library.tsx:34-35 vs e.g. daily-update/page.tsx:2 | Low | One `PageHeader` component | P3 |
| Hard-coded colour `color="#ad7415"` on the alert icon and inline `style={{marginBottom:14}}`/`marginTop:14` | rules/page.tsx:12-16 | Low | Use tokens and classes | P3 |
| The flow list items use `aria-current={bool}`, which renders `aria-current="false"` (harmless) | flow-library.tsx:47 | Low | Use `aria-current={sel ? "true" : undefined}` | P3 |
| States. Empty: "No flow matches" (:52), "Pick a flow." (:72). Loading and error: none needed (static, `revalidate=3600`) | – | Note | – | – |

---

## 4. `/daily-update` and `/imports`: app/daily-update/page.tsx, app/imports/page.tsx, components/import-workbook.tsx, drop-zone.tsx

| Problem | Evidence | Severity | Recommendation | Priority |
|---|---|---|---|---|
| **Duplicate route.** /imports and /daily-update render the identical `<ImportWorkbook/>` with different titles, eyebrows and badges ("Data Import" vs "Daily G-CATS Update"). /imports is not in the nav | imports/page.tsx:3; daily-update/page.tsx:2 | Medium | Redirect /imports → /daily-update | P2 |
| Labels not associated: "Document classification" `<label>` has no `htmlFor`, so the `<select>` has no accessible name. The interval `<select>` has no label at all. "Connected workbook" labels nothing | import-workbook.tsx:30-31 | High | `htmlFor`/`id`, or wrap the control in the label | P1 |
| The classification select offers UNKNOWN and CONFIDENTIAL. Choosing either silently disables "Validate and preview" and "Fetch from SharePoint". The only explanation is a generic hint | import-workbook.tsx:30, :32, :34 | Medium | Show an inline blocking message next to the select when a blocked value is chosen | P2 |
| Error and success callouts have no `role="alert"`/`status` | import-workbook.tsx:33 | Medium | Add live roles | P2 |
| "Discard preview" only clears client state. Nothing tells the user that the staged batch remains | import-workbook.tsx:50 | Low | Say "staged batch kept as draft" or delete it | P3 |
| The commit is irreversible but has no confirmation summary (rows new/refreshed) at the commit point | import-workbook.tsx:25, :50 | Low | Confirm dialog restating the KPI numbers | P3 |
| History uses `state-pill` while the preview header uses `status status-amber`: two badge systems in one component | import-workbook.tsx:46, :52 | Low | One Badge component | P3 |
| Hard-coded icon colour `#67747f` (3.5:1 on the dark card) | import-workbook.tsx:27 | Low | `currentColor` | P3 |
| `DropZone` is `role="button"` but contains a nested `<button>` (`dz-clear`). Interactive content nested in a button is an ARIA authoring violation and is announced unpredictably | drop-zone.tsx:46, :67 | Medium | Make the zone a container with a real "Browse" `<button>` inside and a separate clear button | P2 |
| States. Empty: history "No import snapshots yet." (:52). Loading: spinner in buttons. Error: callout. **History load failures are swallowed** (`catch{}`), so the user sees "No import snapshots yet" | import-workbook.tsx:18 | Medium | Show a fetch error with a retry | P2 |

---

## 5. `/substances`: app/substances/page.tsx, components/substance-search.tsx

| Problem | Evidence | Severity | Recommendation | Priority |
|---|---|---|---|---|
| The CAS input has no programmatic label (`<label>` with no `htmlFor`). `autoFocus` on page load moves focus past the page heading | substance-search.tsx:11 | High (label) / Low (autofocus) | Associate the label. Drop `autoFocus` | P1 |
| Results appear with no live announcement and no focus move | substance-search.tsx:13-24 | Medium | `aria-live="polite"` summary ("2 GADSL matches…") | P2 |
| `source-link` and `distribution-note` classes have no CSS definition, so source provenance renders unstyled | substance-search.tsx:20-21, :24 (no match in globals.css) | Low | Define or reuse `.meta-chip` | P3 |
| Uses the `.panel` card system while most operational pages use `.simple-card`. Hard-coded icon colours `#557891`, `#71869a` | substance-search.tsx:10, :18 | Low | One Card component and tokens | P3 |
| States. Empty: `empty-state` "Awaiting CAS query" (:19). Loading: button spinner. Error: unlabelled callout (:12, no role). Not-found: info callout (:15), well worded | – | Low | Add `role="alert"` | P3 |

---

## 6. `/supplier-precheck`: page.tsx, precheck-tabs.tsx, supplier-selfcheck.tsx, supplier-mass-tolerance-selfcheck.tsx, supplier-precheck.tsx

| Problem | Evidence | Severity | Recommendation | Priority |
|---|---|---|---|---|
| **The self-check file picker cannot be reached by keyboard.** It is a `<label>` wrapping `<input type="file" hidden>`. The `hidden` input is not focusable and the label is not a tab stop. It also duplicates the shared `DropZone` that the codebase says is "one drop zone for every file upload" | supplier-selfcheck.tsx:149-151; drop-zone.tsx:5-9 | High | Replace with `<DropZone accept={[".xlsx",".csv",".pdf"]}…>` | P1 |
| None of the 10 form labels in the "One part by hand" form is associated with its control (supplier code, part no., IMDS ID, version, MDS status, preliminary, notes, classification) | supplier-precheck.tsx:124-131, :139-140 | High | `htmlFor`/`id` on all of them | P1 |
| Error and success messages render **twice**: inside the form (:141) and again below the inbox (:156-157) | supplier-precheck.tsx:141, :156-157 | Medium | Render once near the action that caused it | P2 |
| "MDS Status" defaults to "Internally released", the passing value for the readiness check, so a supplier who skips the field self-certifies by default | supplier-precheck.tsx:20, :130 | Medium | Default to an empty "Select…" and require a choice | P2 |
| Reviewer actions use `window.confirm` + `window.prompt` (the review note is typed into a prompt). The "Review", "Request info" and "Clear for IMDS" buttons show on every row regardless of status, including already-cleared rows. `REJECTED` is in the type but has no button | supplier-precheck.tsx:45-58, :158 | Medium | Status-aware actions, a proper dialog with a labelled note field, and a Reject action or removal of the type | P2 |
| For internal roles, "Attach PDF" is disabled (`!isSupplier`) with no explanation | supplier-selfcheck.tsx:157 | Low | Tooltip or inline text | P3 |
| The step indicator `<ol>` marks the current step only with a class. Results filter chips and answer buttons show selection by class only (`on`/`selected`), with no `aria-pressed` | supplier-selfcheck.tsx:143, :181, :190; supplier-mass-tolerance-selfcheck.tsx:56 | Medium | `aria-current="step"`, `aria-pressed` | P2 |
| Mass tolerance: the loading icon lacks the `spin` class (a static icon). Errors have no `role="alert"`. The result is not announced. All three fields are labelled correctly (wrapping labels, good) | supplier-mass-tolerance-selfcheck.tsx:45-47 | Low | Add `spin`, `role="alert"` and a live result | P3 |
| Tabs (`PrecheckTabs`): only the active panel is rendered, so `aria-controls` on inactive tabs points to missing IDs. No arrow keys | precheck-tabs.tsx:6-9 | Low | Standard tabs pattern | P3 |
| Three visual systems on one page: `sc-*` (self-check), `supplier-selfcheck-*` / `supplier-mass-selfcheck` (mass), `simple-card` (form), each with its own error style | globals.css:216-260, :337-382, :4-5 | Medium | See section 15 | P2 |
| Two pollers: the page refreshes `/api/prechecks` + `/api/followups` every 30s with errors swallowed | supplier-precheck.tsx:35-43 | Low | Show stale or failed state | P3 |
| States. Empty: "No submissions yet.", "No follow-up notifications at the moment." (`empty-note`). Loading: `sc-busy role=status` (good). Error: callouts, only some with `role="alert"` (selfcheck:145 yes, precheck:141 no) | – | Low | Make this consistent | P3 |

---

## 7. `/follow-up`: page.tsx, supplier-followup.tsx, automation-panel.tsx

| Problem | Evidence | Severity | Recommendation | Priority |
|---|---|---|---|---|
| **Contradictory messaging on one page.** The header badge says "OUTLOOK DRAFT", the subtitle says "open an editable Outlook draft", and a side card says "Sent status is not assumed… The application does not claim that an email was sent". Yet the first panel on the page (`AutomationPanel`) has "Send N e-mail(s) in order", which actually sends through Power Automate. Settings also calls the Tracker follow-up centre "the one e-mail path", so there are three e-mail paths | follow-up/page.tsx:2; supplier-followup.tsx:27, :37; automation-panel.tsx:105; settings/page.tsx:19, :24 | High | Split "Draft in Outlook" and "Send via Power Automate" into clearly labelled tabs, align the copy, and name a single primary path | P1 |
| AutomationPanel uses inline hex colours `#166534`, `#a16207`, `#b42336` for status icons and test results. In dark mode they give 2.4:1, 3.5:1 and 2.7:1 on the card (1.4.3 and 1.4.11 fail). Inline styles also bypass the dark safety net | automation-panel.tsx:12, :84, :87 | High | Use `var(--green)`/`var(--amber)`/`var(--red)` tokens | P1 |
| "Sync now" has no busy state or double-click guard, and network failures throw unhandled. In `runTest` a network rejection leaves `testing` stuck, so the button stays on "Testing…" | automation-panel.tsx:45-57, :79 | Medium | try/finally plus disabled while running | P2 |
| 11 form labels in the follow-up and contact forms are not associated with their controls | supplier-followup.tsx:30, :32, :35 | High | `htmlFor`/`id` | P1 |
| The message textarea shows `customMessage || template`. Clearing it entirely brings the template back, so the user cannot empty the field. Editing the error type after a custom edit silently keeps the old custom text | supplier-followup.tsx:23, :32 | Medium | Track a "dirty" flag. Add a "Reset to template" button | P2 |
| The empty-supplier info callout ("No active PIC is registered for this supplier") shows even before a supplier is chosen | supplier-followup.tsx:31 | Low | Show it only when `supplierCode && !selectedContacts.length` | P3 |
| The automation table has an empty first `<th>` (the select column) and an empty last `<th>`. The "Preview" button repeats on every row with no row context in its accessible name | automation-panel.tsx:108, :113 | Low | `<th><span class="sr-only">Select</span></th>`, `aria-label="Preview e-mail for {part}"` | P3 |
| Heavy inline-style layout (about 20 `style={{…}}` blocks) instead of classes | automation-panel.tsx:12-13, :77-122 | Low | Move to CSS | P3 |
| States. Empty: "No supplier follow-up records yet." (`empty-note`), "No matching open records." (plain `<td>`). Loading: "Preparing…" button text. Error: callout without role. **Load errors swallowed** (`catch{}`) in both components | supplier-followup.tsx:11; automation-panel.tsx:31 | Medium | Visible load-error state | P2 |

---

## 8. `/settings`: page.tsx, settings-tabs.tsx, team-access.tsx, access-admin.tsx, staff-register.tsx

| Problem | Evidence | Severity | Recommendation | Priority |
|---|---|---|---|---|
| Inputs labelled only by placeholder: Approval PIC name/email, Staff register full name/email | access-admin.tsx:82-83; staff-register.tsx:20-21 | Medium | Visible labels or `aria-label` | P2 |
| Removing an Approval PIC and rejecting an access request happen on one click, with no confirmation or undo. Recipient toggle and remove fail silently (`if (ok)` only) | access-admin.tsx:33, :64-71, :78 | Medium | Confirm destructive actions. Show errors | P2 |
| The per-row role selects all have the identical accessible name "Role", and supplier inputs are all "Supplier code" | team-access.tsx:28-29; access-admin.tsx:30 | Low | `aria-label={"Role for " + email}` | P3 |
| The "contact on file" pill uses class `state-ready`, which has no CSS definition (renders as the neutral base pill) | access-admin.tsx:29 | Low | Use `state-ok` | P3 |
| The "My account" tab shows read-only values in `div.field`, styled like editable inputs, with `<label>`s that label nothing | settings/page.tsx:14 | Low | Use a `<dl>` | P3 |
| Tabs: the hash-synced tablist has no arrow-key navigation. `SettingLink` uses `<a>` (full reload) for in-app routes | settings-tabs.tsx:16-21, :27 | Low | `next/link`, keyboard tabs | P3 |
| The Settings → "Supplier e-mail automation" link goes to `/follow-up`, not `/follow-up#automation` (SyncPill uses the anchor) | settings/page.tsx:19 vs sync-pill.tsx:33 | Low | Add the anchor | P3 |
| Mixed card systems: `.panel` (account/system/admin) and `.st-link` cards, plus `.result-card` and `.source-row` | settings/page.tsx:14-33 | Low | See section 14 | P3 |
| States. Empty: "No requests waiting.", "No PIC set: all admins are notified." Loading: button spinners. Error: `ta-err role=alert` (good). TeamAccess is hidden entirely when `members.length===0` (no empty state) | settings/page.tsx:30 | Low | – | P3 |

---

## 9. `/approvals`: app/approvals/page.tsx, components/approval-queue.tsx

| Problem | Evidence | Severity | Recommendation | Priority |
|---|---|---|---|---|
| **The route is orphaned.** It is not in the nav and no link points to it. Its empty state tells users to "Run an evaluation in Judgement Studio", but `JudgementStudio` is not rendered on any route (dead component) | approval-queue.tsx:8; `grep "<JudgementStudio"` → none | High (IA) | Either link it from Judgement or Settings, or retire it. Fix the copy | P1 |
| The "Final NG" button uses `btn-red`, which **is not defined in CSS** (only `.btn-danger` exists, unused). The destructive action looks identical to a neutral button | approval-queue.tsx:8; globals.css:4 | Medium | Define `.btn-danger` usage, or add `.btn-red` | P1 |
| The decision pill is green for any non-PENDING value, **including FINAL_NG** | approval-queue.tsx:8 (`final_decision==="PENDING"?"status-amber":"status-green"`) | Medium | Red for NG, green for OK | P1 |
| Buttons are disabled with no stated reason when the recommendation does not match or the comment is empty. Only the rule-status lock has a hint | approval-queue.tsx:8 | Medium | Show why each button is disabled | P2 |
| Reviewer comment `<label>` is not associated with its textarea | approval-queue.tsx:8 | Medium | `htmlFor` | P2 |
| States. Empty: `empty-state` (stale copy, above). Signed-out notice present. Error/message: callouts without live roles | – | Low | – | P3 |

---

## 10. `/evidence`: app/evidence/page.tsx, components/evidence-manager.tsx

| Problem | Evidence | Severity | Recommendation | Priority |
|---|---|---|---|---|
| Users must type a raw "Case UUID" whose placeholder says "UUID from Case Management". Case Management does not exist (/cases redirects to /), and the only inbound link comes from the orphaned register editor | evidence-manager.tsx:16; cases/page.tsx:2; register-editor.tsx:23 | High (IA) | Open evidence from the judgement drawer with the case pre-filled, plus a part/record search picker | P1 |
| The "Refresh" button **does nothing** when the UUID is empty or invalid (early `return`), with no feedback. The empty state tells the user to "refresh" | evidence-manager.tsx:11, :19 | Medium | Validate and show an inline error | P2 |
| 9 unassociated labels (case UUID, task type, title, details, file, classification, page, sheet, row) | evidence-manager.tsx:16-17 | High | `htmlFor`/`id` | P1 |
| Hard-coded `borderTop:"1px solid #edf0f3"` gives a bright line in dark mode (15:1 against the surface) | evidence-manager.tsx:19 | Low | `var(--line)` | P3 |
| The error/message callouts sit loose in the `.two-col` grid between the two panels, so they break the grid layout | evidence-manager.tsx:18 | Low | Put them inside the relevant panel | P3 |
| Five static "task template" cards look like actionable cards but have no action | evidence/page.tsx:12 | Low | Add "Create from template" (pre-fill the form) | P3 |
| States. Empty: `empty-state` "No tasks loaded". Loading: button spinner. Error: callout without role. Task and evidence fetch errors are swallowed | evidence-manager.tsx:11-12 | Medium | Visible error | P2 |

---

## 11. `/register/[id]`: app/register/[id]/page.tsx, components/register-editor.tsx

| Problem | Evidence | Severity | Recommendation | Priority |
|---|---|---|---|---|
| **The route is orphaned.** The only link to it is in `register-table.tsx`, which no route renders | register-table.tsx:77; `grep "<RegisterTable"` → none | Medium (IA) | Retire it, or link it from the judgement drawer as "Edit raw AO–AW fields" | P2 |
| **A second judgement entry surface bypasses the guided engine.** Judge OK/NG is a plain `<select>`, with no rule evaluation or trace, and the "Required" comment is not enforced on the client (`required` missing). Inconsistent with JudgePanel and ReviewDeck | register-editor.tsx:32-34 | High | Make Judge read-only here and route judgement through JudgePanel, or call the same `saveJudgement` path | P1 |
| "Back to register" uses `router.back()`. On a deep link it leaves the app | register-editor.tsx:23 | Low | `href="/judgement"` | P3 |
| 8 unassociated labels. The save error `feedback-error` has no live role | register-editor.tsx:29-42 | High (labels) | `htmlFor`, `role="alert"` | P1 |
| States. Not found: default Next 404 (no `not-found.tsx`). Empty suggestions: `empty-note`. Suggestion fetch errors swallowed | register-editor.tsx:17 | Low | – | P3 |

---

## 12. `/cases`, `/imds-tracker`, `/imds-tracker/master`

| Problem | Evidence | Severity | Recommendation | Priority |
|---|---|---|---|---|
| /cases is a dead route: it redirects to `/`, which redirects to `/workspace` (double redirect). It is still referenced in copy ("Case Management") | cases/page.tsx:2; page.tsx:3 | Low | Remove it, or redirect directly to /judgement | P3 |
| /imds-tracker failure and authorisation responses (503, 403, 500) are **plain-text bodies** with no app chrome, no sign-in link and no "Back to workspace" | imds-tracker/route.ts:12-21, :50 | Medium | Return a minimal styled HTML page with a link back | P2 |
| The Tracker is a separate 338 KB document with its own (violet) design language. It handles dialogs well: `role="dialog" aria-modal` and a Tab focus trap at private/imds-tracker.html:776-784, :2952-2960. That makes the main app's lack of dialogs more visible | private/imds-tracker.html | Note | Reuse the Tracker's dialog/focus-trap approach in the Next app | P2 |
| `/imds-tracker?supplier=` deep link from Judgement is handled (shared-master-sync.js:163). /imds-tracker/master redirects to `#settings` | – | OK | – | – |

---

## 13. `/login`, `/forgot-password`, `/reset-password`, `/setup-required`

| Problem | Evidence | Severity | Recommendation | Priority |
|---|---|---|---|---|
| "No email? Ask an administrator" ignores the API result and always shows "An administrator has been notified" (a false success) | login-form.tsx:50-54, :97 | Medium | Check `r.ok` and show an error on failure | P2 |
| "Request access" is supplier-only (Supplier code is required), but the tab label suggests anyone can request access. TMMIN staff have no self-service path, and the copy does not say so | login-form.tsx:62, :82 | Medium | Rename to "Supplier access request" and add "TMMIN staff: ask an admin" | P2 |
| Input focus is `outline:0` plus a 14%-alpha shadow. The visible cue is only the border change to `#167a45` | login.css:12-13 | Low | 2px solid ring | P3 |
| `.auth-error` has both `role="alert"` and `aria-live="polite"` (conflicting), and the empty alert is always rendered | login-form.tsx:71, :91, :101 | Low | Render it only when there is text | P3 |
| Auth tabs: `role="tab"` without tabpanels or arrow keys | login-form.tsx:60-63 | Low | Use buttons with `aria-pressed`, or full tabs | P3 |
| The reset form validates only on submit. Requirements ("10+ chars, a letter and a digit") are not shown up front (3.3.2) | reset-password-form.tsx:11-13, :24 | Low | Hint text under the field | P3 |
| /setup-required renders inside the full app frame (sidebar, nav to pages that redirect back, a SyncPill poller) | app-shell.tsx:56-58; setup-required/page.tsx:2 | Low | Add `/setup-required` to the bare-shell list | P3 |

---

## 14. Inconsistent components (several implementations of the same thing)

| Purpose | Variants in use (file) | Recommendation |
|---|---|---|
| Primary/secondary buttons | `.btn/.btn-primary/.btn-sm` (most pages), `.btn-red` (undefined, approvals), `.jx-save`, `.jx-link`, `.jx-more`, `.jw-group-btn` (judgement-workspace), `.jc-go`, `.mt-btn`, `.mt-icon`, `.jb-confirm-all` (review-deck), `.aj-primary`, `.aj-secondary button`, `.aj-reapprove` (autojudge), `.gd-btn`, `.gd-export-all` (gcats), `.auth-submit`, `.auth-link` (login), `.text-button` (register-editor), unclassed buttons in `.supplier-selfcheck-action`/`.sc-opts`/`.jx-tmc-actions` | One `<Button variant="primary|secondary|danger|ghost|link" size>` component |
| Cards/containers | `.panel` + `.panel-header/.panel-body` (rules, approvals, evidence, substances, settings), `.simple-card` + `.simple-card-head` (daily-update, follow-up, precheck, register-editor), `.rule-card`, `.result-card`, `.source-row`, `.jx-group`, `.aj`, `.st-link`, `.workspace-card`, `.sc-wrap`, `.supplier-mass-selfcheck` | Two at most: `Card` and `ListRow` |
| Status badges/pills | `.status .status-*` (rules, approvals, substances, settings), `.state-pill .state-*` (imports, precheck, follow-up, access; `state-ready` undefined), `.jx-pill` (judgement table), `.quiet-badge`, `.pill`, `.meta-chip`, `.sc-chip`, `.supplier-selfcheck-state`, `.aj-mode`, `.jc-need`, `.environment-pill` | One `Badge tone=ok|ng|hold|info|neutral` |
| Page header slot | `.page-heading` + `.status` badge (imports, substances, approvals, evidence, settings), `.page-heading` + `.quiet-badge` (daily-update, follow-up, precheck), `.fl-head` (rules), `.jw-head` (judgement), `.workspace-intro` (workspace) | `PageHeader` component |
| Empty states | `.empty-state` (icon + title + text), `.empty-note` (one line), `.jx-empty`, `.jx-no-groups`, `.mt-slot`, `.gd-empty` (a `<p>`), `.fl-none`, a plain `<td>` text (automation) | `EmptyState` with an optional action |
| Error messages | `.callout.callout-danger` (usually no role), `.jx-error role=alert`, `.jx-bulk-error`, `.aj-error`, `.feedback-error`, `.ta-err`, `.supplier-selfcheck-error`, `.auth-error`, `.dz-error` | `InlineAlert` with built-in `role` |
| Tables | `.table-wrap` (rules), `.table-scroll` (imports, precheck, follow-up, settings, automation), `.jw-table`, `.gd-grid`/`.gd-head-table`, `.ta-table`, `.sc-grid` | One `DataTable` shell (scroll, sticky header, caption) |
| Tabs | `.jw-view` (role=tab), `.fl-tabs`, `.st-nav`, `.pt-tabs`, `.auth-tabs`, `.mt-decks` (role=tab), `.gd-filter` (aria-pressed), `.jb-needs` (aria-pressed) | One `Tabs` with keyboard support, one `SegmentedControl` |
| File upload | `DropZone` (imports, evidence, precheck form) vs the hand-rolled `.sc-drop/.sc-file` label (self-check, keyboard-inaccessible) | `DropZone` everywhere |
| Confirmation | `window.confirm` ×6, `window.prompt` ×2, no in-app dialog component (the Tracker has one) | One `ConfirmDialog` |
| Mascot | `CatMascot` (deck), `CatStage` (autojudge), plus 4 CSS generations (see section 15) | One component, one CSS block |

Dead code found while auditing: `components/judgement-studio.tsx` and `components/register-table.tsx` are not rendered by any route. Several hundred lines of CSS are dead (section 15).

---

## 15. Coexisting CSS systems in `app/globals.css` (selectors and approximate lines)

The file is about 175 KB in 1500+ lines, minified in places (lines 3–11 hold 1–5 KB each). Each redesign was appended as a new layer rather than replacing the old one. Of 715 class selectors, **179 match no class in any `.tsx`** (some are dynamic, `t-*`, `n-*`, `p-*`, but most are genuinely dead).

| Concern | Competing layers (line ≈) | Notes |
|---|---|---|
| App shell / sidebar | base `.sidebar`/`.nav-item`/`.topbar` (3, 8–9) → dark override (461–466) → "Jasmine's solid brand sidebar" `html .sidebar …` (984–1005) → "One shell standard" `.back-menu`, `.user-row`, `html .sidebar .back-menu` (1472–1491) → Fieldbook `html .sidebar,html[data-theme=dark] .sidebar{background:var(--fb-forest-2)}` (≈1535) | `.sidebar` is matched on 30 lines. The `html .sidebar` specificity hacks make the earlier rules dead |
| Workspace selector cards | 33–71, 72–182 ("TMMIN workspace selector and isolated Judgement workspace"), 261–270, 724–752 ("both themes") | `.workspace-card` is defined in 7 places. `.workspace-assurance*`, `.workspace-tags`, `.workspace-back` are unused |
| Judgement workspace | `judgement-*` hero/filters/KPIs (72–182, **56 unused classes**), `jx-*` row-level list (271–333; `jx-row`, `jx-tabs`, `jx-filters` and others unused), "refresh aligned with Tracker" (383–457), "green glass skeuomorphism" (546–603), "layout: KPI · toolbar · table + side panel" (664–723), "KPI tiles in Jasmine's style" (772–794), "one screen per view" (957–983), Fieldbook radius `!important` (≈1541) | `.jw-kpi` is defined at 672–682 and fully overridden at 776–780 (`.jw-kpi::after{display:none}` silently removes the selected-state bar from 677). `.jx-pill` at 297, 456, 712–716, 788 |
| Flashcards / review | "Review cards" `rd-*` (795–873; `rd`, `rd-loading`, `rd-groups`, `rd-nav` unused), "Judge tab" `jb-stack*` (1047–1062, unused, superseded by `.mt-deck`), `.fc-*` (982, 1017, unused), `.jc` base (1077–1159) → `.mt .jc` "always light whatever the theme" (1333–1348) → "Miko's table v2" (1397–1471) | `.jc` is matched on 18 lines. In dark mode the case card is forced light (`color-scheme:light` + local token remap at 1334), a deliberate but glaring exception |
| Mascot | "cat" (604–629), "Miko on green glass cubes" (645–663; `.cat-scene`, `.g-cube`, `.f1`–`.f5` unused), "Miko v2: just the cat" (753–771), "Miko 3D" (1374–1396), plus `@media (prefers-reduced-motion:no-preference){…animation:none}` (≈1545–1547) | The new Fieldbook rules use an **inverted** motion query (`no-preference` → `animation:none`). It is harmless for accessibility but shows that guards are being toggled ad hoc |
| Supplier self-check | `.supplier-mass-selfcheck`/`.supplier-selfcheck-*` (183–260), `.sc-*` "Supplier self-check" (337–354) → "Self-check: staged flow" (355–382), `.upload-zone` (7, 1214, 1235; component unused) vs `.dz` (1241–1263) | Two upload-zone systems |
| Dark mode | token swap (458–518), then the "Dark-theme safety net: text that hard-codes light-theme greys" (519–545), which recolours `td,li,p:not([class])`, `span:not([class])`, `th`, `.topbar span` and others with broad descendant selectors, then the Fieldbook dark tokens (≈1527–1533) | The safety net exists because ~100+ declarations hard-code light greys (`#636e79`, `#4a5661`, `#35414c`, `background:#fff` on `.btn`/`.field`, line 4–5). Inline `style` colours in TSX (automation-panel, evidence-manager, rules) escape it entirely |
| Tokens | original `:root` (2), dark (459), glass/press/cat tokens (546–548, 755), Fieldbook `--fb-*` with a "remap of the older variables" (≈1505–1525) | Four token generations. Components also hard-code hex values (`#167a45` ×many, `#86d3a5`, `#fde68a`, `#2a10b8`) |
| Fonts | `@import` of Questrial (1); `--font` Century Gothic stack (2); `'Instrument Sans'` in `.judgement-filters` (137, dead) | Body text sizes of 10.5–11px are common (`.field`, `.btn`, `.nav-item`, `.global-search input` at 3–5; `.jw-kpi small` at 675), which hurts readability |
| `!important` | 13 occurrences, mostly in the Fieldbook layer (≈1534–1542) | Locks out future overrides |

### Focus-indicator and contrast findings derived from the CSS

| Selector (line) | Issue | Ratio |
|---|---|---|
| `.field,.select-field,.textarea-field{outline:0}` + `:focus{border-color:#9aa8b3;box-shadow:0 0 0 3px #72849312}` (5) | **The focus indicator for every form control in the app**: grey border plus a 7%-alpha shadow | 2.43:1 border, shadow ≈ invisible. Fails 2.4.7 (practically) and 1.4.11 |
| `.global-search input{outline:0}`, `:focus-within{border-color:#b9c2ca}` (3) | Weak search focus | 1.81:1 |
| `.jw-tools select:focus{outline:none}` (787), `.jx-comment textarea:focus{outline:0}` (322) | Outline removed, replaced by a border colour only | – |
| Input boundary `--line-strong #d9dee3` on white (2); Fieldbook `#C5BB9F` on `#FAF8F0` (≈1508) | Input borders below 3:1 (1.4.11) | 1.35:1 / 1.80:1 |
| Fieldbook `:focus-visible{outline-color:var(--fb-brass)}` (≈1543) | Brass `#C69B4B` ring on paper surfaces | 2.15–2.41:1 |
| `.jw-kpi:focus-visible #86d3a5` (679), `.mt-*:focus-visible #fde68a` (1295, 1411, 1434; fine on the felt, 1.25:1 if reused on light), `.workspace-card:focus-visible #69a77a` (46), `.gd-btn:focus-visible #2a10b8` (1185, dark) | Hard-coded ring colours fail on some surfaces | 1.8 / 2.6 / 1.5:1 |
| Inline TSX colours in dark mode: `#166534`, `#b42336` (automation-panel.tsx:12, :84, :87) | Status text and icons | 2.4 / 2.7:1 |

Recommendation: one rule, `:where(a,button,input,select,textarea,summary,[tabindex]):focus-visible{outline:2px solid var(--focus);outline-offset:2px}`, with `--focus` validated at ≥3:1 in both themes. Delete the per-component ring colours and all `outline:0` declarations.

---

## 16. Empty / loading / error state matrix

| Route | Empty | Loading | Error | Gaps |
|---|---|---|---|---|
| /workspace | n/a | root bar | redirects | – |
| /judgement | yes (5 styles) | yes (deck progress, step spinner, detail spinner) | `jx-error` (role on some) | `queryError` has no role; no route skeleton |
| /rules | yes | static | n/a | – |
| /daily-update, /imports | history `empty-note` | button spinners | callout without role | history fetch error swallowed |
| /substances | `empty-state` | button spinner | callout without role | no live result |
| /supplier-precheck | `empty-note` ×2 | `sc-busy role=status` | mixed roles, duplicated messages | poll errors swallowed |
| /follow-up | `empty-note`, plain td | text "Preparing…" | callout without role | load errors swallowed; test button can stick |
| /settings | `empty-note` | spinners | `ta-err role=alert` | recipient errors silent |
| /approvals | `empty-state` (stale copy) | spinner | callout without role | – |
| /evidence | `empty-state` | spinner | callout without role | fetch errors swallowed; Refresh no-op |
| /register/[id] | `empty-note` | spinner | `feedback-error` without role | default 404 |
| /imds-tracker | Tracker-internal | Tracker-internal | plain-text 403/500/503 | no chrome or back link |
| auth pages | n/a | spinners | `auth-error` | false success on "Ask an administrator" |

---

## 17. Dead buttons, links and dead ends (consolidated)

1. Enter on any focused link while a decided card is showing triggers a save instead of navigation (review-deck.tsx:392). This is a hijacked control rather than a dead one.
2. Sidebar Settings icon for suppliers leads to a redirect (app-shell.tsx:71).
3. Global search for suppliers leads to a redirect (app-shell.tsx:54). On ≤800px the search cannot be reached at all (globals.css:9).
4. The "To judge" pile does nothing once a stack is open (review-deck.tsx:298).
5. Evidence "Refresh" does nothing for an empty or invalid UUID (evidence-manager.tsx:11).
6. The Approvals empty state points to "Judgement Studio", which is not rendered anywhere (approval-queue.tsx:8).
7. "UUID from Case Management": /cases redirects to /workspace (evidence-manager.tsx:16, cases/page.tsx:2).
8. Orphan routes with no inbound navigation: /approvals, /imports, /register/[id] (its only link is in unused `register-table.tsx:77`), and /evidence (reachable only via that orphan).
9. The footer "V0.2.2 ↗" looks like a link and is not (app-shell.tsx:80).
10. Unused components: `judgement-studio.tsx`, `register-table.tsx`.
11. Classes used but undefined: `btn-red`, `state-ready`, `source-link`, `distribution-note`.
12. Auto-judge settings toggles look editable to non-approvers via `?autojudge=settings`; saves fail on the server (autojudge-card.tsx:146-151).

---

## Top 15 highest-impact fixes

1. **P0. Scope the flashcard keyboard shortcuts** (review-deck.tsx:384-397). Enter, 1–9 and the arrow keys should act only while focus is inside the card. Never treat Enter on links or summaries as "confirm". Default "also answer N similar" to off. Add a shortcut on/off setting (WCAG 2.1.4).
2. **P0. Confirm before enabling Auto-judge** (autojudge-card.tsx:147-151). Enabling live mode or a rule family needs an explicit dialog that names the approver and date written to the audit log, a visible "saved" confirmation, and `disabled` controls when `!canConfigure`.
3. **P1. Add one global focus-visible rule** with a token that reaches ≥3:1 in both themes. Remove `outline:0` from `.field/.select-field/.textarea-field` (globals.css:5), from search (3) and from the other cases (322, 787). Fix the Fieldbook brass ring (≈1543).
4. **P1. Associate all form labels.** There are about 45 `<label>`s without `htmlFor` across supplier-precheck, supplier-followup, evidence-manager, register-editor, import-workbook, substance-search, approval-queue and settings. Only one `htmlFor` exists in the whole app.
5. **P1. Replace `window.confirm`/`prompt`** (×8) with one accessible `ConfirmDialog` that has a focus trap and a labelled reason field. Fix the literal `\\n` in judgement-workspace.tsx:294.
6. **P1. Untangle the /follow-up messaging.** Separate "Outlook draft (manual send)" from "Power Automate send". Align the header, badge and side-card copy with what the page actually does. Name one primary e-mail path across Judgement, Tracker and Settings.
7. **P1. Unify the queue vocabulary and counts on /judgement.** "Judged" must mean one number. Merge "Awaiting KM" and "Waiting TMA". Show one queue header instead of three count widgets.
8. **P1. Make the self-check upload keyboard-accessible** by replacing the hidden-input label with the shared `DropZone` (supplier-selfcheck.tsx:149-151). Fix DropZone's nested button (drop-zone.tsx:46, :67).
9. **P1. Fix the mobile shell.** Make global search reachable at ≤800px (globals.css:9). Make the off-canvas sidebar `inert` while closed, with Escape to close, `aria-expanded` and focus return. Add a skip link and `aria-current="page"`.
10. **P1. Fix the routes and information architecture.** Link or retire /approvals, /evidence, /register/[id] and /imports. Remove /cases and "Case Management" wording. Open evidence from the judgement drawer with the case pre-filled instead of a typed UUID.
11. **P1. Make the register editor stop bypassing the guided judgement** (register-editor.tsx:32-34): Judge read-only there, or the same engine-backed save path with enforced comments.
12. **P1. Fix the dark-mode contrast of inline colours** (automation-panel.tsx:12, :84, :87; evidence-manager.tsx:19; import and substance icon colours). Replace the hex values with tokens and ban inline colour styles.
13. **P1. Correct the approvals visuals**: define the danger button (`btn-red` is undefined), make FINAL_NG red rather than green, and explain why each Final button is disabled.
14. **P2. Consolidate `globals.css`.** Delete the dead layers (`judgement-*` 72–182, `jx-*` list 271–333, `rd-*` 795–873, `jb-stack*` 1047–1062, `.fc-*`, old cat scenes 645–663, `.upload-zone`). Collapse the shell and sidebar to one block. Fold the dark "safety net" (519–545) into tokens. Keep one token generation (Fieldbook) and remove `!important`. Then extract the shared `Button`, `Badge`, `Card`, `EmptyState`, `InlineAlert`, `Tabs` and `PageHeader` components listed in section 14.
15. **P2. Standardise feedback states.** Give every error `role="alert"` and every notice `role="status"`. Remove the duplicated precheck messages. Surface the swallowed fetch errors (imports history, follow-up, automation, evidence, precheck poll) and the false success in login "Ask an administrator". Add `error.tsx` and `not-found.tsx`, plus a styled response for /imds-tracker 403/500/503.
