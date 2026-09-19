# Invesco — UI parity plan

Full rationale, exact CSS values, and pitfall catalog: read
`/tmp/etf-ui-parity-plan.md` (master plan) in full before starting — this
document is the Invesco-specific action list, it does not repeat the
reasoning. Invesco's own `docs/catalog-ui-requirements.md` already has a
written, line-numbered spec for the Frequency column and the catalog sticky
columns — read it, it's correct, follow it for those two pieces. This doc
covers what that one doesn't.

## 1. Already implemented — verify, don't redo

`state.queryByTab` (per-tab search/filter persistence, master plan §5.2) is
already implemented — grep `queryByTab` in `app.tsx` to find it (get/set
around the search-input sync functions). Verify it still works correctly
(switch tabs with different queries, reload, confirm independence) but do
not reimplement it.

## 2. Follow the existing doc for these two (already correct)

- Distribution/Dividend Frequency catalog column — `docs/catalog-ui-requirements.md`
  §1 (or equivalent section). Insert between SEC Yield and YTD Return, coded
  label scheme (`01 - Monthly` etc., see master plan §3), update tooltips/
  colspan/export.
- Pinned catalog Use+Ticker columns — that doc's CSS/markup section for this.
  Use the master plan §4.1 CSS shape and §4.3/§4.4 color values (Invesco uses
  the common `dark:bg-slate-900`/`dark:bg-slate-800/50`/`dark:hover:bg-slate-700/30`/
  `rgba(30,64,175,.22)` stack, already confirmed to match — so the canonical
  hex values apply directly: base `#172033`, hover `#1f2a3d`, selected
  `#19274e`, header `#0f172a` dark / `#f8fafc` light). Do the Ticker column's
  `left`/`width` sizing by actually rendering the table and checking the
  longest real ticker doesn't clip — don't just copy `5rem` blindly.

## 3. Not covered by the existing doc — implement fresh

- **Pinned Watchlist Ticker column.** Not in the existing doc. Add
  `.watchlist-sticky-ticker` (or the two-class `.watchlist-sticky-col` +
  `.watchlist-sticky-ticker` split — either is fine, see master plan §4.1
  notes) using the same CSS shape/colors as the catalog pin. Find the
  Watchlist table's header/row builder (grep `renderWatchlistTable` and its
  `sortHeader('Ticker', 'symbol', ...)` call) and add the sticky class there,
  on the `<th>`/`<td>` directly, never a wrapper. Check what the Watchlist's
  first column actually contains (just a ticker symbol, or something longer)
  to decide between a fixed `min-width` (no truncation) or
  `max-width`+`overflow:hidden`+`text-overflow:ellipsis` (defensive
  truncation) — see master plan §4.1's `<W2>` note.
- **Per-tab sort memory (master plan §5.3).** Not implemented — `app.tsx` has
  no `sortByTab`. Add: a `state.sortByTab: Record<ActiveTab, {key, dir}>`
  field, an `invesco-tab-sorts` localStorage key, `applySortForTab()`/
  `rememberSortForCurrentTab()` functions (called on tab switch and on every
  explicit column-header click respectively), and confirm no other control
  (Clear, blacklist actions, exports, theme toggle) mutates `state.sortKey`/
  `state.sortDir` as a side effect.
- **Selection scopes (master plan §5.4).** Verify the three scopes are
  correctly distinct: row toggle (one ETF), catalog header "select all"
  (scope = current tab + search filter + blacklist exclusion, `.every()`-
  based checked state), "All ETFs" pill (scope = entire non-blacklisted
  catalog from any tab, no navigation). Fix whichever of these three doesn't
  match.
- **Race-free Watchlist aggregation + chunked rendering + dedup fallback
  order (master plan §5.5-§5.8).** Read
  `/Users/maksim.kostromin/Documents/code/private/WisdomTree/docs/ui-contract.md`
  §6-§9 for the exact mechanism (per-ticker serialized load chain, capped
  concurrency, chunked Watchlist rendering with a "load more" sentinel,
  ticker→CUSIP→ISIN→Identifier→SEDOL/FIGI→name dedup fallback with
  placeholder detection). Adapt to Invesco's actual per-fund loading code
  (grep for wherever fund holdings/detail sheets are fetched) and its own
  field names.
- **Blacklist panel smooth expand/collapse (master plan §6).** Grep for the
  blacklist button's click handler (`classList.toggle('hidden')`) and its
  panel CSS. Apply the exact pattern in master plan §6: CSS transition
  contract mirroring whatever expand/collapse panel already exists here (if
  `#selected-tabs-panel.is-visible` already exists — check, per master plan
  §1 Invesco already has this animation contract for the detail-tabs panel —
  reuse the same max-height/opacity/transform/padding/border-color
  transition shape for `#blacklist-panel`, with a JS-measured `scrollHeight`
  instead of a fixed rem value since the chip list is unbounded), remove the
  `hidden` utility class, change `p-4`→`px-4`, swap the JS toggle to
  `classList.toggle('is-visible')` + a `syncBlacklistPanelHeight()` helper.

## 4. Implementation order

Frequency column → sticky columns (catalog then Watchlist) → shared UI
contract (sort memory, selection scopes, race-free Watchlist, chunked
rendering — largest piece) → blacklist animation (independent, any time).

## 5. Verification checklist

- Run `bun test` if a test script exists; extend it for new behavior if it
  does.
- Real/headless browser: scroll catalog and Watchlist tables fully right in
  both light and dark theme — pinned columns stay opaque, no bleed-through,
  header cell matches header row color.
- Switch tabs with different search queries and sorts, reload, confirm both
  are independently remembered per tab.
- Exercise all three selection scopes, confirm each behaves as specified.
- Select many ETFs rapidly (toggle on/off quickly) and confirm the Watchlist
  count/aggregate ends up correct with no duplicate/missing rows.
- Open/close the Blacklist panel — animates smoothly; add/remove a
  blacklisted ticker while open — panel resizes smoothly.
