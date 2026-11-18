# Performance audit: imds_control (Next.js 16.4.6, Turbopack)

Date: 2026-11-18. Method: copied the repo to `scratchpad/perf-copy` (tar copy; `node_modules` hard-linked, because Turbopack rejects a symlinked `node_modules` outside the project root and the first build failed with "Could not find the Next.js package"). Ran `npx next build` there: **exit 0**, compiled in 22.0 s, TypeScript 18.1 s, 53 static pages generated. The original repo was not modified and no build ran in it.

Not measured: Core Web Vitals (LCP/INP/CLS), real browser timings, RSC payload sizes with production data. The app needs Supabase and data, so it was not run in a browser. Sizes of the CDN scripts that the tracker loads were not measured either: the proxy returned 403 for cdnjs and jsdelivr.

Raw logs and data are in the scratchpad: `build2.log`, `route-sizes.txt`, `css-stats.json`.

---

## 1. Per-route First Load JS

Next 16 no longer prints the size table. These numbers come from `.next/diagnostics/route-bundle-stats.json` (the chunk list for each route), with gzip -9 and brotli computed over those chunk files.

Shared by all 20 page routes: 7 chunks, **720.5 KB raw / 204.9 KB gzip / 175.1 KB brotli**.

| Route | First-load raw KB | gzip KB | brotli KB | route-specific raw KB |
|---|---:|---:|---:|---:|
| **/supplier-precheck** | **3868.9** | **474.1** | **362.8** | **3148.4** |
| /judgement | 814.7 | 233.8 | 200.1 | 94.2 |
| /follow-up | 745.5 | 212.5 | 181.5 | 25.0 |
| /daily-update | 740.7 | 211.0 | 180.3 | 20.1 |
| /imports | 740.7 | 211.0 | 180.3 | 20.1 |
| /settings | 733.7 | 208.8 | 178.5 | 13.2 |
| /evidence | 733.3 | 209.1 | 178.7 | 12.8 |
| /register/[id] | 732.6 | 208.5 | 178.1 | 12.1 |
| /login, /forgot-password | 729.3 | 207.5 | 177.3 | 8.7 |
| /substances | 727.9 | 207.6 | 177.3 | 7.4 |
| /rules | 727.8 | 207.5 | 177.4 | 7.2 |
| /approvals | 724.4 | 206.5 | 176.4 | 3.9 |
| /reset-password | 724.0 | 206.4 | 176.3 | 3.4 |
| /, /cases, /workspace, /imds-tracker/master, /setup-required, /_not-found | 720.5 | 204.9 | 175.1 | 0.0 |

`/imds-tracker` is a route handler that serves the private HTML. It is covered in section 5.

### Biggest client chunks (`.next/static/chunks`, 25 files, 4.4 MB total)

| Chunk | raw | gzip | brotli | routes | Contents (identified by signature strings) |
|---|---:|---:|---:|---:|---|
| `0bvro6bz-aiyv.js` | 3,218,419 | 273,416 | 190,313 | 1 (/supplier-precheck) | **Full GADSL reference JSON**: all 7,285 records with every field (`supportingInformation` appears 7,285 times; the `"GADSL-Reference-List_2026_V1.xlsx"` source string is present). It also contains gadsl-deletions, Appendix 3/4/5/6, plus PrecheckTabs, SupplierSelfCheck and the intake code |
| `2z95dw1ne2glo.js` | 258,762 | 67,344 | 56,939 | 20 (all) | `@supabase/ssr` + supabase-js (GoTrueClient, RealtimeClient, createBrowserClient) |
| `39_j1bdzreq0m.js` | 229,288 | 71,586 | 61,310 | 20 | react-dom + Next runtime |
| `3h62st2t0uzl_.css` | 166,701 | 32,557 | 27,572 | all (CSS) | built `app/globals.css` |
| `01ogvsbdjecyx.js` | 164,040 | 45,092 | 38,322 | 20 | React / Next client runtime |
| `0cz1d0mv5g_q7.js` | 112,594 | 39,520 | 35,158 | 0 | core-js polyfills (not part of any first load) |
| `1-h01-jrfksec.js` | 93,362 | 28,536 | 24,710 | 1 (/judgement) | JudgementWorkspace, ReviewDeck, AutoJudgeCard, CatStage (cat3d), GcatsDetailView |
| `0qi9vnuvjcabz.js` | 35,857 | 11,272 | 9,878 | 20 | AppShell + lucide icons |

The server also holds 3 copies of the GADSL data: `.next/server/chunks/_00plnqyvwh2rm._.js` (3.17 MB), `ssr/_0b8ux379ubifc._.js` (3.22 MB) and `ssr/_0hxfrixhyu_o3._.js` (3.24 MB). One of them exists only because the client component is server-rendered.

---

## 2. Client components that import heavy server-side reference data

Import trace, from a static walk of every `"use client"` file in app/components/lib:

```
components/supplier-selfcheck.tsx:6   import { detectColumns, ... } from "@/lib/intake/detect"
lib/intake/detect.ts:1                import { isValidCas } from "@/lib/reference-data"
lib/reference-data.ts:1-6             import gadsl  (gadsl-reference-2026-v1.json, 3,005,549 B)
                                      import deletions (91,684 B), tsz3 (16,556 B), pops (28,758 B),
                                      annex17 (18,577 B), annex14 (4,179 B)   = 3,165,303 B of JSON
```

- `detect.ts` uses only `isValidCas` (lines 152-153), which is pure string math. Tree-shaking cannot remove the JSON because `lib/reference-data.ts:8-14` evaluates `gadsl.records` and similar at module top level.
- The page loads this for **every supplier-portal visitor** (`app/supplier-precheck/page.tsx`), even when they never open the "Check a file" tab: all tabs are rendered eagerly through `PrecheckTabs`.
- Parse and compile cost was measured in Node on this server only as a proxy: `JSON.parse` of the GADSL file takes 12.5 ms (median of 7), and V8 compile of the 3.2 MB chunk takes 10.1 ms. Mobile devices will be slower, but that was not measured.
- Data-handling note for the security owner: the complete reference list is shipped to external supplier browsers. It was intended as server-side reference data.
- The other client imports of JSON are small: `automation-panel` and `supplier-followup` pull `followup-templates.json` (4.1 KB) and `historical-error-distribution.json` (0.8 KB).

---

## 3. Expensive computation (server side, measured)

Micro-benchmark of the real `lib/reference-data.ts` functions, run under Node 22 with type stripping (500 calls after warm-up):

| Function | ms per call | Cause |
|---|---:|---|
| `lookupSubstance(cas)` | **1.04** | linear `filter` over 7,285 GADSL + 235 deletion records, with a regex `normalizeCas` on every record on every call (`reference-data.ts:86,90`) |
| `lookupSubstanceByName(name)` | **14.49** | NFKC normalize + `toLocaleLowerCase` + 2 regexes on 7,285 names on every call (`reference-data.ts:41-42`) |

These run once per case in `lib/judgement/auto.ts:56,75`. ReviewDeck sends 200 ids per `/api/judgement/bulk` preview call, so one chunk spends about 208 ms on CAS lookups alone, and up to about 3.1 s when the masked-CAS name fallback runs for every case. Prebuilt `Map` indexes keyed by normalized CAS and normalized name would make both calls O(1).

---

## 4. React rendering, effects and duplicate fetches

### judgement-workspace.tsx (the /judgement page)
- **Duplicate fetch, line 119 with deps at line 126**: the `/api/judgement/auto` effect calls `setToleranceClass(result.massBands.toleranceClass)` from its own result. `toleranceClass` is in the effect deps, so every mass-type case opened in the drawer **fires the auto check twice**.
- **Duplicate work, lines 278 and 389 vs review-deck.tsx:92-108**: ReviewDeck is always mounted (`<div hidden={view !== "judge"}>`, line 389). On page load it posts **all** pending ids to `/api/judgement/bulk` `action: "preview"` in 200-id chunks. "Group identical" (`analyzeVisibleQueue`, line 278) then posts up to 250 of the same ids for the same preview computation again. Combined with section 3, this is the heaviest server path in the app.
- **Values not memoized, recomputed on every keystroke in the search box**:
  - `prohibitedRows` (line 228): runs 2 regexes over every row.
  - `pendingInView` (line 337).
  - `openRow` `rows.find` (line 336).
  - `pendingIds={pendingRows.map(...)}` and `judgedIds={rows.filter(...).map(...)}` (lines 392-393) create new arrays on every render and pass them into AutoJudgeCard.
- **Realtime fan-out, line 198**: each Supabase `UPDATE` event runs `setRows(prev.map(...))`. That invalidates every `useMemo` keyed on `rows`: `pileCounts`, `summarizeRegister`, `buildCommentHistory`, `pendingRows`, `visible`, plus ReviewDeck's `rowById`, all at lines 236-264. During an autorun or bulk apply, N saved rows produce N full recomputations across all rows. Batching the events, for example a 250 ms buffer, would fix this.
- **Main table is paginated**: `PAGE = 80` (line 36) and `visible.slice(0, limit)` (line 435), so it does not need virtualization. "Show more" grows the table without limit (+80 per click).
- **Group case lists, line 422**: each group's `<details>` renders all its items (up to 250) into the DOM even while collapsed. React renders children of a closed `<details>`.

### review-deck.tsx
- Memoization is mostly good: `views`, `open`, `stacks` and `deck` are all `useMemo`.
- `decidedHere` (line 149) is not memoized.
- `similarTo` (line 176) is an O(n) scan per call, with `answerKey` recomputed for every candidate.

### gcats-detail-view.tsx
- The `parts` aggregation is memoized (line 23). `ready` and `shown` (lines 34 and 36) are not, so they rescan on every keystroke. The impact is minor.
- The part list is capped at 300 (line 66).
- The detail grid renders all of a part's rows, which is bounded per part.

### Flow charts (flow-library.tsx)
- Memoized (lines 25 and 31) and small: 100 lines of code and a 4.6 KB flow JSON. No issue found.

### cat-stage.tsx (rendered inside AutoJudgeCard)
- Lines 28-36 attach a global `pointermove` listener that calls `getBoundingClientRect()`, a forced layout read, and then `setState` once per animation frame.
- It stays mounted while the Judge view is hidden, because ReviewDeck is kept mounted at line 389, so it keeps re-rendering on mouse movement in the list and detail views.
- It does respect `prefers-reduced-motion`.

### Polling
- `sync-pill.tsx:24-25`: on every page, first poll after 1.5 s, then every 60 s. Skipped when `document.hidden`, which is good. Each open tab may POST `/api/automation/dispatch`.

### Server-side duplicate auth
- The root layout uses the cached `getAuthContext` (React `cache`, `getClaims` + `profiles`).
- These pages call `supabase.auth.getUser()` again, which is a network round-trip to Supabase Auth, and re-query `profiles`: `app/supplier-precheck/page.tsx`, `app/settings/page.tsx`, `app/approvals/page.tsx`, `app/register/[id]/page.tsx`.
- `proxy.ts:35` also calls `getClaims()` on every request.

### Judgement RSC payload
- `app/judgement/page.tsx` loads every current-year row in pages of 1,000 and passes the full array to the client component. The payload size could not be measured without data. It grows linearly with the number of rows.

---

## 5. CSS and private/imds-tracker.html

### app/globals.css (postcss 8 parse)
| Metric | Value |
|---|---|
| Size | **175,101 B** (35,215 B gzip); 1,501 lines (minified-style long lines, up to 4,807 chars) |
| Rules (excluding keyframes) / declarations | **1,953** / 6,596 (27 `!important`) |
| At-rules | 58 `@media`, 21 `@keyframes`, 1 `@supports`, 1 `@import` |
| Distinct selectors | 1,993 |
| **Duplicated selectors** | **151** selectors defined more than once (175 extra occurrences). Worst cases: `:root` ×4 (lines 2, 547, 754, 773), `html[data-theme="dark"]` ×4, `.textarea-field` ×4, `.mt .jb-confirm-all` ×4 (1288, 1405, 1410, 1494), `.jx`/`.jx-row` ×3 |
| Probably-dead CSS (heuristic: class name not found anywhere in app/components/lib source) | 169 of 719 classes; **449 rules / ~37.7 KB** (about 21%). Examples: `register-*`, `judgement-hero`, `judgement-kpi*`, `judgement-month*`, `dashboard-grid`, `upload-zone`, `jx-row` |
| Built CSS chunk | 166,701 B, loaded on every route because it comes from the root layout |
| Render-blocking chain | `@import url(fonts.googleapis.com/...Questrial)` at line 1 is kept in the built CSS. That makes a serial CSS → Google CSS → font request chain. Use `next/font` instead |

**Infinite animations** (11 declarations):
- `.spin` (line 7): not inside a reduced-motion guard, but only visible while loading.
- `.route-loading-bar` (line 268): has a reduce guard at line 270.
- `.mt-slot-card` `mt-shuffle` (line 1330): reduce guard at line 1366.
- Cat mascot, guarded by `prefers-reduced-motion: no-preference`: `cat-tail`, `cat-eyes` and `cat-dots` (618-620), `cat-breathe` (766), `cat-float`, `cat-blink3` and `cat-ears` (1383-1387).
- All of these animate `transform`/`opacity` only. However, they animate SVG sub-elements, which are generally not compositor-promoted, so they can cost a paint every frame while visible. Verify in a DevTools Performance trace; this was not measured.

**Expensive paint**: `backdrop-filter: blur(14px) saturate(1.2)` on `.jx-command,.aj,.jx-groups,.jx-row` (line 550, and `.jx-row` appears unused), and `blur(12px)` on the sticky `.jw-drawer-head` (line 705).

### private/imds-tracker.html (served by app/imds-tracker/route.ts)
| Metric | Value |
|---|---|
| HTML | **338,367 B** (106,014 gzip / 90,296 br): one `<style>` of 55,664 B and one inline `<script>` of 251,333 B |
| Injected `shared-master-sync.js` | 92,740 B (26,854 gzip) |
| Served document | ~431 KB raw / **132,261 B gzip** / 111,751 br |
| Caching | `Cache-Control: private, no-store`, so it is fully re-downloaded on every visit. The route reads both files from disk on every request (route.ts `readFile` ×2) instead of caching them in module scope |
| Blocking third-party scripts | Lines 798-801: `xlsx.full.min.js` 0.18.5, `jspdf.umd.min.js` 2.5.1, `jspdf.plugin.autotable` 3.8.2, `msal-browser` 2.38.2. All are synchronous with no `defer`/`async` and run before the app script. Sizes not measured |
| Rendering | 44 `innerHTML=` sites. The supplier table (line 1671) and the supplier drawer part rows (line 1732) render without a limit; history (line 1876) and duplicates (line 1905) are capped at 200 |
| Motion | 3 infinite animations (lines 153, 213, 214). A global reduce override exists at line 506 |
| Polling | `setInterval` at line 1342 is guarded by `document.hidden` |

---

## 6. Prioritized fix list

| # | Fix | Evidence | Expected impact |
|---|---|---|---|
| **P0** | Move `normalizeCas` and `isValidCas` into a pure module (for example `lib/cas.ts`). Make `lib/intake/detect.ts` and `lib/judgement/bulk.ts` import from there. Add `import "server-only"` to `lib/reference-data.ts` so the build fails if it ever reaches a client bundle again | detect.ts:1, reference-data.ts:1-14, chunk `0bvro6bz-aiyv.js` | /supplier-precheck first-load drops from **3,869 KB to about 0.77 MB raw**, and from **474 KB to roughly 215 KB gzip** (estimate: the chunk minus ~3.17 MB of JSON). Also removes one ~3.2 MB SSR server chunk and stops shipping the full reference list to supplier browsers |
| **P1** | Build `Map` indexes once in reference-data, keyed by normalized CAS (GADSL, deletions, TSZ CAS tokens) and by normalized name | Benchmark in section 3 | `lookupSubstance` goes from 1.04 ms to microseconds and `lookupSubstanceByName` from 14.5 ms to microseconds. That saves about 0.2-3 s of server CPU per 200-case bulk preview chunk |
| **P1** | Remove duplicate fetches: (a) do not put `toleranceClass` set from the result back into the effect deps, or use a ref or a separate "derived" state; (b) let "Group identical" reuse ReviewDeck's already loaded preview candidates instead of re-posting the same ids; (c) start ReviewDeck's full-queue preview only when the Judge view is shown, or lazily per stack | judgement-workspace.tsx:119/126, 278; review-deck.tsx:92-108; workspace:389 | One fewer `/api/judgement/auto` call per mass case opened. One fewer bulk preview of up to 250 cases per "Group identical". No full-queue evaluation when the user goes straight to the list or detail view |
| **P1** | Replace per-page `auth.getUser()` + `profiles` with the cached `getAuthContext()` (or extend it with `supplier_code`) | supplier-precheck, settings, approvals, register/[id] pages | Removes one Supabase Auth network round-trip and one DB query per request on those routes |
| **P2** | Load supabase-js lazily in `SignOutButton` (`const { createClient } = await import(...)` inside `signOut`) | sign-out-button.tsx:4; chunk `2z95dw1ne2glo.js` is in all 20 routes | About **67 KB gzip / 259 KB raw** less on routes that do not otherwise use the browser client (/, /cases, /workspace, /rules, /substances, /approvals, /settings, /follow-up and others). Routes that do use it (judgement, login, evidence, imports, supplier-precheck) are unchanged |
| **P2** | Workspace render hygiene: `useMemo` for `prohibitedRows`, `pendingInView`, `pendingIds` and `judgedIds`; batch realtime UPDATE events (buffer, then one `setRows`); render group `<details>` content only when open | judgement-workspace.tsx:198, 228, 336-337, 392-393, 422 | Fewer full-array passes per keystroke and per realtime event. The difference is largest during autorun or bulk apply on large queues |
| **P2** | Unmount, or pause the pointer listener of, CatStage/AutoJudgeCard while the Judge view is hidden. Throttle the pointer handler and read the rect once on resize instead of on every move | cat-stage.tsx:28-36; workspace:389 | Removes a forced layout read and a React re-render per frame during mouse movement on the list and detail views |
| **P2** | CSS cleanup: drop the ~37.7 KB of probably-dead rules after verifying them, merge the 151 duplicated selectors, replace the Google Fonts `@import` with `next/font`, and remove `backdrop-filter` from list-like elements | globals.css lines 1, 550, 705; duplicate list in `css-stats.json` | About 20% smaller CSS on every route, no serial font request chain, and cheaper scrolling paint |
| **P3** | Tracker: `defer` the 4 CDN scripts, or load xlsx and jspdf on demand when an export starts. Cache the two private files in module memory. Allow `private, max-age` with ETag revalidation instead of `no-store` if the security policy permits. Cap or paginate the supplier table and drawer rows | imds-tracker.html:798-801, 1671, 1732; app/imds-tracker/route.ts | Removes parser-blocking third-party downloads from the tracker's critical path. Saves disk reads per request. Repeat visits can avoid ~132 KB gzip |
| **P3** | Judgement page: send a slimmer row projection, or page or stream rows instead of the full current-year array | app/judgement/page.tsx (1,000-row loop) | RSC payload grows linearly with rows. Measure this with production data first |
