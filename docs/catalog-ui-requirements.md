# Catalog UI implementation plan: distribution frequency column + pinned columns

> **Status note (2026-09):** Section 2 (pinned catalog columns) has been implemented in `app.tsx` / `index.html` — with one deliberate extension from the shared UI contract ([`docs/ui-contract.md`](./ui-contract.md)): the **Watchlist Ticker column is pinned at the left edge too** (`.watchlist-sticky-ticker`), superseding this plan's "do not touch the Watchlist table" instruction. Section 1 (distribution **Frequency** column) is still an unbuilt plan; the line numbers below refer to the pre-implementation code and have drifted.

This is a concrete, Invesco-specific implementation plan for two catalog-table features that have already been built and verified in the sibling `daggerok/SPDR` repository. It is written for an implementing agent that has no access to SPDR or to the investigation that produced this plan — every instruction below cites the actual file, line numbers, function names, class names, and colors currently in this repo (as of this writing). Follow it mechanically; do not redesign anything.

Both features apply to the **`All ETFs` catalog table only** — the table rendered by `renderFundsTable()` in `app.tsx`. The Watchlist table (`renderWatchlistTable`-style code around line 1063) and the per-fund detail sheets (holdings/history/overview/distributions) all reuse the same `#table-scroll` / `#table-head` / `#table-body` DOM elements, but must **not** be touched by either change below — see the "do not touch" notes in each section.

## Repo layout and build notes (read first)

- `app.tsx` is the entire client application (one file, ~2000+ lines), loaded by `index.html` via `<script type="text/babel" data-presets="typescript" src="./app.tsx">`. Like SPDR/Amplify/Fidelity, it is compiled **in the browser** by Babel standalone at page load — there is no build step and no real type-checking of this file.
- `tsconfig.json` at the repo root only covers `scripts/**/*.ts` (`"include": ["scripts/**/*.ts"]`). It is used for `bunx tsc --noEmit` against `scripts/update-data.ts` and `scripts/update-data.test.ts` only (see `README.md` "Verification before every publish"). **It does not type-check `app.tsx`.** Treat `app.tsx` exactly like SPDR's: Babel-stripped-at-runtime, no `tsc` safety net, so keep the existing house style — no `as` casts, no non-null `!`, no `interface`/`enum`, plain `byId()` instead of DOM casts (see the file-header comment at the top of `app.tsx`, lines 6-11).
- Only `docs/catalog-ui-requirements.md` (this file) should be written by the planning pass; the two features themselves are implemented by editing `app.tsx` and `index.html` only. Don't touch `scripts/update-data.ts` — the raw data this plan uses is already produced there.

## 1. Distribution frequency column

### Current state

Invesco already computes a distribution frequency per fund in the updater:

- `scripts/update-data.ts:1434` — `inferDistributionFrequency(dividends)` derives the cadence from the Yahoo Finance dividend-history feed (median gap between the last up-to-9 ex-dates) and returns one of the **exact literal strings**: `'Monthly'`, `'Quarterly'`, `'Semiannually'` (no hyphen), `'Annually'`, `'None'` (no dividends at all), `'Unknown'` (fewer than 2 usable data points), `'Irregular'` (gaps don't cluster into a recognizable cadence).
- The result is stored at `scripts/update-data.ts:2023` as `distributions: { frequency: frequency.frequency, paymentsPerYear: ..., headers: [...], rows: [...] }`, published in `api/invesco/index.json` per fund and in each fund's `meta.json`.
- In `app.tsx`, the raw string reaches the client as `fund.distributions.frequency` (`IndexFund` type at line 41, `FundRow` type at line 92). Funds with no distributions data (session-only N-PORT uploads) default it to `'—'` (see `app.tsx:1723` and `app.tsx:1750`).
- **Today there is no catalog column for it.** The raw string is folded into the search index only (`app.tsx:415`, inside `normalizeFundRow`). The only place a user currently sees it is the per-fund **Overview** detail tab, as a raw `Section: Distributions / Metric: Frequency / Value: <raw string>` row (`app.tsx:1207`), which must **keep showing the raw label unchanged** — do not touch line 1207 or the `distributions.frequency` field itself.
- A `Frequency` entry already exists in the `COLUMN_TOOLTIPS` map (`app.tsx:169`) with a generic body (`'Distribution frequency (Monthly, Quarterly, ...).'`) that is currently unused as a header tooltip (no column calls `sortHeader('Frequency', ...)` yet). This is the tooltip you will rewrite and finally put to use.

### Gap to close

Add a sortable, coded **Frequency** catalog column, positioned between the existing **SEC Yield** column and the existing **YTD Return** column (this repo's real equivalents of the generic checklist's placement contract), following the same two-digit-prefix coding scheme as SPDR.

### 1.1 Add the normalizer function

Add this function to `app.tsx` near the other formatting helpers (`formatPercent`, `formatMoney`, `formatInteger` at lines 291-309) — put it directly after `formatMoney` (ends at line 309):

```ts
// Two-digit numeric prefix keeps the catalog column's normal ascending sort
// meaningful; the value is derived once in scripts/update-data.ts
// (inferDistributionFrequency, from the Yahoo dividend-history feed) — this
// only recodes the label already published in fund.distributions.frequency.
function formatDistributionFrequency(value: unknown): string {
  const raw = String(value ?? '').trim();
  const normalized = raw.toLowerCase().replace(/[‐‑‒–—]/g, '-').replace(/\s+/g, ' ');
  if (!normalized || normalized === '-' || normalized === '—') return '00 - —';
  if (normalized === 'monthly') return '01 - Monthly';
  if (normalized === 'quarterly') return '04 - Quarterly';
  if (normalized === 'semiannually' || normalized === 'semi-annually' || normalized === 'semi-annual' || normalized === 'semiannual') return '06 - Semi-annually';
  if (normalized === 'annually' || normalized === 'annual') return '12 - Annually';
  if (normalized === 'none') return '00 - None';
  if (normalized === 'unknown') return '00 - Unknown';
  if (normalized === 'irregular') return '99 - Irregular';
  return raw;
}
```

Note `inferDistributionFrequency` only ever emits `'Semiannually'` (no hyphen), but the normalizer also accepts the hyphenated spelling variants for defensiveness, matching the SPDR convention.

### 1.2 Compute it on every row

In `normalizeFundRow` (`app.tsx:389-416`), add one field to the `row` object literal (right after the existing `secYield` line at `app.tsx:408`):

```ts
        secYield: metrics.secYield ?? null, // invesco.com publishes it for most fixed income funds only.
        frequencyCode: formatDistributionFrequency(fund.distributions && fund.distributions.frequency),
```

And add the field to the `FundRow` type (`app.tsx:60-95`), next to the existing `secYield?: number | null;` line at `app.tsx:89`:

```ts
      secYield?: number | null;
      frequencyCode?: string;
```

(`IndexFund.distributions` at line 41 is unchanged — you are reading the existing raw field, not adding a new data source.)

### 1.3 Add the header

In `renderFundsTable()`, insert a new `sortHeader` call between the existing `SEC Yield` and `YTD Return` headers (`app.tsx:880-881`):

```ts
          ${sortHeader('SEC Yield', 'secYield', true)}
          ${sortHeader('Frequency', 'frequencyCode')}
          ${sortHeader('YTD Return', 'ytd', true)}
```

`numeric` is left at its default `false` (no third argument) — the cell value is a coded label (`"01 - Monthly"`), not a plain right-aligned number, so it should render left-aligned like `Type`/`Category`, not right-aligned like the percent columns. No changes to `sortValue`/`compareValues` (`app.tsx:793-810`) are needed: `numberOrNull` (`app.tsx:279`) returns `null` for a string like `"01 - Monthly"`, so `compareValues` falls through to its `localeCompare(..., { numeric: true })` branch, and because every code is a zero-padded two-digit prefix, that string sort already produces the correct ascending numeric order.

### 1.4 Add the body cell

Insert a new `<td>` between the existing SEC Yield cell and YTD Return cell (`app.tsx:921-922`):

```ts
              <td class="py-2.5 px-4 text-right font-mono text-slate-700 dark:text-slate-300">—</td>
              <td class="py-2.5 px-4 text-slate-600 dark:text-slate-300 font-mono">${escapeHtml(fund.frequencyCode || '00 - —')}</td>
              <td class="py-2.5 px-4 text-right font-mono text-slate-700 dark:text-slate-300">${formatPercent(fund.ytd)}</td>
```

(The line above it, the hardcoded `—` SEC Yield cell, is a pre-existing, unrelated bug — `secYield` is sortable but never actually rendered. Leave it as-is; it is out of scope for this plan.)

### 1.5 Fix the empty-state colspan

The catalog table now has 25 columns instead of 24. Update the "no rows match" colspan at `app.tsx:901`:

```ts
        el.tableBody.innerHTML = `<tr><td colspan="25" class="py-12 text-center text-slate-400 dark:text-slate-500">No ETFs match your search.</td></tr>`;
```

Do not change any other `colspan` in the file — the ones listed for Watchlist (`colspan="8"`), sheets (`colspan="2"` / `${headers.length + 1}`), and Overview (`colspan="4"`) belong to different tables that are unaffected by this column.

### 1.6 Update the header tooltip

Replace the existing generic `Frequency` tooltip body at `app.tsx:169`:

```ts
      Frequency: 'Distribution frequency — coded for sorting from fund.distributions.frequency (derived in scripts/update-data.ts by inferDistributionFrequency from the Yahoo Finance dividend-history feed). Codes: 01 Monthly, 04 Quarterly, 06 Semi-annually, 12 Annually, 99 Irregular, 00 Unknown/None/—. The Overview tab shows the raw label.',
```

`getHeaderTooltip('Frequency')` (used by `sortHeader`, `app.tsx:319-330`) will pick this up automatically as a native `title` tooltip on the new `<th>`, exactly like every other catalog column.

### 1.7 CSV/TXT export parity

The default (catalog) branch of `currentExportRows()` builds the CSV/TXT headers and rows independently of the on-screen table. Update both, keeping the same order as the visible column (`app.tsx:1494` and `app.tsx:1504-1505`):

```ts
        headers: ['Selected', 'Ticker', 'Fund Name', 'Type', 'NAV', 'Net Assets ($)', 'Expense (%)', 'Dividend Yield (%)', 'SEC Yield (%)', 'Frequency', 'YTD Return (%)', 'TR 1Y (%)', 'TR 3Y (%)', 'TR 5Y (%)', 'TR 10Y (%)', 'CAGR 3Y (%)', 'CAGR 5Y (%)', 'CAGR 10Y (%)', 'SI Ann. (%)', 'Return As Of', 'Inception', 'Holdings', 'History', 'As Of'],
        rows: filterRows(visibleFunds()).map(fund => [
          state.selected.has(fund.ticker) ? 'yes' : 'no',
          fund.ticker,
          fund.name,
          fund.category,
          fund.nav || '',
          numberCell(fund.aumValue),
          numberCell(fund.terValue),
          numberCell(fund.dividendYield),
          numberCell(fund.secYield),
          fund.frequencyCode || '',
          numberCell(fund.ytd),
```

(leave the remaining rows in that array — `yr1` through `asOfDate` — untouched; only the two lines shown above change.) Use `fund.frequencyCode` directly (not `numberCell`, which would blank it out since it's not a pure number) so the exported value matches the on-screen coded label exactly.

### 1.8 What NOT to change

- Do not touch `scripts/update-data.ts` or `inferDistributionFrequency` — the raw cadence computation is correct and out of scope.
- Do not change `app.tsx:1207` (the Overview tab's raw `Frequency` metric row) — it must keep showing the provider's raw label (`Monthly`, `Quarterly`, ...), not the coded value.
- Do not add `frequencyCode` to the Watchlist rows or any detail sheet — this column is catalog-only.

## 2. Horizontally pinned catalog columns

### Current state

There is **no column pinning today, in any form** — a repo-wide search for `sticky`/`pinned` in `app.tsx` and `index.html` finds only the existing **vertical** sticky header: `index.html:190`, `<thead id="table-head" class="... sticky top-0 z-20 backdrop-blur">`. No `<th>`/`<td>` in the catalog table has `position: sticky`, and no CSS class like `catalog-sticky-col` exists yet. This is an add-from-scratch feature, not a fix.

Relevant real names/widths to use:

- Row index column: `indexHeader()` (`app.tsx:828-830`), `<th class="py-3.5 px-4 w-12 text-center" ...>#</th>` — **must stay unpinned**, per the interaction contract (only `Use` and `Ticker` are pinned).
- Use/select column: `useHeader()` (`app.tsx:832-839`), currently `<th class="py-3.5 px-4 w-20 text-center" ...>` — already has an explicit width, Tailwind `w-20` = `5rem`. Body cell at `app.tsx:908-913`, `<td class="py-2.5 px-4 text-center">` wrapping the `data-checkbox` input and `data-blacklist` button in a `<div class="inline-flex items-center justify-center gap-1.5">` — **no new wrapper needed, the sticky class goes on this existing `<td>` itself.**
- Ticker column: built by the generic `sortHeader('Ticker', 'ticker')` (`app.tsx:873`), which currently has **no explicit width**. Body cell at `app.tsx:914`: `<td class="py-2.5 px-4 font-mono font-semibold text-blue-600 dark:text-blue-400">${escapeHtml(fund.ticker)}</td>`. All current Invesco tickers are 2-5 characters (`QQQM`, `SPLV`, `SPHD`, `SPMO`, `SPHQ`, `SPGP`, `RPV`, `RPG`, `RWL`, `DBA`, `IDMO`, `IDHQ`, `IDLV`, `QQQ`, `RSP`, plus the wider live catalog of ~245 Invesco ETFs) — give it `6rem` (`w-24`) of fixed width, one Tailwind step wider than the `Use` column, so five-character tickers in `font-mono font-semibold` never clip.
- `#table-scroll` (`index.html:188`) is the horizontal+vertical scroll container; `<table class="w-full text-left border-collapse whitespace-nowrap">` (`index.html:189`) is the table element — the Tailwind `border-collapse` utility class on it must be **removed** (see 2.1) since sticky positioning needs `border-collapse: separate`.
- `sortHeader()` (`app.tsx:820-826`) is the shared header-cell builder used by every catalog and detail-sheet column alike, including the Watchlist's own `Ticker`-like column. It must gain an optional extra-class parameter (2.3) rather than being special-cased by column name, so no other caller is affected.
- Theme: dark mode is toggled via the `dark` class on `<html>`, persisted in `localStorage` under the key **`invesco-theme`** (`index.html:30`). Don't invent a different key.
- Existing hover/selected row treatments that any pinned-cell background must pre-blend against:
  - Row hover: Tailwind utility classes on the `<tr>` itself, `hover:bg-slate-50 dark:hover:bg-slate-700/30` (`app.tsx:906`).
  - Row selected: `.selected-row{background:#eff6ff}` / `.dark .selected-row{background:rgba(30,64,175,.22)}` (`index.html:51-52`) — the dark rule is exactly the kind of **translucent** tint the generic checklist warns about; it must **not** be reused as-is on a pinned cell.
  - Base (non-hovered, non-selected) row background comes from the surrounding card, not the `<tr>`/`<td>` themselves: the table's containing card is `bg-white dark:bg-slate-800/50` (`index.html:187`) sitting on top of the page body's `bg-slate-50 dark:bg-slate-900` (`index.html:99`). `tbody`/`tr`/`td` set no background of their own today, so a plain `<td>` is visually white in light mode and a blend of `slate-800` at 50% over `slate-900` in dark mode.
  - Header background is set directly on `<thead id="table-head">`: `bg-slate-50 dark:bg-slate-900/95` (`index.html:190`).

### 2.1 Table + scroll container CSS

In `index.html`, inside the existing `<style>` block (after the `#table-scroll{overscroll-behavior:contain}` rule at line 87), add:

```css
#table-scroll table{border-collapse:separate;border-spacing:0;isolation:isolate}
#table-scroll tbody{position:relative;z-index:0}
#table-scroll tbody tr{position:relative;z-index:0}
#table-scroll .catalog-sticky-col{position:sticky;background:#fff;background-clip:padding-box}
#table-scroll thead .catalog-sticky-col{top:0;z-index:30;background:#f8fafc}
#table-scroll tbody .catalog-sticky-col{z-index:20}
#table-scroll .catalog-sticky-use{left:0;width:5rem;min-width:5rem}
#table-scroll .catalog-sticky-ticker{left:5rem;width:6rem;min-width:6rem;box-shadow:4px 0 6px -6px rgba(15,23,42,.7)}
.dark #table-scroll .catalog-sticky-col{background:#172033}
.dark #table-scroll thead .catalog-sticky-col{background:#0f172a}
#table-scroll tbody tr:hover .catalog-sticky-col{background:#f8fafc}
#table-scroll tbody tr.selected-row .catalog-sticky-col{background:#eff6ff}
.dark #table-scroll tbody tr:hover .catalog-sticky-col{background:#1f2a3d}
.dark #table-scroll tbody tr.selected-row .catalog-sticky-col{background:#19274e}
```

Then remove the Tailwind `border-collapse` utility class from the `<table>` element at `index.html:189` (the new CSS rule above now owns `border-collapse`/`border-spacing`, and leaving the utility class in place would fight it depending on cascade order):

```html
<table class="w-full text-left whitespace-nowrap">
```

Notes on where these colors came from (recompute if the Tailwind palette in `index.html`/`tailwind.config` ever changes — don't reuse these hexes blindly if this repo's tokens change):

- `#f8fafc` / `#0f172a` (header pinned background, light/dark) are just this repo's own `bg-slate-50` and `bg-slate-900` — the same Tailwind classes already on `<thead id="table-head">` at `index.html:190`, restated as flat hex because a sticky cell needs a plain CSS `background`, not a Tailwind class racing against `background-clip`.
- `#172033` (dark body-cell base background) is `slate-800` (`#1e293b`) at 50% alpha over `slate-900` (`#0f172a`) — the actual current stacking of the card (`dark:bg-slate-800/50`, `index.html:187`) over the page body (`dark:bg-slate-900`, `index.html:99`), pre-blended to a solid color.
- `#1f2a3d` (dark hover) is `slate-700` (`#334155`) at 30% alpha — this repo's `dark:hover:bg-slate-700/30` (`app.tsx:906`) — over that same `#172033` base.
- `#19274e` (dark selected) is `rgba(30,64,175,.22)` — this repo's existing `.dark .selected-row` rule (`index.html:52`) — over that same `#172033` base.
- The light-mode hover/selected values (`#f8fafc`, `#eff6ff`) need no blending: this repo's light-mode hover (`hover:bg-slate-50`) and `.selected-row` (`background:#eff6ff`) are already fully opaque, so the pinned cell can reuse the same flat hex directly.

### 2.2 Mark the Use column sticky

`useHeader()` (`app.tsx:832-839`) — add the two classes to the existing `<th>`:

```ts
    function useHeader(): string {
      const candidates = visibleFunds();
      const allSelected = candidates.length > 0 && state.selected.size === candidates.length;
      return `<th class="catalog-sticky-col catalog-sticky-use py-3.5 px-4 w-20 text-center" title="${escapeHtml(getHeaderTooltip('Use'))}">
```

Row template (`app.tsx:908`) — add the classes to the existing `<td>`, keep everything inside it (the checkbox + blacklist button `<div>`) exactly as-is, no new wrapper:

```ts
              <td class="catalog-sticky-col catalog-sticky-use py-2.5 px-4 text-center">
```

### 2.3 Mark the Ticker column sticky

`sortHeader()` is shared by every column, so give it one optional 4th parameter instead of special-casing `Ticker` by name (`app.tsx:820-826`):

```ts
    function sortHeader(label: string, key: string, numeric = false, extraClass = ''): string {
      const active = state.sortKey === key;
      const arrow = active ? (state.sortDir === 'asc' ? ' ↑' : ' ↓') : '';
      const align = numeric ? ' text-right' : '';
      const tooltip = getHeaderTooltip(label);
      const classAttr = `py-3.5 px-4${align}${extraClass ? ` ${extraClass}` : ''}`;
      return `<th class="${classAttr}" title="${escapeHtml(tooltip)}"><button data-sort="${escapeHtml(key)}" title="${escapeHtml(tooltip)}" class="uppercase tracking-wider hover:text-blue-600 dark:hover:text-blue-400 focus:outline-none focus:text-blue-600 dark:focus:text-blue-400">${escapeHtml(label)}${arrow}</button></th>`;
    }
```

This is backward compatible — every existing call site (`sortHeader('Fund Name', 'name')`, `sortHeader('NAV', 'navValue', true)`, etc., in `renderFundsTable`, the Watchlist table, and every detail sheet) keeps working unchanged since `extraClass` defaults to `''`.

Update only the `Ticker` call site in `renderFundsTable()` (`app.tsx:873`):

```ts
          ${sortHeader('Ticker', 'ticker', false, 'catalog-sticky-col catalog-sticky-ticker w-24')}
```

Do **not** change the Watchlist table's own ticker-like column (`symbol`, rendered around `app.tsx:1063`) or any detail-sheet column — they must keep using plain `sortHeader(label, key)` with no extra class, since `#table-scroll` is reused for those unrelated, differently-shaped tables and they have no pinned columns of their own.

Row template (`app.tsx:914`) — add the sticky classes to the existing `<td>`:

```ts
              <td class="catalog-sticky-col catalog-sticky-ticker py-2.5 px-4 font-mono font-semibold text-blue-600 dark:text-blue-400">${escapeHtml(fund.ticker)}</td>
```

### 2.4 What NOT to change

- `indexHeader()` / the `#` column (`app.tsx:828-830`, body cell `app.tsx:907`) stays exactly as it is today — not sticky, no new classes. It renders before `Use` in row order but is not pinned.
- No other column in the catalog table, and no column in the Watchlist table or any detail sheet, gets a `catalog-sticky-*` class.
- Do not use `:nth-child()` or any other positional selector scoped to `#table-scroll` — `#table-scroll` is shared by the Watchlist view and every per-fund sheet view (holdings/history/overview/distributions), which have completely different column counts and no pinned columns; a positional selector would silently reach into them.
- Preserve everything already working: the sticky top header (`index.html:190`), lazy static-load pagination (`el.staticLoadSentinel`), search/filter (`filterRows`), sort (`sortRows`/`bindSortHeaders`), row selection (`toggleFund`/checkboxes), blacklist button, and dark theme toggle. None of those need code changes for this feature — the CSS/markup changes above are additive.

### 2.5 Verification (mandatory — do not sign off from reading the CSS alone)

1. Run the app (`bunx serve .` or any static server) and open the catalog (`All ETFs`) tab in a real or headless browser.
2. Confirm at `scrollLeft = 0` that `#`, `Use`, `Ticker` render left to right, only `Use`/`Ticker` look pinned, and their backgrounds are opaque and indistinguishable in padding/typography from an ordinary column.
3. **Scroll the table all the way to the right** (e.g. drag the horizontal scrollbar to its end, or `el.tableScroll.scrollLeft = el.tableScroll.scrollWidth` in the console) and confirm `Use` and `Ticker` are still visible, still opaque, and every other column has scrolled underneath them without visual bleed-through.
4. With a row hovered, and separately with a row selected (click a row to toggle its checkbox), repeat step 3 in both light and dark mode (toggle `#theme-toggle`, backed by `localStorage['invesco-theme']`) — confirm the pinned cells show solid backgrounds matching `#f8fafc`/`#eff6ff`/`#1f2a3d`/`#19274e` as appropriate, with no scrolled-through text visible.
5. Confirm the checkbox and the blacklist `✕` button inside the pinned `Use` cell are still clickable after scrolling right.
6. Scroll vertically (past the static-load sentinel, if enough rows are loaded) while also scrolled right, and confirm the sticky header row still renders above the pinned body cells (header z-index 30 vs. body z-index 20).
7. Confirm the `Ticker` cell's right-edge shadow is visible against the scrolling columns behind it.

## Acceptance checklist

- [ ] `formatDistributionFrequency` added to `app.tsx`; normalizes `Monthly`/`Quarterly`/`Semiannually`/`Annually`/`None`/`Unknown`/`Irregular`/`—` (and hyphenated variants) to `01 - Monthly` / `04 - Quarterly` / `06 - Semi-annually` / `12 - Annually` / `00 - None` / `00 - Unknown` / `99 - Irregular` / `00 - —`.
- [ ] `FundRow.frequencyCode` computed once in `normalizeFundRow` from `fund.distributions.frequency`; no new data source, no client-side recomputation of cadence.
- [ ] Catalog header order is `... Dividend Yield, SEC Yield, Frequency, YTD Return, TR 1Y, ...` (new `Frequency` header between the two existing ones).
- [ ] Catalog body row has a matching `Frequency` `<td>` in the same position.
- [ ] Empty-state `colspan` at `app.tsx:901` updated from `24` to `25`.
- [ ] `COLUMN_TOOLTIPS.Frequency` (`app.tsx:169`) rewritten to name the source (`fund.distributions.frequency` / `inferDistributionFrequency` / Yahoo dividend-history feed) and explain the numeric codes.
- [ ] CSV/TXT catalog export (`currentExportRows`, default branch) has a `Frequency` header and value in the same position as the visible column, using the coded value.
- [ ] The Overview detail tab's raw `Frequency` metric row (`app.tsx:1207`) is unchanged and still shows the provider's raw label.
- [ ] `#table-scroll` remains the only horizontal scroll surface; the page itself does not scroll horizontally.
- [ ] Only `Use` and `Ticker` are pinned; `#` is not pinned and still renders before `Use`.
- [ ] `.catalog-sticky-col`/`.catalog-sticky-use`/`.catalog-sticky-ticker` are applied directly to the `<th>`/`<td>` elements, with no nested wrapper carrying the sticky positioning.
- [ ] `Use` is pinned at `left:0` (width `5rem`); `Ticker` is pinned at `left:5rem` (width `6rem`); both have explicit `width`/`min-width`.
- [ ] Sticky header cells use `z-index:30`; sticky body cells use `z-index:20`; `#table-scroll table` uses `border-collapse:separate;border-spacing:0;isolation:isolate`; `tbody` and each `tr` have `position:relative;z-index:0`.
- [ ] Pinned cells have solid, pre-blended backgrounds (not raw `rgba(...)` tints) for default/hover/selected states in both light and dark theme, verified by scrolling all the way right in a real browser — not just by reading the CSS.
- [ ] The `Ticker` cell has a visible right-edge shadow.
- [ ] Pinned cells use the same padding/typography classes as ordinary cells — no extra wrapper, no compensating margins.
- [ ] `sortHeader`'s new `extraClass` parameter is only passed for the `Ticker` column in `renderFundsTable`; the Watchlist table and every detail-sheet column call `sortHeader` with no 4th argument.
- [ ] Checkbox and blacklist button inside the pinned `Use` cell remain clickable after horizontal scroll.
- [ ] Existing search, sort, row selection, lazy static-load pagination, and dark theme continue to work unchanged.

## Handoff summary

Invesco's catalog table (`renderFundsTable()` in `app.tsx`) has no distribution-frequency column and no pinned columns today — both features are additions, not fixes. The raw cadence already exists as `fund.distributions.frequency`, produced by `inferDistributionFrequency` in `scripts/update-data.ts` from the Yahoo dividend-history feed; section 1 above adds a `formatDistributionFrequency` normalizer, a `frequencyCode` field, and a new `Frequency` column between `SEC Yield` and `YTD Return`, with export and tooltip parity. Section 2 adds `position: sticky` directly on the existing `Use` and `Ticker` `<th>`/`<td>` cells (never a nested wrapper), scoped through a new `.catalog-sticky-col` class family so the Watchlist and detail-sheet tables sharing `#table-scroll` are unaffected, with pre-blended solid backgrounds computed from this repo's actual Tailwind tokens (`slate-800/50` over `slate-900` in dark mode, `slate-700/30` hover, the existing `rgba(30,64,175,.22)` selected tint) rather than reused translucent values. Both sections cite exact current line numbers in `app.tsx`/`index.html` so the changes can be applied as direct, minimal diffs.
