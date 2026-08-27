// Invesco ETF seed: the optional offline fallback for the catalog discovery
// step, plus the public URL patterns every Invesco fund page follows.
//
// `scripts/update-data.ts` normally discovers the catalog live from the
// Invesco ETF "Excel Product List Download" CSV (every active US Invesco ETF,
// with ticker / name / inception / CUSIP / ISIN / exchange / category / TER /
// NAV / net assets / prices / yields / returns), so this seed may stay empty.
// It is consulted only when the download endpoint is unreachable: the last
// published `api/invesco/index.json` is the primary fallback, this list the
// secondary one. Use it to pin funds that must never disappear from the
// catalog (a delisted-but-still-watched fund, a fund Invesco temporarily
// hides from the product list, …).
//
// Verified once against investco.com product pages and (for the optional
// EDGAR fallback fields) the Invesco ETF registrant filings on SEC EDGAR.
// `trustCik` + `accession` are only needed to pull holdings from Form
// N-PORT-P when the Invesco holdings download is unavailable for a fund.

export type InvescoSeedFund = {
  ticker: string;
  name: string;
  category: string;
  inception: string | null;
  exchange: string;
  ter: number | null;
  cusip?: string | null;
  isin?: string | null;
  trustCik?: string | null;
  accession?: string | null;
  fundPage?: string;
};

// Pin extra funds here (alphabetical by ticker) to keep them in the catalog
// even when the Invesco product-list download is down. Example shape:
//
//   {
//     ticker: 'QQQM',
//     name: 'Invesco NASDAQ 100 ETF',
//     category: 'Us Equity',
//     inception: '2020-10-15',
//     exchange: 'NasdaqGM',
//     ter: 0.15,
//     cusip: '460906409',
//     isin: 'US4609064096',
//   },
export const INVESCO_FUNDS: InvescoSeedFund[] = [];

const SITE = 'https://www.invesco.com';
const PRODUCT_BASE = `${SITE}/us/en/financial-products/etfs`;
const LEGACY_BASE = `${SITE}/us/financial-products/etfs`;

// Product-detail page pattern used across the Invesco site (`?ticker=` flavor,
// the same one the sibling repos' brands tables link to).
export function investcoFundPageUrl(ticker: string): string {
  return `${PRODUCT_BASE}/${encodeURIComponent(String(ticker).toLowerCase())}.html`;
}

// Legacy generic product-detail route — still the documented entry point for
// the whole US ETF line-up and what the sibling brands tables link to.
export function investcoProductDetailUrl(ticker: string, audience = 'Investor'): string {
  return `${LEGACY_BASE}/product-detail?audienceType=${encodeURIComponent(audience)}&ticker=${encodeURIComponent(String(ticker).toUpperCase())}`;
}

// The per-fund "download holdings" CSV that backs ./api/invesco holdings.
export function investcoHoldingsDownloadUrl(ticker: string, audience = 'Investor'): string {
  return `${LEGACY_BASE}/holdings/main/holdings/0?audienceType=${encodeURIComponent(audience)}&action=download&ticker=${encodeURIComponent(String(ticker).toUpperCase())}`;
}

// The per-fund "prices & yields" CSV (daily NAV / close / premium-discount /
// 30-day SEC yield history). Kept as a documented pattern: the updater uses
// it only when `PRICES_HISTORY=1` (or `INVESCO_PRICES_HISTORY=1`) because it is not part of the
// public unauthenticated download set for every fund.
export function investcoPricesDownloadUrl(ticker: string, audience = 'Investor'): string {
  return `${LEGACY_BASE}/pricing/main/prices/0?audienceType=${encodeURIComponent(audience)}&action=download&ticker=${encodeURIComponent(String(ticker).toUpperCase())}`;
}

// Catalog-wide product list (name, ticker, inception, index ticker, CUSIP,
// ISIN, exchange, assets, prices, yields, returns).
export function investcoProductListUrl(audience = 'Advisor'): string {
  return `${LEGACY_BASE}/performance/prices/main/performance/0?audienceType=${encodeURIComponent(audience)}&action=download`;
}
