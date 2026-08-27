# Invesco

Invesco ETF holdings to Watchlist. A single-file client-side tool that reads the generated `./api/invesco` static feed (invesco.com product-list / performance CSVs, per-fund daily holdings CSVs, Yahoo Finance daily history and distributions, SEC EDGAR N-PORT-P only as a fallback) into a searchable ETF / asset-class catalog with per-fund tabs, watchlist aggregation, ticker copy and CSV/TXT export — the same look, feel, columns and business logic as the sibling applications.

## Shared UI contract

The common interaction and data-state rules are documented in [`docs/ui-contract.md`](./docs/ui-contract.md). New provider-specific behavior should preserve this contract. The provider-specific data plan is documented in [`docs/invesco-static-data-plan.ru.md`](./docs/invesco-static-data-plan.ru.md).

## Sibling applications

| Application | Data provider | Repository |
| --- | --- | --- |
| Amplify ETF Holdings to Watchlist | Amplify ETFs (Firestore data feed) | [daggerok/Amplify](https://github.com/daggerok/Amplify) · [published app](https://daggerok.github.io/Amplify/) |
| iShares Excel .xls to Watchlist | iShares (BlackRock) product workbooks | [daggerok/iShares](https://github.com/daggerok/iShares) · [published app](https://daggerok.github.io/iShares/) |
| SPDR ETF Holdings to Watchlist | SSGA / State Street public feeds | [daggerok/SPDR](https://github.com/daggerok/SPDR) · [published app](https://daggerok.github.io/SPDR/) |
| Fidelity ETF Holdings to Watchlist | SEC EDGAR N-PORT-P + Yahoo Finance | [daggerok/Fidelity](https://github.com/daggerok/Fidelity) · [published app](https://daggerok.github.io/Fidelity/) |
| Invesco ETF Holdings to Watchlist | invesco.com CSV downloads + Yahoo Finance | [daggerok/Invesco](https://github.com/daggerok/Invesco) · [published app](https://daggerok.github.io/Invesco/) |

## Using Bun

```bash
bunx degit daggerok/Invesco#main ./12345 && cd $_
bunx serve . -p 1234
open http://0:1234
```

The published application is available at <https://daggerok.github.io/Invesco/>.

## Updating the static Invesco data

Run the updater with Bun:

```bash
bun test scripts/update-data.test.ts
./scripts/update-data.ts
```

Run `./scripts/update-data.ts -h` (or `--help`) to print every configuration variable with its default and usage examples.

The **Update Invesco ETF data** GitHub Actions workflow exposes the same settings as manual inputs. All supplied filters use **AND** logic.

### Data sources

| Block | Source |
| --- | --- |
| Catalog (all US Invesco ETFs), official returns, TER, NAV, close, premium/discount, `Fund Assets`, trailing-12M dividend yield, 30-day SEC yield | `https://www.invesco.com/us/financial-products/etfs/performance/prices/main/performance/0?audienceType=Advisor&action=download` (the "Excel Product List Download" behind the ETF page; the `asOfDate` / `showNav` / `monthly` flavors are reachable via `PRODUCT_LIST_URL`) |
| Latest holdings per fund | `https://www.invesco.com/us/financial-products/etfs/holdings/main/holdings/0?audienceType=Investor&action=download&ticker={TICKER}` |
| Daily history (close / adjusted close), distributions, listing date, exchange | Yahoo Finance public chart API (`/v8/finance/chart/{TICKER}?period1=0&period2=…&interval=1d&events=div\|split`) |
| Holdings fallback (funds with no invesco.com holdings CSV) | SEC EDGAR Form **N-PORT-P** of the fund itself: the official `https://www.sec.gov/files/company_tickers_mf.json` table maps the ticker to its registrant CIK + series id, `browse-edgar` (`output=atom`, `type=NPORT-P`) returns that series' newest filing and `primary_doc.xml` carries the positions and reported net assets; `efts.sec.gov` full-text search stays as the last resort (no hand-kept CIK table) |
| Exchange tickers for N-PORT positions | `https://www.sec.gov/files/company_tickers.json` (issuer name → symbol), so filed positions still land in the Watchlist with a real ticker |
| Catalog fallback (invesco.com unreachable) | The previously published `api/invesco/index.json` plus every share class the Invesco ETF registrants list in the SEC fund-ticker table, so a full pass still covers the whole product line |
| Optional daily NAV/close history | `https://www.invesco.com/us/financial-products/etfs/pricing/main/prices/0?audienceType=Investor&action=download&ticker={TICKER}` (`PRICES_HISTORY=1`) |

Each fund carries a derived `metrics` object that powers the catalog columns shared with the sibling sites:

- `ytd` / `tr1y` — the **official Invesco** YTD and 12-month returns from the product list → *YTD Return*, *TR 1Y*
- `cagr3y` / `cagr5y` / `cagr10y` — Invesco's published annualized 3Y/5Y/10Y figures → *CAGR 3Y/5Y/10Y*
- `tr3y` / `tr5y` / `tr10y` — cumulative total returns derived exactly from those annualized figures: `(1 + CAGR nY)^n − 1` → *TR 3Y/5Y/10Y*
- `siAnn` — since-inception annualized (Invesco) → *SI Ann.*
- `dividendYield` — the trailing-12-month yield published by Invesco; when absent, the **indicated** yield (latest distribution × payments per year ÷ market price) from the Yahoo dividend history
- `secYield` — the 30-day SEC yield **when Invesco publishes it** (mostly fixed income funds); `—` otherwise
- `monthEnd` / `quarterEnd` return blocks in `returns` keep the same shape as SPDR/Fidelity (`mo1`, `qtd`, YTD/1Y/3Y/5Y/10Y/SI plus `*Text` renderings)

Known value limitations (documented honestly, like the sibling feeds):

- **Holdings are the latest published snapshot only** — invesco.com ships no historical holdings archive, so the feed has one sheet per fund, exactly like the SPDR feed.
- **Multi-year returns are annualized at the source.** Invesco publishes `3 Yr Ann` / `5 Yr Ann` / `10 Yr Ann` as annualized figures; the cumulative TR columns are computed from them rather than read directly.
- **SEC Yield (30-day)** is missing for most equity funds; those rows render `—` (the UI contract's "not published" state).
- **Dividend Yield** is either Invesco's trailing-12M figure or *indicated* — `meta.json` records which (`yields.dividendYieldKind`), and the Overview tab shows it.
- **Returns fall back to adjusted market-price closes** (Yahoo) only for funds the product list omits; `returnsBasis` in `metrics` and `returns.derivedFrom` say so explicitly.
- **Holdings taken from N-PORT-P** carry no ticker in the filing itself; the SEC company-ticker table restores the symbol for listed issuers, and bonds, loans, cash and derivatives legitimately keep `Ticker: "-"`.
- **Bond, cash and futures positions carry no exchange ticker** in the Invesco CSV (`Ticker: "-"`). They are identified by CUSIP/ISIN (`Identifier`); the Watchlist deduplicates by `Ticker` when present and falls back to `Identifier` — the exact same convention as the SPDR and iShares feeds.
- **Fund-level CSV column drift is expected**: the Investor and Advisor flavors rename columns and reorder them, so the parser locates the header row by content and matches headers case/punctuation-insensitively; `AUDIENCE_TYPE` switches the flavor.

### Update controls

| Environment variable | Default | Meaning |
| --- | --: | --- |
| `MAX_FETCHES` | all | Batch size: with a positive value the updater continues after the committed cursor in `api/invesco/update-state.json`; empty or `0` (the default) is a **full pass** — every fund in the catalog is refreshed in one run, starting from the first ticker, and the cursor is reset when it completes. The legacy `INVESCO_LIMIT` name remains supported. |
| `REQUEST_SLEEP` | `1` | Minimum delay in seconds between outgoing request starts, including retries. invesco.com and Yahoo throttle bursty clients; keep ≥ 1. |
| `CONCURRENCY` | `2` | Number of parallel fund update workers. Request starts are still globally spaced by `REQUEST_SLEEP`. |
| `AUM` | `:` | Net Assets range. Each bound may be a USD amount or `K`/`M`/`B`/`T`, or one of `nano`, `micro`, `small`, `mid`, `large`. |
| `TER` | `:` | Gross expense ratio range in % (strict `min:max`). |
| `DIVIDEND_YIELD` | `:` | Dividend-yield percentage range (published trailing-12M, or indicated when derived). |
| `PERFORMANCE_YTD` … `PERFORMANCE_10Y` | `:` | Annualized return ranges (YTD, 1Y, 3Y, 5Y, 10Y). |
| `TOTAL_RETURN_YTD` … `TOTAL_RETURN_10Y` | `:` | Cumulative return ranges. |
| `TICKERS` | all | Space-, comma- or semicolon-separated ticker allowlist, for example `QQQ QQQM RSP PGX`. |
| `HOLDINGS_PAGE_SIZE` | `250` | Rows in each generated current-holdings JSON page. |
| `HISTORY_PAGE_SIZE` | `1000` | Rows in each generated daily-history JSON page. `HISTORICAL_PAGE_SIZE` remains supported as an alias. |
| `HISTORY_RANGE` | `max` | Yahoo chart range for history rows (`max`, `10y`, `5y`, …). |
| `STORE_RAW_DOWNLOADS` | off | Store the source product-list CSV / per-fund CSVs / N-PORT XML under `api/invesco/raw`. |
| `MAX_RETRIES` | `2` | Retries after the initial request. Only network errors and HTTP 403/408/425/429/5xx are retried, with bounded exponential backoff. |
| `AUDIENCE_TYPE` | `Investor` | invesco.com `audienceType` query parameter (`Investor` or `Advisor`). |
| `PRODUCT_LIST_URL` | product-list download | Override the catalog CSV URL, e.g. to pin `asOfDate=MM/DD/YYYY&showNav=true&monthly=true`. |
| `CATALOG_HTML_URL` | ETF page | invesco.com page scraped for canonical per-fund URLs (`?ticker=` links are the fallback). |
| `PRICES_HISTORY` | off | Use the per-fund "prices & yields" CSV for daily history instead of relying on Yahoo alone. |
| `EDGAR_FALLBACK` | on | Set `0` to skip the SEC EDGAR N-PORT-P fallback for funds with no Invesco holdings CSV. |
| `SEC_UA` | declared UA | Override the SEC User-Agent. SEC policy requires automated tools to declare a contact. |
| `SKIP_YAHOO` | off | Update invesco.com data only, keeping previously published history/distributions (also disables live ticker resolution). |
| `SKIP_INVESCO` | off | Update history only (Yahoo), keeping the published catalog values and holdings — useful when invesco.com is down and only prices moved. |

`TICKERS` combines with AUM, TER, dividend-yield and return filters using AND logic; it does not override them. Funds not selected for a successful update keep their prior published metadata and data files.

### Full passes and resuming bounded runs

Running the updater with no arguments and no environment variables (`./scripts/update-data.ts`, exactly what the GitHub Actions workflow does) refreshes **every** Invesco ETF in the catalog in one pass: the saved cursor is ignored, funds are processed in alphabetical ticker order, and `api/invesco/update-state.json` is reset (`cursor: null`) when the pass finishes.

A positive `MAX_FETCHES` is a batch size, not a permanent first-page limit. Bounded runs continue after the committed cursor and wrap around at the end, so repeated batches still walk the whole catalog.

### Strict range syntax

All range variables use `min:max` — both bounds are inclusive and optional, but the **colon is required**: `15:`, `:0.5`, `0.1:0.5`, `:`. A missing colon is an error (this strictness matches the sibling repos). Percent and dollar signs are optional.

### AUM ranges and presets

Bounds accept plain USD amounts or `K`/`M`/`B`/`T` suffixes (`10M:2B`). A whole value may be one of the size presets: `nano` (< $10M), `micro` ($10M–$300M), `small` ($300M–$2B), `mid` ($2B–$10B), `large` (> $10B).

### Return ranges

`PERFORMANCE_*` filters match annualized figures (CAGR for multi-year periods), `TOTAL_RETURN_*` filters match cumulative ones — the same pairing the sibling apps expose. Values come from the official Invesco product list where published, otherwise from adjusted market-price closes.

### Examples

```bash
MAX_FETCHES=10 ./scripts/update-data.ts
TICKERS="QQQ QQQM RSP" ./scripts/update-data.ts
AUM="1B:" TER=":0.5" ./scripts/update-data.ts
PERFORMANCE_1Y="15:" ./scripts/update-data.ts
STORE_RAW_DOWNLOADS=1 ./scripts/update-data.ts
SKIP_YAHOO=1 ./scripts/update-data.ts
```

## Uploading N-PORT files in the browser

The header toolbar includes the same integrated drag-and-drop upload as `daggerok/iShares` and `daggerok/Fidelity`, N-PORT flavored: drop or pick a **Form N-PORT-P `primary_doc.xml`** (an Invesco collective trust filing from EDGAR) and the app parses it entirely in your browser — no network — merging the fund (and overriding its holdings when the ticker is already in the feed) into the catalog, detail tabs and Watchlist. Uploads live for the current browser session only.

## Developer notes

- `scripts/update-data.ts` — Bun updater, zero runtime dependencies (`node:fs/promises` + `fetch` only): a tolerant CSV reader for the three invesco.com download flavors, a forgiving N-PORT-P XML reader (same hand-rolled spirit as SPDR's workbook reader and Fidelity's EDGAR layer), Yahoo chart reader, derived-metric helpers (`annualizedToTotal`, `totalToAnnualized`, `indicatedYield`, `priceReturns`, `inferDistributionFrequency`, `deriveCatalogMetrics`), strict range parsers, bounded-run cursor, retries with 403/429 back-off, deterministic content-only writes.
- `scripts/update-data.test.ts` — `bun test` suite: range parsers, CSV layer (quotes, BOM, header discovery, duplicate headers), product-list parsing ($m conversion, percent/`--` handling, dedup, sort), all three holdings flavors, N-PORT fixtures, chart fixtures (null closes, adjusted closes, dividend ordering), `parsePricesCsv`, price-return derivation incl. young-fund nulls, quarter anchoring, catalog metric derivation, holding-name normalization (share classes stay distinct), and URL builders.
- `api/invesco/**` — the generated static feed: `index.json`, `funds/{TICKER}/meta.json`, paginated `holdings/` + `history/` pages, `update-state.json`.
- Verification before every publish: `bunx tsc --noEmit` (updater + tests), `bun test`, and a transpile check of the inline `index.html` script.
- Updater controls belong to `workflow_dispatch` and are visible on the GitHub Actions **Run workflow** form. They are not controls in the published web application. The workflow is manual: merging updater changes does not run a data update automatically, and a successful run commits only `api/invesco/**`.

## TypeScript

The browser app is intentionally single-file: `index.html` contains inline TypeScript compiled in the browser with Babel standalone, following the `daggerok/youtube` no-src-files approach (same as daggerok/Amplify, daggerok/SPDR and daggerok/Fidelity).

## Brands table

| Бренд                        | Фонды | Где брать данные |
|------------------------------|---|---|
| **Invesco** (14) ✅ | QQQM, RSP, SPLV, SPHD, SPMO, SPHQ, SPGP, RPV, RPG, RWL, DBA, IDMO, IDHQ, IDLV (+ QQQ и весь каталог ~245 ETF) | [invesco.com `?ticker=`](https://www.invesco.com/us/financial-products/etfs/product-detail?audienceType=Investor&ticker=IDHQ) · каталог: [www.invesco.com/us/en/financial-products/etfs.html](https://www.invesco.com/us/en/financial-products/etfs.html) — весь каталог Invesco ETF уже интегрирован в наше приложение [daggerok/Invesco](https://github.com/daggerok/Invesco) |
| **SPDR / State Street** ✅ | SPYM, SPYG, SPYD, SDY, XLK, XLF… | [daggerok/SPDR](https://github.com/daggerok/SPDR) — весь каталог SSGA (179 фондов) |
| **iShares / BlackRock** ✅ | IVV, SGOV, DGRO, SOXX… | [daggerok/iShares](https://github.com/daggerok/iShares) — весь каталог, XLS-экспорт |
| **Amplify** ✅ | DIVO, IDVO, SILJ… | [daggerok/Amplify](https://github.com/daggerok/Amplify) — Firestore-фид данных |
| **Fidelity** ✅ | FTEC, FDVV, FDIS, FCOM + каталог Fidelity ETF | [daggerok/Fidelity](https://github.com/daggerok/Fidelity) — holdings из SEC EDGAR N-PORT |

## Brands list

#	Бренд	Фонды из списка (кол-во)	Официальный сайт / страницы фондов
1	Invesco — 14 ✅	QQQM, RSP, SPLV, SPHD, SPMO, SPHQ, SPGP, RPV, RPG, RWL, DBA, IDMO, IDHQ, IDLV	https://www.invesco.com/us/financial-products/etfs/product-detail?audienceType=Investor&ticker={TICKER} (паттерн ?ticker={TICKER}) · каталог: https://www.invesco.com/us/en/financial-products/etfs.html — весь каталог Invesco ETF (~245 фондов) уже интегрирован в наше приложение https://github.com/daggerok/Invesco
