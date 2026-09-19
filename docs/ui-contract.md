# ETF Watchlist UI contract

The provider applications share this interaction contract so users do not need to learn a different workflow for each data source.

## Catalog

- Search placeholder: `Search ETFs, fund names, holdings, tickers, CUSIPs, ISINs...`
- Opening the application starts with no funds selected. The user explicitly chooses funds for comparison.
- `All ETFs` and category tabs filter the catalog; they do not change the saved selection.
- Catalog columns use the common order documented in the README and preserve unavailable provider metrics as `—`.

## Per-tab sort persistence

- Every tab remembers its own last explicitly selected sort column and direction.
- Remembered sorts are persisted per provider in browser localStorage (`invesco-tab-sorts` here; `spdr-tab-sorts`, `amplify-tab-sorts`, … in the sibling apps) and restored whenever the tab is reopened, including after a full reload.
- A tab that was never explicitly sorted keeps its existing default sort. No existing default sort is changed by this contract.
- **No button or checkbox may reset a sort**: row Use checkboxes, the header Use select-all, the All ETFs pill checkbox, tab buttons, search, Copy Tickers, CSV/TXT export, the theme toggle, blacklist actions — all preserve the remembered sort.
- **Clear** removes the selection and the searches only; it never deletes remembered sorts.
- Malformed localStorage sort entries are sanitized: only a non-empty sort key with direction `asc` or `desc` is accepted; anything else is ignored and can never break boot.

## Selection scopes

There are three separate selection operations:

1. **Row Use checkbox** — toggles exactly one ETF.
2. **Header Use checkbox** — operates only on the rows currently rendered by the catalog table: current catalog/category tab + active search filter + blacklist exclusion. Checking selects exactly the visible rows; unchecking deselects exactly those rows; selections hidden by another filter survive. Its checked state is true iff every visible row is selected (computed with `.every(...)`, not by comparing set sizes).
3. **All ETFs pill checkbox** — always operates on every non-blacklisted ETF in the entire catalog, regardless of the active category/detail/Watchlist tab or search filter. Checking selects the whole catalog; unchecking clears the whole selection. Clicking it toggles selection only and must not navigate to All ETFs.

The whole-catalog candidates come directly from all catalog funds minus the blacklist — never from a helper that becomes category-scoped on a category tab.

## Selection reactivity

After every selection writer — row toggle, filtered header select-all, All ETFs pill, blacklist removal from selection, Clear, localStorage restore — the UI immediately updates:

- the selected ETF count;
- the clickable selected ticker badges in the subtitle;
- the active fund ticker;
- the selected detail-tabs panel visibility and counts;
- the Watchlist tab visibility, loading state and count;
- the persisted `*-selected-etfs` and active-fund localStorage values.

Clicking a catalog ticker, a selected-ticker badge or an ETF badge in the Watchlist activates that fund and opens its detail view. After reload the selection and active fund restore (with a selected fallback), background holdings loading starts, and the Watchlist rebuilds without requiring another checkbox.

## Watchlist aggregation and identifier fallbacks

- Selecting an ETF with published holdings starts loading immediately; the equivalent of `ensureHoldingsForSelection()` runs after restore, after every selection change, after either select-all control, after blacklist changes that alter selection, and when the Watchlist is opened.
- The Watchlist count is the number of deduplicated holding rows, not the number of selected ETFs.
- While loading, the tab shows `Watchlist (Loading…)` / `Watchlist (N+)` (never a misleading exact `Watchlist (0)`); once loading finishes the count is exact.
- Deselecting ETFs immediately recomputes the count, Weight Sum, Max Weight, ETF badges, # ETFs and provider-supported Market Value / classification / identifier columns.
- Positions deduplicate with this fallback order (adapted per provider): Ticker/Symbol → CUSIP → ISIN → Identifier/Security ID → SEDOL/FIGI → published security name as the last resort for legitimate cash, futures, swaps, loans or derivatives with no identifier. Blank values, `-`, em dashes and `N/A` count as missing; a literal `-` Ticker never blocks the fallback.
- Bond positions without exchange tickers, cash, futures/swaps/derivatives and rows with zero weight but otherwise valid data are not discarded. The Invesco feed publishes one normalized `Identifier` column (CUSIP/ISIN/SEDOL) plus `Ticker`, so the ladder collapses to Ticker → Identifier → Name.

## Cache and paging behavior

- In-flight `meta.json` requests are deduplicated per ticker; only one holdings-page writer owns a ticker's cache entry at a time, so two rapid selection updates can never fetch the same page twice or skip one.
- Detail-view loading and Watchlist background loading share the same request/cache.
- Obsolete queued work stops (or is safely ignored) after an ETF is deselected; rapid deselect/reselect never leaves a fund partially loaded.
- Watchlist aggregation is invalidated whenever the selection or loaded rows change; tab counts refresh (coalesced) even while the user stays on the catalog tab.
- All-catalog selection loads with bounded concurrency; large Watchlists render in bounded chunks (500 rows here) while Copy/Export use the complete filtered result.

## Data states

The UI distinguishes loading, unavailable, and not-applicable values. A provider limitation must be explained in a tooltip or the fund's data-provenance panel; an em dash must not imply that a request is still loading.

- While holdings load, the Watchlist shows a loading state with progress ("Loading holdings… N of M selected ETF files ready").
- A Watchlist search with no matches shows a search-specific empty state.
- Only when loading completed and no selected fund has usable holdings does the app show "Holdings data is not available yet. Run the data refresh workflow…".
- Missing files and fetch failures produce provider-specific explanatory states (never "no search matches"); switching funds or sheets never leaves the previous fund's table visible while the next one loads.
- Page rows are mapped by the literal headers published in `headers`; both object rows and array rows are handled, and every page loads in source order without duplication or gaps.

Each fund detail view should identify:

- source provider and URL;
- holdings and history as-of dates;
- whether returns are NAV total return or adjusted market-price return;
- whether a yield is trailing, indicated, distribution-derived, or SEC yield;
- known freshness or coverage limitations.

## Detail navigation

Provider-specific data may be unavailable, but the target information architecture is:

`Overview` · `Holdings` · `History` · `Performance` · `Allocations` · `Distributions` · `Yields` · `Price`

When a provider does not publish a dataset, retain the navigation entry and explain the limitation rather than silently changing the product layout. This application presents performance inside **Overview** (Invesco month-end / quarter-end series) and intentionally has no separate Performance tab.

## Sticky columns

During horizontal table scrolling:

- the catalog **Use** header/body cells stay pinned, with **Ticker** pinned immediately after them;
- the Watchlist **Ticker** column stays pinned at the left edge;
- sticky positioning is applied directly to each `th`/`td`, never only to a nested span;
- pinned cells use opaque, pre-blended light/dark backgrounds (including hover and selected-row states) and correct z-index so scrolled text does not bleed through;
- only the table area scrolls — the document does not jump vertically.

## Accessibility baseline

Interactive controls should have an accessible name, active tabs should expose `aria-selected`, sortable headers should expose `aria-sort`, and loading/error status changes should be announced to assistive technology. Keyboard focus and reduced-motion preferences must remain visible/respected.
