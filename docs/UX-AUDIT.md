# UX, accessibility, data and performance audit — 2026-11-18

Three read-only audits ran in parallel before any redesign work. Full reports, with file:line evidence:

- `docs/audit/2026-11-18-ux-accessibility.md`: every route, WCAG 2.2 AA, states, component inventory
- `docs/audit/2026-11-18-domain-history.md`: where a case's history lives, counter definitions, import safety
- `docs/audit/2026-11-18-performance.md`: bundle sizes, slow lookups, duplicate fetches, CSS

This page lists what each finding led to on branch `redesign/fieldbook`. **Fixed** means the change is in the branch
and covered by a unit or e2e test, or by a measurement. **Open** means it is not done yet.

## Critical and high

| Finding | Status | Where |
|---|---|---|
| Enter on any focused link (sidebar, Back to menu) saved the judgement on a decided card; 1–9 also answered from anywhere (WCAG 2.1.4) | **Fixed.** Shortcuts only fire while focus is on the judgement table, and never from links, tabs, switches, dialogs or fields | `components/review-deck.tsx` |
| Auto-judge on/off, shadow mode and rule-family switches saved on a single click; the panel looked editable to roles without rights | **Fixed.** Changes are staged, listed and saved with "Save and approve". Turning live on gets a red confirm. Roles without rights see a read-only summary | `components/autojudge-card.tsx` |
| Focus outline removed on inputs; the brass ring was about 2.2:1 | **Fixed.** One `:focus-visible` ring: forest `#20543B` on paper, `#D9B56C` on dark | `app/globals.css` (accessibility pass) |
| About 45 labels not tied to their controls | **Mostly fixed.** 37 tied with `htmlFor`/`id`, 2 decorative labels changed to text. Wrapping labels were already valid | supplier-followup, supplier-precheck, evidence-manager, register-editor, import-workbook, substance-search, approval-queue |
| "Judged" showed two different numbers; "Awaiting KM" and "Waiting TMA" named the same state | **Fixed.** KPI renamed "All judged" (Waiting TMA + Judged). One term everywhere: Waiting TMA | judgement-workspace, judgement-overview, miko-table |
| "WORKING" tested two ways, so counters disagreed on "Working " | **Fixed.** One `isWorking()` for piles, overview, deck and workspace (unit test) | `lib/judgement/piles.ts` |
| /follow-up said "Outlook draft only" while its first panel sends through Power Automate | **Fixed (copy).** Header and panel now name both paths | `app/follow-up/page.tsx`, `components/supplier-followup.tsx` |
| Supplier self-check file picker unreachable by keyboard | **Fixed** | `components/supplier-selfcheck.tsx` |
| Mobile: global search unusable at ≤800px; closed sidebar links still in the tab order | **Fixed.** Search button opens the command palette; closed sidebar is hidden from Tab; Esc closes it; `aria-expanded` | `components/app-shell.tsx` |
| No `error.tsx` or `not-found.tsx` | **Fixed** | `app/error.tsx`, `app/not-found.tsx` |
| `btn-red` (Final NG) undefined; FINAL_NG shown green | **Fixed** | globals.css, approval-queue |
| Flow chart: no keyboard scroll, CSS `zoom`, no tree semantics | **Partly fixed.** Focusable canvas with arrows, + −, F and 0; transform zoom; nodes are buttons. Nested list or tree semantics still **open** | `components/flow-library.tsx` |
| Literal `\n\n` in the bulk-apply confirm | **Fixed** | judgement-workspace |
| Sidebar said "Confidential"; the data is PROTECTED | **Fixed** | app-shell |
| `window.confirm`/`prompt` used for consequential actions (8×) | **Open.** Needs one accessible ConfirmDialog | — |
| /approvals, /evidence, /imports, /register/[id] have no menu entry; /cases redirects twice | **Open** (information architecture) | — |
| Register editor sets OK/NG without the rule engine | **Open** | `components/register-editor.tsx` |
| Inline hex colours in automation panel and evidence (dark mode 2.4–2.7:1) | **Open** | — |
| ~179 dead CSS selectors, 9 stacked style generations, 13 `!important` | **Open.** Tokens are unified; the old layers are not deleted yet | `app/globals.css` |

## Case history (new, from existing records only)

`GET /api/judgement/history?itemId=` and the **History** tab next to the card. They read import snapshots, the
register change log, audit events, rule runs and approvals, follow-ups, remembered answers, TMC escalations,
evidence and tasks. No migration and no new table.

- Times are shown as stored: a timestamp, a date only, or "Undated". None is made up.
- A judge value with no log entry is labelled "taken from the G-CATS source", never as a person's action.
- If your role cannot read a source it is listed as "Not visible to your role". If the table is missing in this database it is listed as "Not available".
- "What is not recorded" lists the real gaps: import changes are not logged per field; there is no trace for bulk, auto-judge or editor saves; the G-CATS entry time is not recorded; earlier remembered values are not kept.

## Counter definitions (after this branch)

| Counter | Meaning |
|---|---|
| To judge | `isWorking(source_status)` and no judge |
| Waiting TMA | Judge set, TMA/KM judge empty. Already judged, so it is **not** remaining work |
| Judged (pile) | Judge and TMA/KM judge both set |
| All judged (KPI) | Waiting TMA + Judged |
| Other | Not WORKING and not judged (closed or accepted in G-CATS). Kept, never deleted |

Scope: the newest committed snapshot of the current year. Older rows are not deleted.

## Side findings for the owner (not changed here)

- **Possible trigger bypass.** On a database connection reused after an import, `app.gcat_import_batch` can read `''` instead of NULL. `guard_gcat_judgement_columns` would then skip its checks. Needs a test and a migration.
- **Readable by suppliers.** `judgement_runs`, `approvals`, `verification_tasks`, `confirmations` and the rule tables use `using (true)`, so supplier accounts can read them.
- **Committing an older workbook after a newer one rolls fields back.** There is no recency guard.
- **Audit and change-log inserts are never checked for errors.** Gaps in history are silent.

## Performance, measured

| Measure | Before | After | How |
|---|---|---|---|
| /supplier-precheck first-load JS | 3,869 KB raw / 474 KB gzip | 781 KB / 226 KB | `route-bundle-stats.json`, gzip −9 |
| Routes without their own Supabase use (e.g. /rules, /settings, /workspace) | ~720–734 KB / ~205–209 KB | ~474–513 KB / ~142–155 KB | same |
| /judgement first-load JS | 815 KB / 234 KB | 835 KB / 242 KB (+ command palette, case panel) | same |
| `lookupSubstance` | 0.96 ms per call | 0.20 ms | Node, 200 calls |
| `lookupSubstanceByName` | 16.1 ms per call | 0.002 ms | Node, 200 calls |
| Mass case opened in the drawer | 2 rule checks | 1 | code path (derived class no longer re-triggers) |
| Hidden mascot | reads layout on every pointer move | paused while off screen | IntersectionObserver |
| globals.css | 166.7 KB (built) | 184.1 KB (built) | **Worse.** New layers were added and the old ones not yet deleted |

Not measured: Core Web Vitals on production with real data. No signed-in production session was available.
