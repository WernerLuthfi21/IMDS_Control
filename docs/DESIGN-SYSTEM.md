# Design system — "Inspector's Fieldbook"

The IMDS / G-CATS Control Center is a regulatory work tool: people check supplier material data against
Toyota rules and type a result into TMC's G-CATS. The look follows that job — an inspector's field book:
deep forest green chrome, warm archival paper for the work surface, index cards for cases, brass for the
one thing that matters on screen right now. Calm, dense, precise; no decoration that does not carry meaning.

Tokens live in one block at the end of `app/globals.css` (search `FIELDBOOK DESIGN SYSTEM`). It is loaded
last and remaps the older variables (`--bg`, `--surface`, `--ink`, `--green`, `--aj-*`, `--k-*`, `--glass-*`),
so older components pick the palette up without being rewritten. New code uses the tokens below only.

## Colour

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F0EBDD` paper | `#10271D` forest | Page background |
| `--surface` | `#FAF8F0` raised paper | `#173226` | Cards, panels, topbar |
| `--surface-2` | `#F4F0E4` | `#1B3A2C` | Inset areas, inputs, tab rails |
| `--ink` | `#193528` | `#EEE9DB` | Text |
| `--muted` | `#56665B` (5.1:1 on paper) | `#B3C1B5` | Secondary text, labels |
| `--line` / `--line-strong` | `#DAD2BE` / `#C5BB9F` | `#2B4A3A` / `#3A5C4A` | Rules and borders |
| `--fb-brand` | `#20543B` | (accent `#9BD3AE`) | Primary actions, links |
| `--fb-brass` | `#C69B4B` | same | The *active* thing: current nav item, selected card, case path, focus inside the palette. Never body text on paper (use `--fb-brass-ink #7E5D1F`). |
| `--green` / `--fb-ok` | `#2F7049` | `#8FD1A6` | Judge OK |
| `--red` / `--fb-ng` | `#A63F3F` | `#F0A29C` | Judge NG, destructive |
| `--amber` / `--fb-hold` | `#7A5310` (5.7:1 on paper) | `#E6BC6A` | HOLD, TMC, waiting |
| `--blue` / `--fb-info` | `#45708F` | `#9DC0DD` | Information, import events |
| `--focus-ring` | `#20543B` | `#D9B56C` | Every `:focus-visible` outline (≥3:1 in both themes) |

Each status colour has a `-bg` partner for fills. OK/NG/HOLD are always written as words too
("Judge OK", "Contact TMC · hold"), never colour alone.

The sidebar is forest in both themes. Light-theme greys that were hard-coded for white (`#656b71` and
friends) are routed to `--muted` by a single rule, because on paper they fell to 4.4:1.

## Type

Century Gothic is the face (`--font`, with Questrial / URW Gothic / system fallbacks). One family for
everything; hierarchy comes from size and weight.

| Role | Size / weight |
|---|---|
| Page title | 26px / 700 |
| Section title | 15–19px / 700–800 |
| Body | 13–14px / 400–600 |
| Label, eyebrow | 10.5–11px / 700, uppercase, letter-spacing .08–.12em |
| Numbers | `font-variant-numeric: tabular-nums` (set on `body`) |

## Shape, depth, motion

- Radius: `--r-1` 6px (chips, kbd), `--r-2` 8px (buttons, inputs, list items), `--r-3` 12px (cards, panels), `--r-pill`.
- Borders carry structure (1–1.5px `--line-strong`); shadows are small: `--e-1` resting, `--e-2` raised, `--e-3` overlays (palette, popovers).
- Motion: `--ease` `cubic-bezier(.22,1,.36,1)`, `--dur-1` .14s (hover/focus), `--dur-2` .24s (panels), `--dur-3` .36s (cards).
  Card deal (560 ms) and card-to-pile (620 ms) run only after the server confirmed the save.
  **No idle loops**: the mascot's float/ear/tail/blink loops are off; only state changes animate
  (thinking dots and the working gear while work is actually running). Everything respects
  `prefers-reduced-motion: reduce`.

## Components and where they live

| Component | File | Notes |
|---|---|---|
| App shell, skip link, nav (`aria-current`), mobile search | `components/app-shell.tsx` | Sidebar is out of the tab order when closed on mobile; Esc closes it |
| Command palette (Ctrl/⌘ K) | `components/command-palette.tsx` | Dialog + combobox/listbox; ↑ ↓ Enter Esc; returns focus |
| Judgement table (Miko, piles, decks, flashcard) | `components/review-deck.tsx`, `components/miko-table.tsx` | Shortcuts only while focus is on the table |
| Case context (Rule path / History) | `components/case-context.tsx` | Loaded lazily, cached per case |
| Flow chart canvas | `components/flow-library.tsx` | Pan, zoom, fit, reset, step details, case path |
| Miko | `components/cat-mascot.tsx`, `components/cat-stage.tsx` | States below |
| Drop zone | `components/drop-zone.tsx` | One upload pattern for the whole app |
| Auto-judge card | `components/autojudge-card.tsx` | Switches are staged; saving is an explicit approval |
| Error / not-found pages | `app/error.tsx`, `app/not-found.tsx` | `.state-page` |

### Miko's states

Miko reports the table's real state; it is not a chatbot and never blocks the work.

| State | When |
|---|---|
| idle | Waiting for you on a card that needs your answer |
| thinking | The deck is being evaluated |
| working | A save or a batch is in progress |
| success | A card was just saved |
| celebrate | A batch finished, or no unjudged case is left |
| waiting | The current card waits on the supplier, Purchasing or TMC |
| alert (warning) | The current card comes from a draft flow (a person confirms) |
| error | Loading or saving failed |

Clicking Miko opens a small popover: what the piles mean, keyboard shortcuts, and the save rule.

## States every screen must have

Empty (say what would fill it), loading (say what is happening), error (say what failed and that nothing
was written), restricted (say which source your role cannot see), unavailable (say which table is not in
this database). The case History panel is the reference implementation.

## Accessibility rules

- WCAG 2.2 AA: text ≥4.5:1, large text and UI parts ≥3:1, in both themes. The e2e contrast audit
  (`e2e/contrast.ts`) runs on every PR for the pages that render without a database.
- Every control has a name: `<label htmlFor>` + `id`, or a wrapping label, or `aria-label`.
- Keyboard: everything reachable; shortcuts never fire from a link, tab, switch, dialog or text field.
- Focus is always visible (`--focus-ring`).

## Not allowed

Purple gradients, glassmorphism, glow, emoji as icons, infinite idle animation, decorative 3D, fake or
"example" data shown as real (fixtures in screenshots are labelled FIXTURE), inline hex colours in
components (use tokens), new `!important` outside the token layer.
