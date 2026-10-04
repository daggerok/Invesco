# Invesco

One of the app's features lets you select Invesco ETFs in the Watchlist and aggregate their holdings to see how often each ticker appears across the selected funds. Repeated holdings make overlapping exposure visible: the more selected funds include a ticker, the greater its potential influence on the portfolio; gains in that holding may help, while declines may hurt, and actual impact also depends on each fund's position size.  Another feature makes it faster and easier to find funds with stronger growth over different periods, higher dividend yields or distributions, greater Total Return (price performance plus dividends), and other key performance metrics. A single-file client-side tool that reads the generated `./api/invesco` static feed (invesco.com fund pages and the JSON API behind them for month-end returns, NAV, net assets, yields, expense ratio and daily holdings, Yahoo Finance for daily market history and distributions, SEC EDGAR N-PORT-P only as a holdings fallback) into a searchable ETF/asset-class catalog with per-fund tabs, watchlist aggregation, ticker copy and CSV/TXT export — the same look, feel, columns and business logic as the sibling applications.

## Using Bun

```bash
bunx degit daggerok/Invesco#main ./12345 && cd $_
bunx serve . -p 1234
open http://0:1234
```

The published application is available at <https://daggerok.github.io/Invesco/>.

### Column types and filters

Every column of the ETF catalog and of the Watchlist, Holdings, History and Distributions tabs has a type: text (`ABC`), number (`123`), percentage (`%`), money (`$`), date (`D`), date and time (`DT`) or time of day (`T`). The type is detected from the texts the column shows (80% of the filled cells must agree, otherwise text) and is written in the badge next to the column title: click it to cycle the type, Shift+click to return to auto-detection. Dates are read as `2024-06-15`, `6/15/2024`, `15.06.2024`, `Jun 15, 2024` or `15-Jun-2024`, date and time as `2024-06-15T09:30:00Z` or `2024-06-15 09:30`, time as `09:30`, `16:00:00` or `9:30 PM`

A row of filter inputs sits under the column headers (the `Filters` button hides it, `Clear filters` empties it). Filters of different columns are combined with AND, the search box applies on top, and Copy Tickers and the exports use the filtered rows. Filters and type overrides are remembered in the browser

Inside one filter: a space means AND, a comma means OR, a leading `!` means NOT, `?` matches an empty or unavailable value and `!?` a value that is there; a value that is unavailable matches only `?` and negated conditions. An unquoted space ends the value, so quote values that contain one (`>="2024-06-15 09:30"`)

| Type | Examples |
| --- | --- |
| Text | `bank` contains, `"two words"`, `!bank`, `=exact`, `^starts`, `ends$`, `/regex/`, `tech, health` |
| Number, percentage, money | `>10`, `>=10 <50`, `=22` (matches what rounds to 22), `!=22`, `10..50`, `..50`, `10..`, `>1B` and `K` `M` `B` `T` suffixes, an optional `$` or `%` |
| Date, date and time | `>2024-06-01`, `2024` (the whole year), `2024-06` (the whole month), `2024-01..2024-06`, `today`, `yesterday`, `-7d..` (the last 7 days), `+2w`, `-3m`, `-1y` |
| Time | `>09:30`, `09:30..16:00`, `=12:00` (the whole minute) |

The `Columns` menu next to `Filters` lists every column of the ETF table from the first to the last, all of them shown by default, with a search box and the `All`, `Clear`, `Toggle` and `Reset` buttons. `Use` and `Ticker` are listed but locked. Hiding a column only removes it from the table: the filters, the sorting, the exports and Copy Tickers still use it. The choice is remembered in the browser (localStorage, never the data) and the menu is shown on the ETF catalog only

## Updating the static Invesco data

Run the updater with Bun:

```bash
bun scripts/update-data.ts
```

Run `bun scripts/update-data.ts --help` to print every control with its default and usage examples.

Defaults for every supported control live in `scripts/update-data.config.json`. The CLI and the **Update Invesco ETF data** GitHub Actions workflow share one resolver (`resolveControls` in `scripts/update-data.ts`), applied in this order: file defaults < `advanced` JSON < nonblank workflow inputs < protected Actions variable or environment variable. A blank workflow input inherits the file value, scheduled runs use the file defaults as-is, and `advanced` can set any control, including an empty string on purpose. All supplied filters use **AND** logic.

### Data sources

The old invesco.com CSV downloads (product list, per-fund holdings, prices & yields) are gone: they redirect to the catalog page, and invesco.com answers HTTP 406 to every browser-like `User-Agent`. The updater now reads what the fund pages themselves use, without a key, with its own non-browser `User-Agent` (`daggerok-etf-feed/1.0`).

| Block | Source |
| --- | --- |
| Fund list | `https://www.invesco.com/us/en/sitemap.xml` (canonical page of every live US ETF) plus every fund already published (`index.json` and `funds/*/meta.json`), so the feed never shrinks |
| Fund facts, expense ratio | each fund page (`/us/en/financial-products/etfs/<slug>.html`): ticker, CUSIP, ISIN, index, total and net expense ratio are embedded as page JSON |
| Month-end returns (official) | `dng-api.invesco.com/cache/v1/accounts/en_US/shareclasses/{CUSIP}/performance/standard?...performanceSubType=annualized&performancePeriod=monthly` (fund NAV row, with its effective date) |
| NAV, close, net assets (AUM), yields | `.../{CUSIP}/prices` and `.../{CUSIP}?...variationType=yieldInformation` (daily, official) |
| Holdings per fund | `.../{CUSIP}/holdings/fund` (all positions, daily, official) |
| Daily market history, distributions, exchange, quote | Yahoo Finance chart API (adjusted close); invesco.com publishes NAV, not market closes |
| Fallback | SEC EDGAR N-PORT-P holdings for funds invesco.com lists no page for (renamed, matured, delisted) or whose holdings request fails and that have no fresh official holdings yet |

The quarterly table on the catalog page (`Performance (%) as of 06/30/2026`, 50 rows per page, filled by script) is not used: the fund API serves the newer month-end figures for every live fund.

### Metrics and caveats

Each fund carries a derived `metrics` object that powers the catalog columns shared with the sibling sites:

- `ytd` / `tr1y` - official YTD and 1-year NAV returns -> *YTD Return*, *TR 1Y*
- `cagr3y` / `cagr5y` / `cagr10y` - published annualized 3Y/5Y/10Y figures -> *CAGR 3Y/5Y/10Y*
- `tr3y` / `tr5y` / `tr10y` - cumulative 3Y/5Y/10Y figures `(1 + CAGR)^n - 1` -> *TR 3Y/5Y/10Y*
- `siAnn` - since-inception annualized -> *SI Ann.*; a published since-inception of exactly `0.00` is the provider's placeholder and is stored as `null`
- `dividendYield` - official trailing 12-month distribution rate; when Invesco publishes none, an indicated yield (latest distribution x frequency / price) that is an estimate
- `dividendYieldBasis` - short code of the definition behind `dividendYield`, `null` exactly when `dividendYield` is `null`; a retained yield keeps its code (see the table below)
- `secYield` - official 30-day SEC yield when published; unavailable values stay `null` and are never shown as 0
- `returnsBasis` - always a non-empty label of how the returns were computed. Official month-end NAV total returns from the invesco.com fund API (periods Invesco does not publish, for young funds, are filled from adjusted closes: a mixed basis, said so in the label); `last published official ... (not refreshed in this run)` for a fund without a fresh month-end table (renamed, matured or delisted funds keep their last official figures with their old date); estimates derived from adjusted market-price closes (Yahoo, named in the label) for funds without any official returns
- `performanceAsOf` - ISO `YYYY-MM-DD` date the returns are as of, not the NAV date: the effective date of Invesco's month-end performance table for official returns (month-end data appears 1-2 weeks after the month end, so mid-month it is still the previous month end, today `2026-08-31`), the last close used when derived, `null` when unknown

`dividendYieldBasis` for Invesco:

| Code | Meaning here |
| --- | --- |
| `official-trailing-12m` | `twelveMonthDistributionRate` of the invesco.com yields endpoint (trailing 12-month distribution rate), also when retained from the published feed |
| `indicated` | updater estimate: latest Yahoo distribution x inferred payments per year / market price, used when invesco.com publishes no 12-month rate |
| `official-distribution-rate`, `official-other`, `computed-trailing-12m` | standard codes this feed does not emit today (`distributionYield` is kept only as `distributionRate` in `meta.json`) |

Both fields are the last two keys of every `metrics` object and are repeated at the end of the `returns` block in each fund's `meta.json`. The `monthEnd.asOfDate` of that block carries the same official date; `mo1` and `qtd` are always derived from Yahoo closes up to `monthEnd.priceReturnsAsOf` (later than the official month end), so they are not month-end figures. `quarterEnd` has the same keys as `monthEnd` with `null` figures: the fund API serves only the monthly table.

Official and derived values, field by field:

- official, daily: NAV (`navValue`), net assets (`aumValue`, dated by the prices endpoint), yields, holdings (as of the previous business day)
- official, month-end: the return periods above
- official, static: expense ratio - `terValue` is the NET expense ratio (after waivers, `netExpenseRatio` on the fund page; the only number when just one is published), `terGrossValue` the GROSS total expense ratio (`totalExpenseRatio`, which includes acquired fund fees, e.g. KBWD); `meta.json` has both under `expenseRatio` and the TER filter uses the net value
- derived (Yahoo): daily market history, distributions and their frequency, premium/discount against the official NAV, exchange when the page has none
- unavailable: `navValue`, `terValue` and fresh returns for funds the sitemap no longer lists (their last published values stay and are labelled); a fund that is not listed is never zero-filled

Funds filtered out or failing in a run keep their previously published metadata and data files.

Lifecycle: every index row and `meta.json` has `listed`. A fund the loaded invesco.com sitemap no longer lists (matured BulletShares, renamed or delisted funds) stays in the feed with its last values and `listed: false`; without a sitemap the previous status is kept. `exchange` uses one spelling per venue (`NYSE Arca`, `Nasdaq`, `Cboe BZX`).

### Update controls

The table matches `scripts/update-data.config.json` exactly. Every control may also be set as `INVESCO_<NAME>`; legacy aliases `INVESCO_LIMIT` (`MAX_FETCHES`) and `HISTORICAL_PAGE_SIZE` (`HISTORY_PAGE_SIZE`) still work.

| Control | Default | Meaning |
| --- | --: | --- |
| `MAX_FETCHES` | `0` (all) | Batch size in funds that pass the filters (funds a filter rejects cost no slot): with a positive value the updater continues after the committed cursor in `api/invesco/update-state.json`, wraps around at the end and ignores a cursor saved for another filter set; empty or `0` is a full pass. A pass that reaches the 25-minute soft deadline stops taking funds, writes the index and resumes after the last examined fund on the next run |
| `REQUEST_SLEEP` | `1` | Minimum delay in seconds between outgoing request starts, including retries |
| `CONCURRENCY` | `2` | Number of parallel fund update workers; each worker has its own paced request lane |
| `AUM` | `:` | Net Assets range; each bound may be a USD amount or `K`/`M`/`B`/`T`, or one of `nano`, `micro`, `small`, `mid`, `large` |
| `TER` | `:` | Net expense ratio range in % (strict `min:max`, exactly one colon, bounds must be numbers) |
| `DIVIDEND_YIELD` | `:` | Dividend-yield percentage range |
| `PERFORMANCE_YTD` / `_1Y` / `_3Y` / `_5Y` / `_10Y` | `:` | Annualized return ranges in %, one control per period |
| `TOTAL_RETURN_YTD` / `_1Y` / `_3Y` / `_5Y` / `_10Y` | `:` | Cumulative return ranges in %, one control per period |
| `TICKERS` | empty (all) | Space-, comma- or semicolon-separated ticker allowlist, e.g. `QQQ QQQM RSP PGX` |
| `HOLDINGS_PAGE_SIZE` | `250` | Rows in each generated current-holdings JSON page |
| `HISTORY_PAGE_SIZE` | `1000` | Rows in each generated daily-history JSON page |
| `MAX_RETRIES` | `2` | Retries after the initial request (integer >= 1); network errors, timeouts (45 s per request, headers and body) and HTTP 403/408/425/429/5xx are retried with exponential backoff |
| `HISTORY_RANGE` | `max` | `max` or a whole number of years such as `5y`; anything else is an error. Sent as explicit `period1`/`period2` so the Yahoo request really shrinks |
| `SITEMAP_URL` | empty | Override the invesco.com sitemap (https) that lists the fund pages; empty uses the built-in URL |
| `SEC_UA` | `daggerok ETF feed daggerok@gmail.com` | Declared SEC User-Agent (SEC policy requires a contact); redacted in logs; the protected `SEC_UA` Actions variable overrides it |
| `EDGAR_FALLBACK` | `true` | SEC EDGAR Form N-PORT-P fallback for funds without invesco.com holdings |
| `SKIP_YAHOO` | `false` | Skip the Yahoo chart request; the invesco.com data still updates, history and distributions keep their published values |
| `SKIP_INVESCO` | `false` | Update history only (Yahoo), keeping the previously published fund facts, returns and holdings |
| `VERBOSE` | `false` | Print per-fund retry and fallback notices |
| `USE_SYSTEM_CA` | `auto` | TLS trust store: `auto` restarts the updater once with Bun's `--use-system-ca` when a request fails with an untrusted-certificate error; `true` always uses the system CA store; `false` never restarts. Not an individual workflow input: use `advanced`, the config file or the CLI environment. |

`TICKERS` combines with the AUM, TER, yield and return filters using AND logic; it does not override them. A bounded return range excludes funds whose value is `null`. A new fund found in the sitemap is printed as `NEW FUNDS: A, B` and added to the job summary; a run in which no fund received any fresh source exits non-zero.

The workflow exposes 23 individual inputs plus `advanced` (a JSON object of UPPER_CASE control names with scalar values) for everything else, for example `{"HISTORY_PAGE_SIZE": "500", "SITEMAP_URL": "https://www.invesco.com/us/en/sitemap.xml"}`. The output directory is fixed at `api/invesco` and is not a control.

One control is backed by a repository Actions variable, which wins over the file, `advanced` and inputs when nonblank: `SEC_UA` (`vars.SEC_UA`, the real contact for SEC requests, never printed). Set it under **Settings -> Secrets and variables -> Actions -> Variables**. The controls of the retired CSV downloads (`PRODUCT_LIST_URL`, `CATALOG_HTML_URL`, `STORE_RAW_DOWNLOADS`, `PRICES_HISTORY`, `AUDIENCE_TYPE`) were removed, so the resolver rejects them instead of silently ignoring them.

### Examples

```bash
MAX_FETCHES=10 bun scripts/update-data.ts
TICKERS="QQQ QQQM RSP PGX" bun scripts/update-data.ts
AUM="1B:" TER=":0.5" bun scripts/update-data.ts
PERFORMANCE_1Y="15:" bun scripts/update-data.ts
SKIP_YAHOO=true bun scripts/update-data.ts
```

## TypeScript and verification

The browser app is intentionally build-free: `index.html` carries the markup, styles and bootstrap, and `app.tsx` is TypeScript compiled in the browser with Babel standalone - no build step, no bundler, no `tsconfig.json` needed. Bun runs TypeScript out of the box.

Verification before every publish:

```bash
bun install --frozen-lockfile
bun test
bun build --target=bun scripts/update-data.ts --outfile=/dev/null
git diff --check
```

## Brands table

| Brand | Where to get the data |
| --- | --- |
| **AAM** | [aamlive.com](https://www.aamlive.com/ETF) \| [AAM](https://daggerok.github.io/AAM/) |
| **abrdn (Aberdeen)** | [aberdeeninvestments.com](https://www.aberdeeninvestments.com/en-us/investor/funds/etfs) \| [aberdeen](https://daggerok.github.io/aberdeen/) |
| **Amplify** | [amplifyetfs.com](https://amplifyetfs.com/) \| [Amplify](https://daggerok.github.io/Amplify/) |
| **ARK Invest** | [ark-funds.com](https://www.ark-funds.com/our-etfs/) \| [ARK](https://daggerok.github.io/ARK/) |
| **Capital Group** | [capitalgroup.com](https://www.capitalgroup.com/advisor/investments/exchange-traded-funds.html) \| [Capital-Group](https://daggerok.github.io/Capital-Group/) |
| **Fidelity** | [fidelity.com](https://www.fidelity.com/etfs) \| [Fidelity](https://daggerok.github.io/Fidelity/) |
| **First Trust** | [ftportfolios.com](https://www.ftportfolios.com/Retail/etf/etflist.aspx) \| [First-Trust](https://daggerok.github.io/First-Trust/) |
| **Franklin Templeton** | [franklintempleton.com](https://www.franklintempleton.com/investments/options/exchange-traded-funds) \| [Franklin](https://daggerok.github.io/Franklin/) |
| **Global X** | [globalxetfs.com/explore](https://www.globalxetfs.com/explore) \| [Global-X](https://daggerok.github.io/Global-X/) |
| **Goldman Sachs** | [am.gs.com](https://am.gs.com/en-us/individual/funds?locale=en-us&audience=individual&sf=funds&filters=funds%7CETF&limit=100) \| [Goldman-Sachs](https://daggerok.github.io/Goldman-Sachs/) |
| **Invesco** | [invesco.com](https://www.invesco.com/us/en/financial-products/etfs.html) \| [Invesco](https://daggerok.github.io/Invesco/) |
| **iShares** | [ishares.com](https://www.ishares.com/) \| [iShares](https://daggerok.github.io/iShares/) |
| **JPMorgan** | [am.jpmorgan.com](https://am.jpmorgan.com/us/en/asset-management/adv/products/fund-explorer/etf) \| [JPMorgan](https://daggerok.github.io/JPMorgan/) |
| **NEOS** | [neosfunds.com](https://neosfunds.com/#explore-etfs) \| [Neos](https://daggerok.github.io/Neos/) |
| **Northern Trust** | [etfs.ntam.northerntrust.com](https://etfs.ntam.northerntrust.com/us/en/individual/funds) \| [Northern-Trust](https://daggerok.github.io/Northern-Trust/) |
| **Pacer ETFs** | [paceretfs.com](https://www.paceretfs.com/products/) \| [Pacer](https://daggerok.github.io/Pacer/) |
| **Parametric** | [eatonvance.com](https://www.eatonvance.com/products/etfs.html) \| [Parametric](https://daggerok.github.io/Parametric/) |
| **ProShares** | [proshares.com](https://www.proshares.com/our-etfs/find-proshares-etfs) \| [ProShares](https://daggerok.github.io/ProShares/) |
| **Schwab** | [schwabassetmanagement.com](https://www.schwabassetmanagement.com/products) \| [Schwab](https://daggerok.github.io/Schwab/) |
| **SP Funds** | [sp-funds.com](https://www.sp-funds.com/) \| [SP-Funds](https://daggerok.github.io/SP-Funds/) |
| **SPDR** | [ssga.com](https://www.ssga.com/us/en/intermediary/etfs/fund-finder) \| [SPDR](https://daggerok.github.io/SPDR/) |
| **Sprott ETFs** | [sprottetfs.com](https://sprottetfs.com/) \| [Sprott](https://daggerok.github.io/Sprott/) |
| **Tema ETFs** | [temaetfs.com](https://temaetfs.com/funds) \| [Tema](https://daggerok.github.io/Tema/) |
| **Themes ETFs** | [themesetfs.com/etfs](https://themesetfs.com/etfs) \| [Themes](https://daggerok.github.io/Themes/) |
| **VanEck** | [vaneck.com](https://www.vaneck.com/us/en/etf-mutual-fund-finder/) \| [VanEck](https://daggerok.github.io/VanEck/) |
| **Vanguard** | [investor.vanguard.com](https://investor.vanguard.com/etf/list) \| [Vanguard](https://daggerok.github.io/Vanguard/) |
| **VictoryShares** | [vcm.com VictoryShares ETFs](https://www.vcm.com/products/victoryshares-etfs/victoryshares-etfs-list) \| [VictoryShares](https://daggerok.github.io/VictoryShares/) |
| **WisdomTree** | [wisdomtree.com](https://www.wisdomtree.com/investments) \| [WisdomTree](https://daggerok.github.io/WisdomTree/) |
| **Xtrackers** | [etf.dws.com](https://etf.dws.com/en-us/etf-products/) \| [Xtrackers](https://daggerok.github.io/Xtrackers/) |

## Sibling applications

| Application | Data provider | Repository |
| --- | --- | --- |
| AAM | Official AAM catalog/detail HTML + full holdings XLS + SEC N-PORT holdings fallback + Yahoo market history/dividends | [AAM](https://github.com/daggerok/AAM) |
| abrdn (Aberdeen) | Official Aberdeen gateway + SEC N-PORT holdings fallback + Yahoo history/dividends | [aberdeen](https://github.com/daggerok/aberdeen) |
| Amplify | Amplify ETFs Firestore data feed + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance history/dividends | [Amplify](https://github.com/daggerok/Amplify) |
| ARK Invest | ark-funds.com fund pages + overview/NAV-history/performance JSON + official daily holdings CSV + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance distributions/history fallback | [ARK](https://github.com/daggerok/ARK) |
| Capital Group | Official Capital Group fund data + SEC N-PORT holdings fallback + Yahoo history fallback | [Capital-Group](https://github.com/daggerok/Capital-Group) |
| Fidelity | SEC EDGAR N-PORT-P + Yahoo Finance | [Fidelity](https://github.com/daggerok/Fidelity) |
| First Trust | ftportfolios.com official ETF list + fund summary, holdings, distribution and price-history export pages + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance history fallback | [First-Trust](https://github.com/daggerok/First-Trust) |
| Franklin Templeton | franklintempleton.com ETF listings + product pages + SEC EDGAR N-PORT-P | [Franklin](https://github.com/daggerok/Franklin) |
| Global X | globalxetfs.com Next.js catalog and fund pages + dated full-holdings CSV | [Global-X](https://github.com/daggerok/Global-X) |
| Goldman Sachs | am.gs.com fund finder + detail pages + SEC EDGAR N-PORT-P | [Goldman-Sachs](https://github.com/daggerok/Goldman-Sachs) |
| Invesco | invesco.com fund pages and sitemap + official Invesco fund API (monthly returns, NAV, AUM, yields, daily holdings, expense ratio) + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance history/dividends | [Invesco](https://github.com/daggerok/Invesco) |
| iShares | iShares (BlackRock) product workbooks | [iShares](https://github.com/daggerok/iShares) |
| JPMorgan | am.jpmorgan.com fund explorer + product-data JSON | [JPMorgan](https://github.com/daggerok/JPMorgan) |
| NEOS | neosfunds.com lineup table + official fund pages + daily holdings CSV | [Neos](https://github.com/daggerok/Neos) |
| Northern Trust | etfs.ntam.northerntrust.com funds list + per-fund CSV/JSON downloads | [Northern-Trust](https://github.com/daggerok/Northern-Trust) |
| Pacer ETFs | paceretfs.com product catalog and fund pages (Cloudflare WAF; r.jina.ai proxy fallback) + SEC EDGAR N-PORT-P (Pacer Funds Trust) + Yahoo Finance history/dividends | [Pacer](https://github.com/daggerok/Pacer) |
| Parametric | eatonvance.com ETF catalog and Parametric product pages + SEC EDGAR N-PORT-P holdings + Yahoo Finance history/dividends | [Parametric](https://github.com/daggerok/Parametric) |
| ProShares | proshares.com ETF finder + fund pages + official data host | [ProShares](https://github.com/daggerok/ProShares) |
| Schwab | schwabassetmanagement.com product pages + CSV exports | [Schwab](https://github.com/daggerok/Schwab) |
| SP Funds | sp-funds.com homepage catalog, fund pages and daily holdings CSV + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance history/dividends | [SP-Funds](https://github.com/daggerok/SP-Funds) |
| SPDR | SSGA / State Street public feeds | [SPDR](https://github.com/daggerok/SPDR) |
| Sprott ETFs | sprottetfs.com fund pages + SEC EDGAR N-PORT-P (Sprott Funds Trust) + Yahoo Finance history/dividends | [Sprott](https://github.com/daggerok/Sprott) |
| Tema ETFs | Tema official fund pages + dated daily holdings CSV; SEC EDGAR N-PORT-P holdings fallback only + Yahoo Finance price/history/dividend fallback | [Tema](https://github.com/daggerok/Tema) |
| Themes ETFs | themesetfs.com catalog + daily holdings CSV + Yahoo Finance history/dividends + SEC N-PORT-P holdings fallback | [Themes](https://github.com/daggerok/Themes) |
| VanEck | vaneck.com ETF finder + product pages | [VanEck](https://github.com/daggerok/VanEck) |
| Vanguard | Vanguard product pages + SEC EDGAR N-PORT-P | [Vanguard](https://github.com/daggerok/Vanguard) |
| VictoryShares | VCM VictoryShares catalog and product JSON + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance adjusted-market-price history | [VictoryShares](https://github.com/daggerok/VictoryShares) |
| WisdomTree | WisdomTree product table + SEC EDGAR N-PORT-P + Yahoo Finance | [WisdomTree](https://github.com/daggerok/WisdomTree) |
| Xtrackers | Official DWS catalog/US sitemap + PDP/XLSX + SEC N-PORT-P holdings fallback + Yahoo Finance daily prices/history/dividends | [Xtrackers](https://github.com/daggerok/Xtrackers) |

## License

[MIT — same as all sibling ETF repositories.](./LICENSE)

Invesco® and the fund names/tickers referenced here are trademarks of Invesco Holding Company Limited, used under licence by Invesco Ltd. and its affiliates. This is an independent, unofficial tool; it is not affiliated with, endorsed by, or sponsored by Invesco. All data is reproduced from Invesco's own public web pages and API, public SEC EDGAR filings and Yahoo Finance for research purposes. All other trademarks, including index names, are the property of their respective owners.
