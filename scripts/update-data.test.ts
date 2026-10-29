// Bun's test runner provides these globals at runtime.
// @ts-ignore bun types are intentionally not required for this zero-dependency Bun script.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseRange,
  parseAumRange,
  normalizeNumberText,
  normalizeInvescoCategory,
  normalizeExchange,
  pickEftsCik,
  parseNportFiling,
  parseSecFundTickers,
  parseSecCompanyNames,
  nportTickers,
  nportIsFresh,
  nportHoldingsSheet,
  dngHoldingTicker,
  withoutNportDebtTickers,
  parseChart,
  chartUrl,
  priceReturns,
  lastCompletedQuarterEnd,
  annualizedToTotal,
  totalToAnnualized,
  indicatedYield,
  isYieldBasis,
  yieldBasisFromKind,
  withYieldBasis,
  inferDistributionFrequency,
  deriveCatalogMetrics,
  returnsBasisFields,
  lastHistoryIsoDate,
  withReturnsBasis,
  formatEdgarDate,
  formatInvescoDate,
  toIsoDate,
  epochToIsoDate,
  numberOrNull,
  normalizeHoldingName,
  normalizeHoldingNameCore,
  cleanHoldingTicker,
  dngUrl,
  parseSitemapFundPages,
  isFundPageUrl,
  parseFundPage,
  parseDngPerformance,
  parseDngPrices,
  parseDngYields,
  parseDngHoldings,
  holdingsGuard,
  holdingsWeightCount,
  HOLDINGS_GUARD_RELAX,
  CLOSED_FUNDS,
  closedFund,
  RENAMED_FUNDS,
  renamedFund,
  mergeWindowedChart,
  indexRowFromMeta,
  invescoProductDetailUrl,
  runUpdater,
  setApiRootForTests,
  configureFetchForTests,
  fetchWithRetry,
  paceRequests,
  OFFICIAL_RETURNS_BASIS,
  STALE_OFFICIAL_RETURNS_BASIS,
  HOLDINGS_HEADERS,
  BOND_SHEET_HEADERS,
  CONTROL_NAMES,
  isCertError,
  installSystemCa,
  main,
  readConfig,
  resolveControls,
  runtimeControls,
} from './update-data';

// ---------------------------------------------------------------------------
// Shared setup: a clean environment, a pinned time zone, restored globals
// ---------------------------------------------------------------------------

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const file = JSON.parse(read('scripts/update-data.config.json')) as Record<string, string>;
const DEFAULT_API_ROOT = new URL('../api/invesco/', import.meta.url);

// Control variables the workflow or the owner's shell may export. Tests pass explicit env objects,
// but the updater also reads a few process-wide variables, so they are removed for every test.
const AMBIENT = [...CONTROL_NAMES, ...CONTROL_NAMES.map((name) => `INVESCO_${name}`), 'INVESCO_LIMIT', 'HISTORICAL_PAGE_SIZE', 'GITHUB_STEP_SUMMARY'];
const realFetch = globalThis.fetch;
const realLog = console.log;
const realError = console.error;
const realExitCode = process.exitCode;
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = Object.fromEntries([...AMBIENT, 'TZ'].map((name) => [name, process.env[name]]));
  for (const name of AMBIENT) delete process.env[name];
  process.env.TZ = 'UTC';
});

afterEach(() => {
  globalThis.fetch = realFetch;
  console.log = realLog;
  console.error = realError;
  process.exitCode = realExitCode;
  configureFetchForTests({ timeoutMs: 45_000, sleepMs: 0, lanes: 1, deadlineMs: 25 * 60_000 });
  setApiRootForTests(DEFAULT_API_ROOT);
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

const quiet = () => { console.log = () => {}; };

// ---------------------------------------------------------------------------
// Inline samples (trimmed from real invesco.com responses of 2026-10-02) and the mocked fetch
// ---------------------------------------------------------------------------

const SITEMAP_SAMPLE = [
  '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
  '<url><loc>https://www.invesco.com/us/en/financial-professional.html</loc><lastmod>2026-09-28T13:14:51.869Z</lastmod></url>',
  '<url><loc>https://www.invesco.com/us/en/financial-products/etfs/invesco-sp-500-equal-weight-etf.html</loc><lastmod>2026-09-30T08:00:00.000Z</lastmod>',
  '<xhtml:link rel="alternate" hreflang="en-US" href="https://www.invesco.com/us/en/financial-products/etfs/invesco-sp-500-equal-weight-etf.html"/></url>',
  '<url><loc>https://www.invesco.com/us/en/financial-products/etfs/invesco-qqq-trust-series-1.html</loc></url>',
  '<url><loc>https://www.invesco.com/us/en/financial-products/etfs/invesco-qqq-trust-series-1.html</loc></url>',
  '<url><loc>https://www.invesco.com/us/en/financial-products/etfs.html</loc></url>',
  '<url><loc>https://www.invesco.com/us/en/financial-products/etfs/other/nested.html</loc></url>',
  '</urlset>',
].join('');

const FUND_PAGE_SAMPLE = [
  '<html><head><title>Invesco S&amp;P 500® Equal Weight ETF | Invesco US</title></head><body>',
  '<div data-config="{&#34;id&#34;:&#34;product-hero-56f045f350&#34;,&#34;fundName&#34;:&#34;Invesco S&amp;P 500® Equal Weight ETF&#34;,&#34;assetType&#34;:&#34;&#34;,&#34;assetClass&#34;:&#34;Equity&#34;,&#34;assetSubClass&#34;:&#34;U.S. Equity&#34;,&#34;breadcrumbKeys&#34;:[]}"></div>',
  '<div data-config="{&#34;tabularListFieldMap&#34;:{&#34;effectiveDate&#34;:{&#34;text&#34;:&#34;as of&#34;}},&#34;productListFieldValueMap&#34;:{&#34;ticker&#34;:&#34;RSP&#34;,&#34;cusip&#34;:&#34;46137V357&#34;,&#34;isin&#34;:&#34;US46137V3574&#34;,&#34;bloombergTicker&#34;:&#34;SPXEWTR&#34;,&#34;indexProvider&#34;:&#34;S&amp;P Dow Jones Indices LLC&#34;,&#34;exchange&#34;:&#34;NYSE ARCA&#34;,&#34;InceptionDate&#34;:&#34;2003-04-24&#34;,&#34;managementFee&#34;:&#34;0.2&#34;,&#34;acquiredFundFeesAndExpenses&#34;:null,&#34;futuresBrokerageFee&#34;:null,&#34;totalExpenseRatio&#34;:&#34;0.2&#34;,&#34;netExpenseRatio&#34;:&#34;0.19&#34;},&#34;displayComponent&#34;:true}"></div>',
  '</body></html>',
].join('\n');

const PERFORMANCE_SAMPLE = {
  effectiveDate: '2026-08-31',
  performanceStartDate: '2003-04-24',
  cusip: '46137V357',
  currencyType: 'BASE',
  currencyCode: 'USD',
  annualizedPerformance: [
    { ytd: 15.444784, y1: 18.251952, y3: 15.425061, y5: 8.801189, y10: 11.995326, inception: 11.389501, label: 'fund', benchmarkOrder: 0, displayLabel: 'Fund NAV' },
    { ytd: 15.460576, y1: 18.180392, y3: 15.430324, y5: 8.816683, y10: 12.000022, inception: 11.390154, label: 'marketPrice', benchmarkOrder: 0, displayLabel: 'Fund market price' },
    { ytd: 15.592969, y1: 18.49925, y3: 15.619777, y5: 9.010854, y10: 12.217589, inception: 11.812278, label: 'benchmark', benchmarkOrder: 10, displayLabel: 'S&amp;P 500 Equal Weight Index' },
  ],
};

const PRICES_SAMPLE = {
  effectiveDate: '2026-10-01', cusip: '46137V357', currency: 'USD', nav: 208.981986, marketValue: 95423821287.229996,
  oneDayNetAssetValueChangePercent: 0.493898, sharesOutstanding: 456612663, openingPrice: 208.21, closingPrice: 209, medianBidAskSpread: 0,
};

const YIELDS_SAMPLE = {
  cusip: '46137V357', effectiveDate: '2026-09-30', secYield30Day: 1.568944, secYield30DayEffectiveDate: null, distributionYield: 1.52941,
  twelveMonthDistributionRate: 1.52943, secUnsubsidizedYield30Day: null,
};

// MRNA's weight is raised so the sample adds up to ~100% like a real sheet (holdingsGuard rejects a sum outside 50..150)
const HOLDINGS_SAMPLE = {
  cusip: '46137V357', effectiveDate: '2026-09-30', effectiveBusinessDate: '2026-09-30', totalNumberOfHoldings: 504,
  holdings: [
    { ticker: 'MRNA', issuerName: 'Moderna Inc', units: 1443681, percentageOfTotalNetAssets: 99.292069, securityTypeName: 'Common Stock', sectorName: 'Health Care', coupon: null, maturityDate: null, spMoodysRating: 'NR/NR', marketValueBase: 278009650.17, contractExpiryDate: null, cusip: '60770K107', currency: 'USD', securityTypeCode: 'COM' },
    { ticker: 'LWEZ6', issuerName: 'E-mini S&amp;P 500 Equal Weight Futures', units: 1000, percentageOfTotalNetAssets: 0.178355, securityTypeName: 'Index Future', sectorName: null, coupon: null, maturityDate: '2026-12-18', spMoodysRating: 'NR/NR', marketValueBase: 169770000, contractExpiryDate: '2026-12-18', cusip: 'LWEZ6', currency: 'USD', securityTypeCode: 'IFUT' },
    { ticker: null, issuerName: 'CONTRA FUTURE E-MIN S&amp;P 500 EWF DEC26LWEZ6', units: -1000, percentageOfTotalNetAssets: -0.178355, securityTypeName: 'Synthetic Cash', sectorName: null, coupon: null, maturityDate: '2026-12-18', spMoodysRating: 'NR/NR', marketValueBase: -169770000, contractExpiryDate: '2026-12-18', cusip: 'LWEZ6', currency: 'USD', securityTypeCode: 'SYN' },
  ],
};

const BOND_HOLDINGS_SAMPLE = {
  cusip: '46138G805', effectiveDate: '2026-09-30', totalNumberOfHoldings: 2073,
  holdings: [
    { ticker: 'ILS', issuerName: 'State of Illinois', units: 14197451.0041, percentageOfTotalNetAssets: 1.691692, securityTypeName: 'Municipal Bond', sectorName: 'Municipal', coupon: 5.1, maturityDate: '2033-06-01', nextCallDate: null, spMoodysRating: 'A/A1', marketValueBase: 13880270.01, cusip: '452151LF8', currency: 'USD', securityTypeCode: 'MUNI' },
  ],
};

type MockFund = { ticker: string; cusip: string; slug: string };
const MOCK_FUNDS: MockFund[] = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF'].map((ticker, i) => ({ ticker, cusip: `46137V35${i}`, slug: `invesco-fund-${ticker.toLowerCase()}-etf` }));
const MOCK_PAGE_BASE = 'https://www.invesco.com/us/en/financial-products/etfs/';

function mockFundPage(fund: MockFund): string {
  return FUND_PAGE_SAMPLE.replace('RSP', fund.ticker).replace('46137V357', fund.cusip).replace('US46137V3574', `US${fund.cusip}4`);
}

function mockChart(adjclose = [100, 100.5, 101]): Record<string, unknown> {
  const timestamp = [1_790_000_000, 1_790_086_400, 1_790_172_800];
  return {
    chart: { result: [{ meta: { fullExchangeName: 'NYSE Arca', longName: 'Mock Fund', regularMarketPrice: 101, regularMarketTime: 1_790_172_800, firstTradeDate: 1_000_000_000 },
      timestamp, indicators: { quote: [{ close: [100, 100.5, 101], volume: [10, 20, 30] }], adjclose: [{ adjclose }] }, events: {} }] },
  };
}

type MockRequest = { url: string; userAgent: string };

function installMockFetch(options: { listed?: MockFund[]; unlisted?: MockFund[]; renamed?: string[]; delayMs?: number; adjclose?: number[] } = {}): { requests: MockRequest[]; peak: () => number } {
  const requests: MockRequest[] = [];
  const listed = options.listed ?? MOCK_FUNDS;
  let inFlight = 0;
  let peak = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    requests.push({ url, userAgent: headers.get('user-agent') ?? '' });
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    try {
      if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      const json = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200 });
      // invesco.com answers HTTP 406 to browser-like User-Agents
      if (/invesco\.com/.test(url) && /mozilla|chrome|safari/i.test(headers.get('user-agent') ?? '')) return new Response('', { status: 406 });
      if (url.endsWith('/us/en/sitemap.xml')) {
        return new Response(`<urlset>${listed.map((fund) => `<url><loc>${MOCK_PAGE_BASE}${fund.slug}.html</loc></url>`).join('')}</urlset>`, { status: 200 });
      }
      const page = listed.find((fund) => url === `${MOCK_PAGE_BASE}${fund.slug}.html`);
      if (page) return new Response(mockFundPage(page), { status: 200 });
      // addressed by ticker, the API answers [] for a renamed fund's old ticker
      const byTicker = /shareclasses\/([A-Z]+)\/prices\?idType=ticker&/.exec(url);
      if (byTicker) return json((options.renamed ?? []).includes(byTicker[1]) ? [] : PRICES_SAMPLE);
      const api = /shareclasses\/([0-9A-Z]{9})(\/[a-z/]+)?\?/.exec(url);
      if (api && listed.some((fund) => fund.cusip === api[1])) {
        if (url.includes('/performance/standard')) return json(PERFORMANCE_SAMPLE);
        if (url.includes('/prices?')) return json(PRICES_SAMPLE);
        if (url.includes('/holdings/fund')) return json(HOLDINGS_SAMPLE);
        if (url.includes('variationType=yieldInformation')) return json(YIELDS_SAMPLE);
      }
      if (url.includes('query1.finance.yahoo.com/v8/finance/chart/')) return json(mockChart(options.adjclose));
      return new Response('', { status: 404 });
    } finally {
      inFlight -= 1;
    }
  }) as unknown as typeof fetch;
  return { requests, peak: () => peak };
}

function seedIndexRow(fund: MockFund, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ticker: fund.ticker, name: `Fund ${fund.ticker}`, category: 'US Equity', fundPage: `${MOCK_PAGE_BASE}${fund.slug}.html`, dataFile: `./funds/${fund.ticker}/meta.json`,
    cusip: null, isin: null, ter: '—', terValue: null, nav: '—', navValue: null, aum: '$1.00 M', aumValue: 1_000_000, asOfDate: '—', inceptionDate: '—', exchange: 'NYSEArca',
    closePrice: '$50.00', closePriceValue: 50, premiumDiscount: '—', premiumDiscountValue: null, distributions: { frequency: 'Quarterly', exDate: '—', dividend: '—' },
    returns: { monthEnd: { asOfDate: 'Aug 31 2026', ytd: 1.5, yr1: 2.5, yr3: 3.5, yr5: 4.5, yr10: 5.5, sinceInception: 6.5 }, quarterEnd: null },
    metrics: { ytd: 1.5, tr1y: 2.5, tr3y: 10.87, tr5y: 24.62, tr10y: 71.4, cagr3y: 3.5, cagr5y: 4.5, cagr10y: 5.5, siAnn: 6.5, dividendYield: 1.1, dividendYieldText: '1.10%', secYield: null, secYieldText: '—',
      returnsBasis: 'official Invesco NAV total returns (product list download)', performanceAsOf: '2026-08-31' },
    holdings: 7, history: 9, ...extra,
  };
}

async function withTempFeed<T>(rows: MockFund[], run: (root: URL) => Promise<T>, metaOnly: string[] = []): Promise<T> {
  const { mkdirSync } = await import('node:fs');
  const { pathToFileURL } = await import('node:url');
  const dir = mkdtempSync(join(tmpdir(), 'invesco-feed-'));
  try {
    mkdirSync(join(dir, 'funds'), { recursive: true });
    writeFileSync(join(dir, 'index.json'), JSON.stringify({ funds: rows.map((fund) => seedIndexRow(fund)) }));
    for (const ticker of metaOnly) {
      mkdirSync(join(dir, 'funds', ticker), { recursive: true });
      writeFileSync(join(dir, 'funds', ticker, 'meta.json'), JSON.stringify({ ticker, name: `Fund ${ticker}`, category: 'US Equity', source: {}, returns: { monthEnd: {} } }));
    }
    const root = pathToFileURL(`${dir}/`);
    setApiRootForTests(root);
    return await run(root);
  } finally {
    setApiRootForTests(DEFAULT_API_ROOT);
    rmSync(dir, { recursive: true, force: true });
  }
}

const pipelineControls = (extra: Record<string, string> = {}) =>
  readConfig({ REQUEST_SLEEP: '0', MAX_RETRIES: '1', EDGAR_FALLBACK: 'false', CONCURRENCY: '1', ...extra });


// ---------------------------------------------------------------------------
// controls: resolver precedence, strict validation, aliases, config parity
// ---------------------------------------------------------------------------

describe('controls', () => {
  test('range parsers accept open, inclusive, suffixed and preset bounds', () => {
    expect(parseRange('', 'X')).toBeUndefined();
    expect(parseRange(':', 'X')).toBeUndefined();
    expect(parseRange('1:5', 'X')).toEqual({ min: 1, max: 5 });
    expect(parseRange('2:', 'X')).toEqual({ min: 2, max: undefined });
    expect(parseRange(':3', 'X')).toEqual({ min: undefined, max: 3 });
    expect(parseRange('0.1%:0.5%', 'X')).toEqual({ min: 0.1, max: 0.5 });
    expect(parseRange('$1:$2', 'X')).toEqual({ min: 1, max: 2 });
    expect(parseAumRange('')).toBeUndefined();
    expect(parseAumRange('10M:2B')).toEqual({ min: 10_000_000, max: 2_000_000_000 });
    expect(parseAumRange('1B:')).toEqual({ min: 1_000_000_000, max: undefined });
    for (const [preset, bounds] of [['nano', [0, 10e6]], ['micro', [10e6, 300e6]], ['small', [300e6, 2e9]], ['mid', [2e9, 10e9]], ['large', [10e9, undefined]]] as const) {
      expect(parseAumRange(preset)).toEqual({ min: bounds[0], max: bounds[1] });
    }
  });

  test('range parsers reject malformed bounds instead of dropping the filter', () => {
    expect(() => parseRange('15', 'X')).toThrow(/colon is required/);
    expect(() => parseRange('5:1', 'X')).toThrow(/must not exceed/);
    expect(() => parseRange('1:2:3', 'PERFORMANCE_1Y')).toThrow();
    expect(() => parseAumRange('42')).toThrow(/colon is required/);
    expect(() => parseAumRange('abc:')).toThrow();
    expect(() => parseAumRange('1B:2B:3B')).toThrow();
  });

  test('precedence: file < advanced < nonblank input < env < protected variable', () => {
    const resolve = (...args: [unknown, unknown?, unknown?, Record<string, string>?]) => resolveControls(...args);
    expect(resolve({ CONCURRENCY: 2 }).CONCURRENCY).toBe('2');
    expect(resolve({ CONCURRENCY: 2 }, { CONCURRENCY: 3 }).CONCURRENCY).toBe('3');
    expect(resolve({ CONCURRENCY: 2 }, { CONCURRENCY: 3 }, { CONCURRENCY: '4' }).CONCURRENCY).toBe('4');
    expect(resolve({ CONCURRENCY: 2 }, { CONCURRENCY: 3 }, { CONCURRENCY: '4' }, { CONCURRENCY: '6' }).CONCURRENCY).toBe('6');
    // a blank input inherits the layer below, advanced may deliberately blank a key
    expect(resolve({ TICKERS: 'QQQ' }, {}, { TICKERS: '' }).TICKERS).toBe('QQQ');
    expect(resolve({ TICKERS: 'QQQ' }, { TICKERS: '' }, { TICKERS: '' }).TICKERS).toBe('');
    // an explicitly set empty env var wins and clears the control
    expect(resolve({ TICKERS: 'QQQ' }, {}, {}, { TICKERS: '' }).TICKERS).toBe('');
    expect(resolve({ SKIP_YAHOO: true }, {}, {}, { SKIP_YAHOO: 'false' }).SKIP_YAHOO).toBe('false');
    // the protected repo variable SEC_UA is passed as env by the workflow and beats every other layer
    const protectedUa = resolve(file, { SEC_UA: 'adv' }, { SEC_UA: 'input' }, { SEC_UA: 'protected-ua' });
    expect(protectedUa.SEC_UA).toBe('protected-ua');
    expect(readConfig(protectedUa).secUa).toBe('protected-ua');
  });

  test('brand env aliases keep working and the brand prefix wins over the plain name', () => {
    expect(resolveControls({}, {}, {}, { INVESCO_CONCURRENCY: '5', CONCURRENCY: '6' }).CONCURRENCY).toBe('5');
    expect(resolveControls({ MAX_FETCHES: 5 }, {}, {}, { INVESCO_LIMIT: '7' }).MAX_FETCHES).toBe('7');
    expect(resolveControls({ HISTORY_PAGE_SIZE: 5 }, {}, {}, { HISTORICAL_PAGE_SIZE: '9' }).HISTORY_PAGE_SIZE).toBe('9');
    expect(resolveControls({ SKIP_YAHOO: 'false' }, {}, {}, { INVESCO_SKIP_YAHOO: 'true' }).SKIP_YAHOO).toBe('true');
  });
});

describe('controls 2', () => {
  test('strict validation: unknown keys, bad values and CR/LF/NUL injection are errors', () => {
    const bad: unknown[] = [
      { UNKNOWN: 1 }, { OUTPUT_DIR: 'x' }, { SEC_UA: 'x\nEVIL=yes' }, { SEC_UA: 'x\rfoo' }, { SEC_UA: 'x\0bad' },
      { CONCURRENCY: 0 }, { MAX_RETRIES: 0 }, { MAX_RETRIES: '0' }, { MAX_FETCHES: 1.5 }, { MAX_FETCHES: -1 }, { HOLDINGS_PAGE_SIZE: 'abc' },
      { REQUEST_SLEEP: '-1' }, { VERBOSE: 'maybe' }, { SKIP_YAHOO: 'perhaps' }, { AUM: 'huge' }, { AUM: '5:1' }, { AUM: 'abc:' }, { TER: '1' },
      { PERFORMANCE_1Y: '15' }, { PERFORMANCE_1Y: '1:2:3' }, { SITEMAP_URL: 'http://example.com/x' }, { SITEMAP_URL: 'https://' },
      { TICKERS: ['QQQ'] }, { TICKERS: { a: 1 } }, { USE_SYSTEM_CA: 'maybe' },
      // controls of the retired CSV downloads are rejected instead of ignored
      { PRODUCT_LIST_URL: 'x' }, { CATALOG_HTML_URL: 'x' }, { STORE_RAW_DOWNLOADS: 'x' }, { PRICES_HISTORY: 'x' }, { AUDIENCE_TYPE: 'x' },
      // HISTORY_RANGE is max or whole years
      { HISTORY_RANGE: 'garbage' }, { HISTORY_RANGE: '6mo' }, { HISTORY_RANGE: 'ytd' }, { HISTORY_RANGE: '0y' }, { HISTORY_RANGE: '-5y' }, { HISTORY_RANGE: '5' },
    ];
    for (const value of bad) expect(() => resolveControls(value)).toThrow();
    for (const value of [null, [], 'text']) expect(() => resolveControls(value)).toThrow();
    expect(() => resolveControls({}, '{}')).toThrow();
    expect(() => resolveControls({}, {}, { TICKERS: 'a\nb' })).toThrow();
    expect(() => resolveControls({}, {}, {}, { INVESCO_SEC_UA: 'x\0bad' })).toThrow();
    for (const [name, value] of [['AUM', 'abc:'], ['PERFORMANCE_1Y', '1:2:3'], ['HISTORY_RANGE', 'garbage']]) {
      expect(() => resolveControls({}, {}, {}, { [name]: value })).toThrow();
    }
  });

  test('valid HISTORY_RANGE and USE_SYSTEM_CA values are accepted and normalized', () => {
    for (const good of ['max', '5y', '10Y']) expect(resolveControls({}, {}, {}, { HISTORY_RANGE: good }).HISTORY_RANGE).toBe(good);
    expect(resolveControls(file).USE_SYSTEM_CA).toBe('auto');
    expect(resolveControls(file, {}, {}, { USE_SYSTEM_CA: 'TRUE' }).USE_SYSTEM_CA).toBe('true');
    expect(resolveControls(file, { USE_SYSTEM_CA: 'False' }).USE_SYSTEM_CA).toBe('false');
  });

  test('the scheduled path (empty inputs) equals the config defaults, with the SEC contact', async () => {
    expect(resolveControls(file, {}, {})).toEqual(file);
    expect(await runtimeControls({})).toEqual(file);
    expect((await runtimeControls({ TICKERS: 'QQQ RSP', MAX_FETCHES: '3' })).TICKERS).toBe('QQQ RSP');
    const config = readConfig(resolveControls(file, {}, {}));
    expect(config).toMatchObject({
      tickers: [], maxFetches: 0, requestSleep: 1, concurrency: 2, holdingsPageSize: 250, historyPageSize: 1000, maxRetries: 2,
      historyRange: 'max', edgarFallback: true, skipYahoo: false, skipInvesco: false, performanceRanges: {}, totalReturnRanges: {},
      sitemapUrl: 'https://www.invesco.com/us/en/sitemap.xml', secUa: 'daggerok ETF feed daggerok@gmail.com',
    });
    expect(config.aumRange).toBeUndefined();
    expect(config.terRange).toBeUndefined();
    expect(config.dividendYieldRange).toBeUndefined();
    expect(file.SEC_UA).toBe('daggerok ETF feed daggerok@gmail.com');
  });

  test('config keys == CONTROL_NAMES == --help entries', async () => {
    expect(Object.keys(file).sort()).toEqual([...CONTROL_NAMES].sort());
    for (const value of Object.values(file)) expect(typeof value).toBe('string');
    expect(JSON.stringify(file).match(/[\w.]+@[\w.]+/g)).toEqual(['daggerok@gmail.com']);
    const help: string[] = [];
    console.log = (...args: unknown[]) => { help.push(args.join(' ')); };
    await main(['--help'], {});
    console.log = realLog;
    // --help lists the five tenors of PERFORMANCE_* / TOTAL_RETURN_* on one row
    for (const name of CONTROL_NAMES) {
      const tenor = name.match(/^(PERFORMANCE|TOTAL_RETURN)_(1Y|3Y|5Y|10Y)$/);
      if (!tenor) expect(help.join('\n')).toMatch(new RegExp(`^  ${name}\\s`, 'm'));
    }
  });
});


// ---------------------------------------------------------------------------
// parsing: one tiny inline sample per provider payload
// ---------------------------------------------------------------------------

function chartFixture(options: { closes?: (number | null)[]; adj?: (number | null)[]; dividends?: Record<string, { date: number; amount: number }> } = {}) {
  const start = Date.UTC(2020, 0, 2) / 1000;
  const closes = options.closes ?? [100, 105, 110, 111, 120];
  const adj = options.adj ?? closes;
  const timestamps = closes.map((_, index) => start + index * 86_400);
  return {
    chart: {
      result: [
        {
          meta: { fullExchangeName: 'NasdaqGS', longName: 'Invesco QQQ Trust', navPrice: 706.3, regularMarketPrice: 706.32, regularMarketTime: Date.UTC(2026, 7, 21, 20, 0) / 1000, firstTradeDate: start },
          timestamp: timestamps,
          indicators: { quote: [{ close: closes, volume: timestamps.map(() => 1000) }], adjclose: [{ adjclose: adj }] },
          events: { dividends: options.dividends ?? {} },
        },
      ],
    },
  };
}

describe('parsing', () => {
  test('sitemap yields each canonical fund page once; only slug pages count as fund pages', () => {
    expect(parseSitemapFundPages(SITEMAP_SAMPLE)).toEqual([
      'https://www.invesco.com/us/en/financial-products/etfs/invesco-sp-500-equal-weight-etf.html',
      'https://www.invesco.com/us/en/financial-products/etfs/invesco-qqq-trust-series-1.html',
    ]);
    expect(parseSitemapFundPages('')).toEqual([]);
    expect(isFundPageUrl('https://www.invesco.com/us/en/financial-products/etfs/invesco-qqq-trust-series-1.html', 'QQQ')).toBe(true);
    expect(isFundPageUrl('https://www.invesco.com/us/en/financial-products/etfs/rsp.html', 'RSP')).toBe(false);
    expect(isFundPageUrl('https://www.invesco.com/us/financial-products/etfs/product-detail?ticker=RSP', 'RSP')).toBe(false);
    expect(isFundPageUrl(undefined)).toBe(false);
  });

  test('fund facts come from the HTML-escaped page JSON; pages without facts are not fund pages', () => {
    expect(parseFundPage(FUND_PAGE_SAMPLE)).toEqual({
      ticker: 'RSP', cusip: '46137V357', isin: 'US46137V3574', name: 'Invesco S&P 500 Equal Weight ETF', benchmark: 'SPXEWTR',
      exchange: 'NYSE ARCA', inception: '2003-04-24', ter: 0.2, netTer: 0.19, managementFee: 0.2, assetClass: 'Equity', assetSubClass: 'U.S. Equity',
    });
    expect(parseFundPage('<html><head><title>Invesco QQQ ETF</title></head><body>total expense ratio is 0.18%.</body></html>')).toBeNull();
    expect(parseFundPage('<html>&#34;productListFieldValueMap&#34;:{}</html>')).toBeNull();
    expect(parseFundPage(FUND_PAGE_SAMPLE.replace('46137V357', 'bad'))).toBeNull();
    expect(parseFundPage('')).toBeNull();
  });

  test('fund API URLs are addressed by CUSIP', () => {
    const base = 'https://dng-api.invesco.com/cache/v1/accounts/en_US/shareclasses/46137V357';
    expect(dngUrl('46137v357', 'performance')).toBe(`${base}/performance/standard?idType=cusip&productType=ETF&performanceSubType=annualized&performancePeriod=monthly`);
    expect(dngUrl('46137V357', 'prices')).toBe(`${base}/prices?idType=cusip&productType=ETF&variationType=priceListing&productSubType=ETF`);
    expect(dngUrl('46137V357', 'yields')).toBe(`${base}?expand=nav&idType=cusip&productType=ETF&variationType=yieldInformation&managementFeeWaiver=0.0`);
    expect(invescoProductDetailUrl('RSP', 'Advisor')).toBe('https://www.invesco.com/us/financial-products/etfs/product-detail?audienceType=Advisor&ticker=RSP');
    expect(dngUrl('46137V357', 'holdings')).toBe(`${base}/holdings/fund?idType=cusip&productType=ETF`);
  });

  test('official performance takes the fund NAV row; young-fund periods and a 0.00 inception stay null, never 0', () => {
    expect(parseDngPerformance(PERFORMANCE_SAMPLE)).toEqual({
      asOfDate: '2026-08-31',
      returns: { ytd: 15.44, yr1: 18.25, yr3: 15.43, yr5: 8.8, yr10: 12, sinceInception: 11.39 },
    });
    const young = { effectiveDate: '2026-08-31', annualizedPerformance: [{ ytd: 4.5, y1: null, y3: null, y5: null, y10: null, inception: 4.5, label: 'fund' }] };
    expect(parseDngPerformance(young).returns).toEqual({ ytd: 4.5, yr1: null, yr3: null, yr5: null, yr10: null, sinceInception: 4.5 });
    const placeholder = { effectiveDate: '2026-08-31', annualizedPerformance: [{ label: 'fund', ytd: 0.27, y1: 2.68, y3: 3.05, y5: -0.79, y10: null, inception: 0 }] };
    const parsed = parseDngPerformance(placeholder as any);
    expect(parsed.returns.sinceInception).toBeNull();
    expect(parsed.returns.yr5).toBe(-0.79);
  });

  test('prices and yields carry the fields the hub reads; missing yields are null; unusable payloads are rejected', () => {
    expect(parseDngPrices(PRICES_SAMPLE)).toEqual({ asOfDate: '2026-10-01', nav: 208.981986, close: 209, netAssets: 95423821287.23 });
    expect(parseDngYields(YIELDS_SAMPLE)).toEqual({ secYield: 1.57, dividendYield: 1.53, distributionRate: 1.53 });
    expect(parseDngYields({ cusip: 'X', secYield30Day: null, twelveMonthDistributionRate: null, distributionYield: null })).toEqual({ secYield: null, dividendYield: null, distributionRate: null });
    expect(() => parseDngPerformance({ effectiveDate: '2026-08-31' })).toThrow();
    expect(() => parseDngPerformance('' as unknown as Record<string, unknown>)).toThrow();
    expect(() => parseDngPrices({ effectiveDate: '2026-10-01' })).toThrow();
    expect(() => parseDngYields('' as unknown as Record<string, unknown>)).toThrow();
  });
});

describe('parsing 2', () => {
  test('holdings: equity keeps percent weights, futures are not bonds, bonds add coupon and maturity, empty is an error', () => {
    const equity = parseDngHoldings(HOLDINGS_SAMPLE, 'RSP');
    expect(equity.asOfDate).toBe('2026-09-30');
    expect(equity.headers).toEqual(HOLDINGS_HEADERS);
    expect(equity.rows[0]).toEqual({
      Name: 'Moderna Inc', Ticker: 'MRNA', Identifier: '60770K107', Weight: '99.292069', 'Market Value': '278009650.17', 'Shares Held': '1443681', 'Asset Category': 'Health Care',
    });
    expect(equity.rows[1].Name).toBe('E-mini S&P 500 Equal Weight Futures');
    expect(equity.rows[1]['Asset Category']).toBe('Index Future');
    expect(equity.rows[2].Ticker).toBe('-');
    expect(equity.rows[2]['Shares Held']).toBe('-1000');
    const bond = parseDngHoldings(BOND_HOLDINGS_SAMPLE, 'BAB');
    expect(bond.headers).toEqual(BOND_SHEET_HEADERS);
    expect(bond.rows[0]).toEqual({
      Name: 'State of Illinois', Ticker: '-', Identifier: '452151LF8', Weight: '1.691692', 'Market Value': '13880270.01', 'Shares Held': '14197451.0041',
      'Asset Category': 'Municipal / A/A1', Coupon: '5.1', Maturity: 'Jun 01 2033',
    });
    // an error so the SEC fallback can take over
    expect(() => parseDngHoldings({ effectiveDate: '2026-09-30', holdings: [] }, 'XYZ')).toThrow();
    expect(() => parseDngHoldings({ message: 'Bad Request', status: 'error' }, 'XYZ')).toThrow();
  });

  test('holdings guard: header-only, renamed weight column, broken weights, a bad weight sum and a halved sheet are rejected', () => {
    const headers = ['Name', 'Ticker', 'Weight'];
    const rows = [{ Name: 'A', Ticker: 'A', Weight: '60%' }, { Name: 'B', Ticker: 'B', Weight: '40%' }];
    expect(holdingsGuard(headers, rows, 2)).toBeNull();
    expect(holdingsGuard(headers, [['A', 'A', '60'], ['B', 'B', '40']], null)).toBeNull();
    expect(holdingsGuard([], [], 0)).toBeNull(); // nothing published before: an empty sheet is honest
    expect(holdingsGuard(headers, [], 505)).toContain('no holdings rows');
    expect(holdingsGuard(['Name', 'Ticker', 'Wt'], rows, 2)).toContain('no weight column');
    expect(holdingsGuard(headers, rows.map((row) => ({ ...row, Weight: '6\u200B0' })), 2)).toContain('numeric weight');
    const allocation = [{ Name: 'Cash&Collateral', Ticker: '-', Weight: '100' }, { Name: 'Equities', Ticker: '-', Weight: '476' }];
    expect(holdingsGuard(headers, allocation, 2)).toContain('outside 50..150');
    expect(holdingsGuard(headers, allocation, 2, ['sum'])).toBeNull();
    expect(holdingsGuard(headers, rows, 5)).toContain('less than half');
  });

  test('Yahoo chart: trading days, adjusted closes, sorted positive dividends, empty result is an error', () => {
    const chart = parseChart(chartFixture({ closes: [100, null, 110], adj: [90, null, 99] }));
    expect(chart.days.map((day) => day.close)).toEqual([100, 110]);
    expect(chart.days.map((day) => day.adjClose)).toEqual([90, 99]);
    expect(chart.navPrice).toBe(706.3);
    expect(chart.exchangeName).toBe('NasdaqGS');
    const noAdj = chartFixture({ closes: [100, 101] }) as any;
    delete noAdj.chart.result[0].indicators.adjclose;
    expect(parseChart(noAdj).days.map((day) => day.adjClose)).toEqual([100, 101]);
    const withDividends = parseChart(
      chartFixture({
        dividends: {
          '2': { date: Date.UTC(2026, 5, 15) / 1000, amount: 0.7 },
          '1': { date: Date.UTC(2026, 2, 15) / 1000, amount: 0.65 },
          '0': { date: Date.UTC(2025, 11, 15) / 1000, amount: -1 },
        },
      }),
    );
    expect(withDividends.dividends.map((entry) => entry.amount)).toEqual([0.65, 0.7]);
    expect(() => parseChart({ chart: { result: [] } })).toThrow(/empty result/);
  });

  test('N-PORT (shared nport-reader): positions, own identifiers, report period, net assets; missing numbers stay empty, tickers only for U.S. equities', () => {
    const xml = `
      <edgarSubmission><formData><genInfo><regName>INVESCO EXCHANGE-TRADED FUND TRUST II</regName><regCik>0001378872</regCik>
      <seriesName>Invesco BulletShares 2025 Corporate Bond ETF</seriesName><seriesId>S000056733</seriesId><repPdDate>2026-06-30</repPdDate></genInfo>
      <fundInfo><totAssets>100.5</totAssets><netAssets>87850000000.00</netAssets></fundInfo>
      <invstOrSecs><invstOrSec><name>Apple Inc</name><cusip>037833100</cusip><identifiers><isin value="US0378331005"/></identifiers><balance>124827810.00000000</balance>
      <curCd>USD</curCd><valUSD>26312454069.90</valUSD><pctVal>8.24</pctVal><assetCat>EC</assetCat></invstOrSec>
      <invstOrSec><name>SAP SE</name><cusip>D66992104</cusip><identifiers><isin value="DE0007164600"/></identifiers><balance>1000</balance><curCd>EUR</curCd><valUSD>250000</valUSD><pctVal>0.1</pctVal><assetCat>EC</assetCat></invstOrSec>
      <invstOrSec><name>Visa Inc.</name><cusip>92826CAD4</cusip><identifiers><isin value="US92826CAD48"/></identifiers><balance>1000000</balance><curCd>USD</curCd><valUSD>990000</valUSD>
      <assetCat>DBT</assetCat><debtSec><maturityDt>2028-01-31</maturityDt><annualizedRt>3.15</annualizedRt></debtSec></invstOrSec>
      <invstOrSec><name>DJIA MINI E-CBOT</name><cusip>000000000</cusip><identifiers><other otherDesc="Bloomberg Identifier" value="BBG01VKPGXL9"/></identifiers><curCd>USD</curCd><valUSD>4913771.74</valUSD><pctVal>0.005</pctVal>
      <assetCat>DE</assetCat><derivativeInfo><futrDeriv derivCat="FUT"><descRefInstrmnt><otherRefInst><identifiers><cusip value="78462F103"/><ticker value="SPY"/></identifiers></otherRefInst></descRefInstrmnt></futrDeriv></derivativeInfo></invstOrSec></invstOrSecs></formData></edgarSubmission>`;
    const filing = parseNportFiling(xml);
    expect([filing.seriesId, filing.seriesName, filing.regCik, filing.repPdDate, filing.netAssets, filing.positions.length]).toEqual(['S000056733', 'Invesco BulletShares 2025 Corporate Bond ETF', '0001378872', '2026-06-30', 87_850_000_000, 4]);
    const names = parseSecCompanyNames({ 0: { ticker: 'AAPL', title: 'Apple Inc.' }, 1: { ticker: 'SAP', title: 'SAP SE' }, 2: { ticker: 'V', title: 'VISA INC.' } });
    const sheet = nportHoldingsSheet(filing, nportTickers(filing.positions, names));
    expect(sheet.headers).toEqual(BOND_SHEET_HEADERS);
    expect(sheet.rows[0]).toEqual({ Name: 'Apple Inc', Ticker: 'AAPL', Identifier: '037833100', Weight: '8.24', 'Market Value': '26312454069.9', 'Shares Held': '124827810', 'Asset Category': 'EC', Coupon: '', Maturity: '' });
    // SAP SE in euros is not the SAP ADR, a Visa note is no "V" and keeps an empty weight (never 0), the future keeps its own id, not SPY's
    expect(sheet.rows.slice(1).map((row) => [row.Ticker, row.Identifier, row.Weight, row.Coupon, row.Maturity])).toEqual([
      ['-', 'D66992104', '0.1', '', ''], ['-', '92826CAD4', '', '3.15', 'Jan 31 2028'], ['-', 'BBG01VKPGXL9', '0.005', '', ''],
    ]);
    expect(nportHoldingsSheet(parseNportFiling(xml.replace(/<debtSec>[\s\S]*?<\/debtSec>/, '')), []).headers).toEqual(HOLDINGS_HEADERS);
    expect(parseNportFiling('').positions).toEqual([]);
  });
});

describe('parsing 3', () => {
  test('N-PORT freshness: a report replaces published holdings only when strictly newer; the report quarter anchors to the last completed one', () => {
    expect(nportIsFresh('2026-06-30', '2026-10-23', 504)).toBe(false); // the daily invesco.com sheet is newer than any quarterly filing
    expect(nportIsFresh('2026-06-30', '2026-06-30', 504)).toBe(false);
    expect(nportIsFresh('2026-06-30', '2026-03-31', 504)).toBe(true);
    expect(nportIsFresh('', '2026-03-31', 504)).toBe(false);
    expect(nportIsFresh('2026-06-30', null, 0)).toBe(true);
    expect(nportIsFresh('2026-06-30', null, 504)).toBe(false); // published rows without a date cannot be compared: keep them
    for (const [now, expected] of [[Date.UTC(2026, 7, 21), '2026-06-30'], [Date.UTC(2026, 0, 15), '2025-12-31'], [Date.UTC(2026, 4, 1), '2026-03-31'], [Date.UTC(2026, 10, 1), '2026-09-30']] as const) {
      expect(lastCompletedQuarterEnd(new Date(now)).toISOString().slice(0, 10)).toBe(expected);
    }
  });

  test('SEC lookups: EFTS registrant, fund ticker table, company names only for equity rows', () => {
    const payload = {
      hits: [
        { _source: { display_names: { cik: 12345, names: ['Some Other Trust'] } } },
        { _source: { display_names: { cik: 913760, names: ['Invesco QQQ Trust', 'INVESCO SERIES TRUST'] } } },
      ],
    };
    expect(pickEftsCik(payload, 'Invesco QQQ Trust')).toBe('0000913760');
    expect(pickEftsCik(payload, 'Unknown Fund')).toBeNull();
    const real = {
      hits: { total: { value: 2, relation: 'eq' }, hits: [
        { _source: { ciks: ['0001667919'], display_names: ['FIRST TRUST EXCHANGE-TRADED FUND VIII  (CIK 0001667919)'] } },
        { _source: { ciks: ['0001209466'], display_names: ['INVESCO EXCHANGE-TRADED FUND TRUST  (CIK 0001209466)'] } },
      ] },
    };
    expect(pickEftsCik(real, 'Invesco Exchange-Traded Fund Trust')).toBe('0001209466');

    const tickers = parseSecFundTickers({
      fields: ['cik', 'seriesId', 'classId', 'symbol'],
      data: [[1209466, 'S000060812', 'C000197628', 'RSP'], [1378872, 'S000019246', 'C000053072', 'bab'], [0, 'S000000000', 'C000000000', 'ZZZ']],
    });
    expect(tickers.get('RSP')).toEqual({ cik: '0001209466', seriesId: 'S000060812', classId: 'C000197628' });
    expect(tickers.get('BAB')?.seriesId).toBe('S000019246');
    expect(tickers.has('ZZZ')).toBe(false);
    expect(parseSecFundTickers({}).size).toBe(0);
    // INV-3: only equity rows get the issuer's stock ticker, a bond of the same issuer (BSCP: Visa 92826CAD4) stays "-"
    const visa = parseSecCompanyNames({ '0': { cik_str: 1403161, ticker: 'V', title: 'VISA INC.' }, '1': { cik_str: 1, ticker: '', title: 'No Ticker Inc' } });
    const filing = parseNportFiling('<invstOrSec><name>Visa Inc</name><cusip>92826C839</cusip><curCd>USD</curCd><assetCat>EC</assetCat></invstOrSec><invstOrSec><name>Visa Inc</name><cusip>92826CAD4</cusip><curCd>USD</curCd><assetCat>DBT</assetCat></invstOrSec><invstOrSec><name>No Ticker Inc</name><cusip>123456789</cusip><assetCat>EC</assetCat></invstOrSec>');
    expect(nportTickers(filing.positions, visa)).toEqual(['V', '', '']);
  });

  test('value normalizers: numbers, dates, categories, exchanges', () => {
    for (const [raw, expected] of [['--', null], ['—', null], ['N/A', null], ['4.56', 4.56], ['$1,234.56', 1234.56], ['0.40%', 0.4]] as const) expect(numberOrNull(raw)).toBe(expected);
    expect(normalizeNumberText('2.97057744E8')).toBe('297057744');
    expect(normalizeNumberText('1.5e-3')).toBe('0.0015');
    expect(normalizeNumberText('1,234.56')).toBe('1234.56');
    expect(normalizeNumberText('Apple Inc')).toBe('Apple Inc');
    expect(toIsoDate('08/21/2026')).toBe('2026-08-21');
    expect(toIsoDate('2026-8-1')).toBe('2026-08-01');
    expect(toIsoDate('n/a')).toBe('n/a');
    expect(formatInvescoDate('2026-08-21')).toBe('08/21/2026');
    expect(formatEdgarDate('2026-06-30')).toBe('Jun 30 2026');
    expect(epochToIsoDate(Date.UTC(2026, 0, 15) / 1000)).toBe('2026-01-15');
    for (const [raw, expected] of [
      ['Equity, US Equity', 'US Equity'], ['Fixed Income, High Yield', 'Fixed Income'], ['Alternative, Absolute Return', 'Alternatives'],
      ['Real Assets & Commodities, Agriculture', 'Real Assets'], ['Digital Assets,', 'Digital Assets'], ['', 'ETF'], ['Something New, Detail', 'Something New'],
    ] as const) expect(normalizeInvescoCategory(raw)).toBe(expected);
    for (const [raw, expected] of [
      ['NYSEArca', 'NYSE Arca'], ['NYSE ARCA', 'NYSE Arca'], ['NasdaqGM', 'Nasdaq'], ['Nasdaq/NMS (Global Market)', 'Nasdaq'],
      ['CBOE BZX U.S. EQUITIES EXCHANGE', 'Cboe BZX'], ['Cboe US', 'Cboe BZX'],
    ] as const) expect(normalizeExchange(raw)).toBe(expected);
  });

  test('holding names and tickers: suffixes stripped, share classes kept distinct, placeholders rejected', () => {
    for (const [raw, expected] of [
      ['Apple Inc.', 'APPLE'], ['Microsoft Corp Common Stock', 'MICROSOFT'], ['THE BOEING CO', 'BOEING'],
      ['Alphabet Inc. Class C Capital Stock', 'ALPHABET CL C'], ['Alphabet Inc. Class A Common Stock', 'ALPHABET CL A'], ['Alphabet Inc Cl C', 'ALPHABET CL C'],
      ['Berkshire Hathaway Inc Del', 'BERKSHIRE HATHAWAY'], ['Berkshire Hathaway Inc Cap Stk Cl A', 'BERKSHIRE HATHAWAY CL A'], ['', ''], ['---', ''],
    ] as const) expect(normalizeHoldingName(raw)).toBe(expected);
    expect(normalizeHoldingNameCore('Apple Inc.')).toBe('APPLE');
    expect(normalizeHoldingName('Alphabet Inc Cl A')).not.toBe(normalizeHoldingName('Alphabet Inc Cl C'));
    for (const [raw, expected] of [['brk-b', 'BRK-B'], ['SCE^L', 'SCE^L'], ['BF/A', 'BF/A'], ['', ''], ['N/A', ''], ['see file', '']] as const) expect(cleanHoldingTicker(raw)).toBe(expected);
  });

  test('dates: month-name and U.S. dates are the same calendar day in every time zone', () => {
    for (const tz of ['Asia/Tokyo', 'America/Los_Angeles', 'UTC']) {
      process.env.TZ = tz;
      expect(['Oct 24, 2026', 'Oct 24 2026', '24 Oct 2026', '10/24/2026', '10/24/26', '2026-10-24', '2026-10-24T00:00:00Z'].map((raw) => toIsoDate(raw))).toEqual(Array(7).fill('2026-10-24'));
      expect(lastHistoryIsoDate([{ Date: 'Oct 23 2026' }, { Date: 'Oct 24 2026' }])).toBe('2026-10-24');
      expect(toIsoDate('not a date')).toBe('not a date');
    }
  });
});

describe('parsing 4', () => {
  test('ticker hygiene: a bare symbol only for a U.S. listing; cash, futures, rights and kept N-PORT debt rows publish "-"', () => {
    const line = (ticker: string, securityTypeName: string, localCurrencyName?: string) => ({ ticker, issuerName: 'X', securityTypeName, localCurrencyName });
    // IMFL: Saputo trades as SAP in Canadian dollars next to the SAP SE ADR (PID) and Sappi (PXH); Samsung is 005930
    expect(dngHoldingTicker(line('SAP', 'Common Stock', 'Canadian Dollar'))).toBe('');
    expect(dngHoldingTicker(line('005930', 'Common Stock', 'South Korean Won'))).toBe('');
    expect(dngHoldingTicker(line('SAP', 'American Depository Receipt', 'US Dollar'))).toBe('SAP');
    expect(dngHoldingTicker(line('ACN', 'Common Stock', 'US Dollar'))).toBe('ACN');
    expect(dngHoldingTicker(line('MRNA', 'Common Stock'))).toBe('MRNA'); // older payloads carry no local currency
    expect(dngHoldingTicker(line('AGPXX', 'Money Market Fund, Taxable', 'US Dollar'))).toBe('AGPXX');
    expect(dngHoldingTicker(line('RIGD', 'Global Depository Receipt', 'US Dollar'))).toBe('');
    for (const type of ['Currency', 'Uninvestible Cash', 'Index Future', 'Commodity Future', 'CDI Swaption', 'Right', 'Equity Warrant', 'Preferred Stock']) expect([type, dngHoldingTicker(line('USD', type, 'US Dollar'))]).toEqual([type, '']);
    const futures = parseDngHoldings(HOLDINGS_SAMPLE, 'RSP');
    expect(futures.rows.map((row) => row.Ticker)).toEqual(['MRNA', '-', '-']);
    // BSCP's kept N-PORT sheet: Visa and Rogers notes lose V and RCI, equity rows and invesco.com sector names are untouched
    const kept = [
      { Name: 'Visa Inc.', Ticker: 'V', Identifier: '92826CAD4', 'Asset Category': 'DBT' },
      { Name: 'Rogers Communications Inc.', Ticker: 'RCI', Identifier: '775109BE0', 'Asset Category': 'DBT' },
      { Name: 'Visa Inc.', Ticker: 'V', Identifier: '92826C839', 'Asset Category': 'EC' },
      { Name: 'Moderna Inc', Ticker: 'MRNA', Identifier: '60770K107', 'Asset Category': 'Health Care' },
    ];
    expect(withoutNportDebtTickers(kept).map((row) => row.Ticker)).toEqual(['-', '-', 'V', 'MRNA']);
  });
});


// ---------------------------------------------------------------------------
// metrics: null for unavailable, same key set, basis and date travel together
// ---------------------------------------------------------------------------

const NO_OFFICIAL = { ytd: null, yr1: null, yr3: null, yr5: null, yr10: null, sinceInception: null };
const DERIVED = { asOfDate: '2026-08-21', ytd: 13.79, yr1: 54.21, cagr3y: 18.99, cagr5y: null, cagr10y: null, siAnn: null, mo1: null, qtd: null };

describe('metrics', () => {
  test('price returns anchor to the last close; a young fund gets nulls, not made-up returns', () => {
    const days = [
      { date: '2015-01-02', close: 100, adjClose: 100, volume: 1 },
      { date: '2022-01-03', close: 200, adjClose: 195, volume: 1 },
      { date: '2023-01-03', close: 220, adjClose: 214, volume: 1 },
      { date: '2026-01-02', close: 300, adjClose: 290, volume: 1 },
      { date: '2026-06-30', close: 320, adjClose: 310, volume: 1 },
      { date: '2026-07-01', close: 322, adjClose: 312, volume: 1 },
      { date: '2026-08-21', close: 340, adjClose: 330, volume: 1 },
    ];
    const now = new Date(Date.UTC(2026, 7, 21));
    const returns = priceReturns(days, now, '2015-01-02');
    expect(returns.asOfDate).toBe('2026-08-21');
    // each anchor is the last trading day at or before the period start, so a thin fixture falls back to the newest early-enough day
    expect(returns.ytd).toBeCloseTo(54.21, 2);
    expect(returns.yr1).toBeCloseTo(54.21, 2);
    expect(returns.cagr3y).toBeCloseTo(15.53, 2);
    expect(returns.mo1).toBeCloseTo(5.77, 2);
    expect(returns.siAnn).toBeGreaterThan(0);
    const young = priceReturns([{ date: '2026-08-20', close: 10, adjClose: 10, volume: 1 }], now);
    expect(young.asOfDate).toBe('2026-08-20');
    expect(young.ytd).toBeNull();
    expect(young.yr1).toBeNull();
    expect(young.cagr3y).toBeNull();
    expect(young.cagr5y).toBeNull();
    expect(young.siAnn).toBeNull();
    expect(priceReturns([], now).asOfDate).toBe('');
  });

  test('conversions and yields: guarded inputs give null', () => {
    expect(annualizedToTotal(20.15, 3)).toBeCloseTo(73.45, 2);
    expect(annualizedToTotal(null, 3)).toBeNull();
    expect(annualizedToTotal(10, 0)).toBeNull();
    expect(totalToAnnualized(annualizedToTotal(12.5, 5), 5)).toBeCloseTo(12.5, 1);
    expect(totalToAnnualized('n/a' as any, 5)).toBeNull();
    expect(indicatedYield(0.7, 4, 706.32)).toBeCloseTo(0.4, 1);
    expect(indicatedYield(0.65, 12, 41.72)).toBe(18.7);
    expect(indicatedYield(null, 4, 10)).toBeNull();
    expect(indicatedYield(0.5, 0, 10)).toBeNull();
    expect(indicatedYield(0.5, 4, 0)).toBeNull();
    const quarterly = [0, 1, 2, 3].map((i) => ({ epoch: Date.UTC(2026, i * 3, 15) / 1000, amount: 1 }));
    expect(inferDistributionFrequency(quarterly).frequency).toBe('Quarterly');
    const monthly = Array.from({ length: 6 }, (_, i) => ({ epoch: Date.UTC(2026, i, 15) / 1000, amount: 1 }));
    expect(inferDistributionFrequency(monthly)).toEqual({ frequency: 'Monthly', paymentsPerYear: 12 });
    expect(inferDistributionFrequency([])).toEqual({ frequency: 'None', paymentsPerYear: null });
  });

  test('official returns win over derived ones and carry their own as-of date', () => {
    const metrics = deriveCatalogMetrics(
      { ytd: 15.97, yr1: 18.34, yr3: 20.15, yr5: 17.42, yr10: 16.88, sinceInception: 19.44 },
      { ...DERIVED, cagr5y: 12, cagr10y: 11, siAnn: 10, mo1: 1, qtd: 2 },
      0.44, null, null, null, 706.32, 'Yahoo chart API', '2026-07-31',
    );
    expect(metrics.ytd).toBe(15.97);
    expect(metrics.tr1y).toBe(18.34);
    expect(metrics.cagr3y).toBe(20.15);
    expect(metrics.tr3y).toBe(annualizedToTotal(20.15, 3));
    expect(metrics.dividendYield).toBe(0.44);
    expect(metrics.secYield).toBeNull();
    expect(metrics.returnsBasis).toContain('official Invesco month-end NAV total returns');
    expect(metrics.performanceAsOf).toBe('2026-07-31');
    // official returns without a published returns date keep performanceAsOf null
    const undated = deriveCatalogMetrics({ ...NO_OFFICIAL, ytd: 1 }, { ...DERIVED, ytd: 2 }, null, null, null, null, null);
    expect(undated.performanceAsOf).toBeNull();
    expect(String(undated.returnsBasis)).toContain('filled from adjusted closes');
  });

  test('without official returns the derived ones and the indicated yield are used; unavailable stays null', () => {
    const metrics = deriveCatalogMetrics(NO_OFFICIAL, DERIVED, null, null, 0.65, 12, 41.72);
    expect(metrics.ytd).toBe(13.79);
    expect(metrics.tr1y).toBe(54.21);
    expect(metrics.cagr5y).toBeNull();
    expect(metrics.tr5y).toBeNull();
    expect(metrics.dividendYield).toBe(18.7);
    expect(metrics.dividendYieldText).toBe('18.70%');
    expect(metrics.secYield).toBeNull();
    expect(metrics.returnsBasis).toContain('derived from adjusted market-price closes');
    expect(metrics.returnsBasis).toContain('estimates');
    expect(metrics.performanceAsOf).toBe('2026-08-21');
    const empty = deriveCatalogMetrics(NO_OFFICIAL, { ...DERIVED, ytd: null, yr1: null, cagr3y: null, asOfDate: '' }, null, null, null, null, null);
    for (const [key, value] of Object.entries(empty)) {
      if (!['returnsBasis', 'performanceAsOf', 'dividendYieldText', 'secYieldText'].includes(key)) expect(value).toBeNull();
    }
  });

  test('dividendYieldBasis names the definition behind the yield and is null with a null yield', () => {
    const published = deriveCatalogMetrics(NO_OFFICIAL, DERIVED, 1.53, null, 0.65, 12, 41.72);
    expect([published.dividendYield, published.dividendYieldBasis]).toEqual([1.53, 'official-trailing-12m']);
    const indicated = deriveCatalogMetrics(NO_OFFICIAL, DERIVED, null, null, 0.65, 12, 41.72);
    expect(indicated.dividendYieldBasis).toBe('indicated');
    const none = deriveCatalogMetrics(NO_OFFICIAL, DERIVED, null, null, null, null, null);
    expect([none.dividendYield, none.dividendYieldBasis]).toEqual([null, null]);
    // a retained yield keeps the code it was published with
    const retained = deriveCatalogMetrics(NO_OFFICIAL, DERIVED, 18.7, null, 0.65, 12, 41.72, 'Yahoo chart API', null, undefined, 'indicated');
    expect(retained.dividendYieldBasis).toBe('indicated');
    // old free text maps to a code; unknown provider text is official-other, no text is indicated
    expect(yieldBasisFromKind('trailing 12-month distribution rate, published by invesco.com')).toBe('official-trailing-12m');
    expect(yieldBasisFromKind('indicated (latest distribution x inferred frequency / market price)')).toBe('indicated');
    expect(yieldBasisFromKind('some yield published by invesco.com')).toBe('official-other');
    expect(yieldBasisFromKind(undefined)).toBe('indicated');
    expect(isYieldBasis('computed-trailing-12m')).toBe(true);
    expect(isYieldBasis('toString')).toBe(false);
  });
});

describe('metrics 2', () => {
  test('rows rebuilt from meta and kept rows carry the same dividendYieldBasis key set', () => {
    const fresh = Object.keys(deriveCatalogMetrics(NO_OFFICIAL, DERIVED, 1, null, null, null, null));
    const rebuilt = (yields: Record<string, unknown>) => indexRowFromMeta({ ticker: 'DDD', yields }).metrics as Record<string, unknown>;
    expect(Object.keys(rebuilt({ dividendYield: 4.5, dividendYieldKind: 'trailing 12-month distribution rate, published by invesco.com' }))).toEqual(fresh);
    expect(rebuilt({ dividendYield: 4.5, dividendYieldKind: 'trailing 12-month distribution rate, published by invesco.com' }).dividendYieldBasis).toBe('official-trailing-12m');
    expect(rebuilt({ dividendYield: 4.5, dividendYieldKind: 'indicated (latest distribution x inferred frequency / market price)' }).dividendYieldBasis).toBe('indicated');
    expect(rebuilt({ dividendYield: 4.5, dividendYieldBasis: 'official-other' }).dividendYieldBasis).toBe('official-other');
    expect(rebuilt({ dividendYield: null }).dividendYieldBasis).toBeNull();
    // an old kept row without the key, or with a stale code next to a null yield
    const old = withYieldBasis({ ticker: 'X', metrics: { ytd: 1, dividendYield: 2, dividendYieldText: '2.00%', secYield: null } }, { dividendYieldKind: 'trailing 12-month distribution rate, published by invesco.com' });
    expect(Object.keys(old.metrics)).toEqual(['ytd', 'dividendYield', 'dividendYieldText', 'dividendYieldBasis', 'secYield']);
    expect(old.metrics.dividendYieldBasis).toBe('official-trailing-12m');
    const stale = withYieldBasis({ ticker: 'X', metrics: { dividendYield: null, dividendYieldText: '—', dividendYieldBasis: 'indicated' } });
    expect(stale.metrics.dividendYieldBasis).toBeNull();
    const placeholder = withYieldBasis({ ticker: 'X', dataFile: null });
    expect(placeholder.metrics).toEqual({ dividendYieldBasis: null });
  });

  test('every metrics object has the same key set and returnsBasis then performanceAsOf close it', () => {
    const official = deriveCatalogMetrics({ ytd: 1, yr1: 2, yr3: 3, yr5: 4, yr10: 5, sinceInception: 6 }, DERIVED, 1, 1, null, null, null, 'Yahoo chart API', '2026-07-31');
    const derived = deriveCatalogMetrics(NO_OFFICIAL, DERIVED, null, null, 0.65, 12, 41.72);
    const meta = indexRowFromMeta({ ticker: 'DDD', name: 'Fund D', returns: { monthEnd: { ytd: 1 } } }).metrics as Record<string, unknown>;
    const keys = Object.keys(official);
    expect(Object.keys(derived)).toEqual(keys);
    expect(Object.keys(meta)).toEqual(keys);
    expect(keys.slice(-2)).toEqual(['returnsBasis', 'performanceAsOf']);
    // the basis is never empty or a dash, the date is ISO or null
    for (const hasOfficial of [true, false]) {
      for (const date of ['2026-08-21', '', null, 'Aug 21 2026']) {
        const { returnsBasis, performanceAsOf } = returnsBasisFields(hasOfficial, date, 'Yahoo chart API', date);
        expect(returnsBasis.trim().length).toBeGreaterThan(1);
        expect(returnsBasis).not.toBe('-');
        expect(performanceAsOf === null || /^\d{4}-\d{2}-\d{2}$/.test(performanceAsOf)).toBe(true);
      }
    }
  });

  test('siAnn is annualized only from the first trade and over at least one year; a younger cumulative figure is not siAnn', () => {
    // hand-built closes: 100 at the first trade, 150 five years before the last close, 200 at the last close
    const day = (date: string, adjClose: number) => ({ date, close: adjClose, adjClose, volume: 1 });
    const now = new Date(Date.UTC(2026, 7, 21));
    const closes = [day('2016-01-04', 100), day('2021-08-20', 150), day('2026-08-21', 200)];
    // 2x over 10.63 years since the first trade
    expect(priceReturns(closes, now, '2016-01-04').siAnn).toBe(6.74);
    // a HISTORY_RANGE=5y window starts years after the first trade: no since-inception figure (was 5.92, the 5y CAGR)
    const window = priceReturns(closes.slice(1), now, '2016-01-04');
    expect([window.cagr5y, window.siAnn]).toEqual([5.92, null]);
    expect(priceReturns(closes.slice(1), now, null).siAnn).toBeNull();
    // a fund 0.8 years old is never annualized (was 25.71 from +20% in 0.8 years)
    expect(priceReturns([day('2025-11-03', 10), day('2026-08-21', 12)], now, '2025-11-03').siAnn).toBeNull();
  });

  test('the as-of date comes from the newest stored close; the returns block ends with basis and date', () => {
    expect(lastHistoryIsoDate([{ Date: 'Dec 15 2025' }, { Date: 'Feb 23 2026' }])).toBe('2026-02-23');
    expect(lastHistoryIsoDate([{ Date: '2026-07-17' }, { Date: 'Jan 05 2026' }])).toBe('2026-07-17');
    expect(lastHistoryIsoDate([{ Date: '—' }])).toBeNull();
    expect(lastHistoryIsoDate([])).toBeNull();
    const block = withReturnsBasis({ derivedFrom: 'x', returnsBasis: 'old', monthEnd: {} }, { returnsBasis: 'b', performanceAsOf: '2026-07-31' });
    expect(Object.keys(block!)).toEqual(['derivedFrom', 'monthEnd', 'returnsBasis', 'performanceAsOf']);
    expect(withReturnsBasis(null, {})).toBeNull();
  });

  test('a catalog row is rebuilt from a published meta.json with net TER and the metrics contract', () => {
    const row = indexRowFromMeta({
      ticker: 'DDD', name: 'Fund D', category: 'Fixed Income', source: { fundPage: 'https://www.invesco.com/us/en/financial-products/etfs/fund-d.html' },
      identifiers: { cusip: '123456789', isin: null }, expenseRatio: { display: '0.28%', value: 0.28 }, nav: { display: '$25.38', value: 25.38, asOfDate: 'Oct 01 2026' },
      aum: { display: '$1.00 M', value: 1000000 }, marketPrice: { display: '$25.35', value: 25.35 }, premiumDiscount: { display: '-0.12%', value: -0.12 },
      yields: { dividendYield: 4.5, secYield: null }, distributions: { frequency: 'Monthly' },
      returns: { monthEnd: { ytd: 1, yr1: 2, yr3: 3, yr5: null, yr10: null, sinceInception: 4 }, performanceAsOf: '2026-08-31', returnsBasis: OFFICIAL_RETURNS_BASIS },
      holdings: { totalRows: 12 }, history: { totalRows: 34 },
    });
    expect(row.dataFile).toBe('./funds/DDD/meta.json');
    expect(row.terValue).toBe(0.28);
    expect(row.metrics.ytd).toBe(1);
    expect(row.metrics.performanceAsOf).toBe('2026-08-31');
    expect(row.metrics.returnsBasis.length).toBeGreaterThan(1);
    expect([row.holdings, row.history]).toEqual([12, 34]);
  });
});


describe('metrics 3', () => {
  test('a fund younger than a horizon publishes no return for it, official or derived (calendar anniversary of its inception)', async () => {
    quiet();
    const [aaa, bbb] = MOCK_FUNDS;
    installMockFetch({ listed: [aaa, bbb] });
    const base = globalThis.fetch;
    // the same full RSP table for both: AAA started 2024-01-15 (2.6 years by the 2026-08-31 table), BBB on 2025-09-01 (one day short of a year)
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const response = await base(input, init);
      const inception = url === `${MOCK_PAGE_BASE}${aaa.slug}.html` ? '2024-01-15' : url === `${MOCK_PAGE_BASE}${bbb.slug}.html` ? '2025-09-01' : null;
      return inception ? new Response((await response.text()).replace('2003-04-24', inception), { status: 200 }) : response;
    }) as unknown as typeof fetch;
    await withTempFeed([aaa, bbb], async (root) => {
      await runUpdater(pipelineControls({ SKIP_YAHOO: 'true' }));
      const [a, b] = (await readIndex(root)).funds;
      expect([a.metrics.ytd, a.metrics.tr1y, a.metrics.cagr3y, a.metrics.tr3y, a.metrics.cagr5y, a.metrics.cagr10y, a.metrics.siAnn]).toEqual([15.44, 18.25, null, null, null, null, 11.39]);
      expect([a.returns.monthEnd.yr1, a.returns.monthEnd.yr3, a.returns.monthEnd.yr5]).toEqual([18.25, null, null]);
      expect([b.metrics.ytd, b.metrics.tr1y, b.metrics.cagr3y, b.metrics.siAnn, b.returns.monthEnd.sinceInception]).toEqual([15.44, null, null, null, null]);
    });
  });
});


// ---------------------------------------------------------------------------
// pipeline: mocked fetch, a temporary api root, six-fund catalog
// ---------------------------------------------------------------------------

const readIndex = async (root: URL): Promise<{ funds: Record<string, any>[]; counts: Record<string, number> }> => JSON.parse(await Bun.file(new URL('index.json', root)).text());
const readJson = async (root: URL, path: string) => JSON.parse(await Bun.file(new URL(path, root)).text());

// every file under dir (sorted, so the order never depends on the file system) with its mtime
function snapshot(dir: string): Record<string, number> {
  const out: Record<string, number> = {};
  const walk = (path: string): void => {
    for (const name of readdirSync(path).sort()) {
      const full = join(path, name);
      if (statSync(full).isDirectory()) walk(full);
      else out[full] = statSync(full).mtimeMs;
    }
  };
  walk(dir);
  return out;
}

describe('pipeline', () => {
  test('a one-ticker run refreshes that fund and keeps every published row with the same metrics keys', async () => {
    quiet();
    const mock = installMockFetch();
    await withTempFeed(MOCK_FUNDS.slice(0, 3), async (root) => {
      await runUpdater(pipelineControls({ TICKERS: 'AAA' }));
      const indexText = await Bun.file(new URL('index.json', root)).text();
      const index = JSON.parse(indexText);
      expect(index.funds.map((fund: any) => fund.ticker)).toEqual(['AAA', 'BBB', 'CCC']);
      const [aaa, bbb] = index.funds;
      expect(aaa.cusip).toBe('46137V350');
      expect(aaa.terValue).toBe(0.19);
      expect(aaa.terGrossValue).toBe(0.2);
      expect(aaa.navValue).toBe(208.981986);
      expect(aaa.aumValue).toBe(95423821287.23);
      expect(aaa.metrics.ytd).toBe(15.44);
      expect(aaa.metrics.secYield).toBe(1.57);
      expect([aaa.metrics.dividendYield === null, aaa.metrics.dividendYieldBasis === null]).toEqual([false, false]);
      expect(aaa.metrics.dividendYieldBasis).toBe('official-trailing-12m');
      expect(aaa.metrics.returnsBasis).toBe(OFFICIAL_RETURNS_BASIS);
      expect(aaa.metrics.performanceAsOf).toBe('2026-08-31');
      expect(aaa.returns.monthEnd.asOfDate).toBe('Aug 31 2026');
      expect(aaa.holdings).toBe(3);
      expect(bbb.metrics.ytd).toBe(1.5);
      // kept rows without a funds/<T>/meta.json have no data file, the refreshed one has
      expect([aaa.dataFile, bbb.dataFile]).toEqual(['./funds/AAA/meta.json', null]);
      const keys = Object.keys(aaa.metrics);
      for (const fund of index.funds) expect(Object.keys(fund.metrics)).toEqual(keys);
      // the 52-week keys of the range-52w block sit in every row, in front of returnsBasis and performanceAsOf
      expect(keys.slice(-9)).toEqual(['week52Low', 'week52High', 'range52w', 'range52wClose', 'range52wAsOf', 'range52wSince', 'range52wBasis', 'returnsBasis', 'performanceAsOf']);
      // no fabricated "null" keys, quarter-end block keeps its shape
      const meta = await readJson(root, 'funds/AAA/meta.json');
      expect(indexText).not.toContain('"null"');
      expect(JSON.stringify(meta)).not.toContain('"null"');
      expect(Object.keys(aaa.returns.quarterEnd)).toEqual(['asOfDate', 'ytd', 'yr1', 'yr3', 'yr5', 'yr10', 'sinceInception']);
      expect(meta.expenseRatio.value).toBe(0.19);
      expect(meta.expenseRatio.gross.value).toBe(0.2);
      expect(meta.returns.performanceAsOf).toBe('2026-08-31');
      expect(meta.identifiers.indexTicker).toBe('SPXEWTR');
    });
    // unselected funds cost no request, and every invesco.com request identifies itself honestly
    expect(mock.requests.some((request) => request.url.includes('46137V351') || request.url.includes('fund-bbb'))).toBe(false);
    const invesco = mock.requests.filter((request) => /invesco\.com/.test(request.url));
    expect(invesco.length).toBeGreaterThan(4);
    expect(invesco.every((request) => /^daggerok-etf-feed\//.test(request.userAgent) && !/mozilla/i.test(request.userAgent))).toBe(true);
  });

  test('a fund the sitemap no longer lists keeps its published returns, marked stale and not listed, never zero-filled', async () => {
    quiet();
    const mock = installMockFetch({ listed: MOCK_FUNDS.slice(0, 2) });
    await withTempFeed(MOCK_FUNDS.slice(0, 3), async (root) => {
      await runUpdater(pipelineControls({ SKIP_YAHOO: 'true' }));
      const index = await readIndex(root);
      expect(index.funds.map((fund) => fund.ticker)).toEqual(['AAA', 'BBB', 'CCC']);
      expect(index.funds.map((fund) => fund.listed)).toEqual([true, true, false]);
      const ccc = index.funds[2];
      expect(ccc.metrics.ytd).toBe(1.5);
      expect(ccc.metrics.returnsBasis).toBe(STALE_OFFICIAL_RETURNS_BASIS);
      expect(ccc.metrics.performanceAsOf).toBe('2026-08-31');
      expect(ccc.terValue).toBeNull();
      expect(ccc.navValue).toBeNull();
      expect(ccc.dataFile).toBeNull();
      expect([ccc.holdings, ccc.history]).toEqual([7, 9]);
      expect(index.funds[0].dataFile).toBe('./funds/AAA/meta.json');
      expect(index.funds[0].metrics.returnsBasis).toBe(OFFICIAL_RETURNS_BASIS);
      expect((await readJson(root, 'funds/AAA/meta.json')).listed).toBe(true);
    });
    expect(mock.requests.some((request) => request.url.includes('fund-ccc'))).toBe(false);
  });

  test('a renamed fund whose old page shares the CUSIP of the new ticker gets none of its values', async () => {
    quiet();
    // IMSI -> IROC: both pages stay online with one CUSIP, the old ticker printed the new fund's net assets and yields
    const [live] = MOCK_FUNDS;
    const old: MockFund = { ticker: 'OLD', cusip: live.cusip, slug: 'invesco-old-name-etf' };
    const mock = installMockFetch({ listed: [live, old], renamed: ['OLD'] });
    await withTempFeed([live, old], async (root) => {
      const rows = [live, old].map((fund) => seedIndexRow(fund, { cusip: fund.cusip }));
      writeFileSync(new URL('index.json', root), JSON.stringify({ funds: rows }));
      await runUpdater(pipelineControls({ SKIP_YAHOO: 'true', CONCURRENCY: '2' }));
      const [aaa, renamed] = (await readIndex(root)).funds;
      expect([aaa.ticker, aaa.listed, aaa.aumValue, aaa.metrics.secYield, aaa.holdings]).toEqual(['AAA', true, 95423821287.23, 1.57, 3]);
      expect([renamed.ticker, renamed.listed, renamed.cusip]).toEqual(['OLD', false, live.cusip]);
      expect([renamed.aumValue, renamed.navValue, renamed.metrics.dividendYield, renamed.metrics.secYield, renamed.metrics.ytd, renamed.holdings]).toEqual([null, null, null, null, null, 0]);
      const meta = await readJson(root, 'funds/OLD/meta.json');
      expect([meta.aum.value, meta.holdings.totalRows, meta.source.pricesApi]).toEqual([null, 0, null]);
      // the shared CUSIP's holdings are fetched once, for the ticker that owns it
      expect(mock.requests.filter((request) => request.url.includes('/holdings/fund')).length).toBe(1);
      // Q20: with a RENAMED_FUNDS entry the old ticker leaves the index and api, the new one stays as it was
      const entry = { ticker: 'OLD', renamedTo: 'AAA', renamed: '2025-02-24', source: 'https://www.sec.gov/Archives/edgar/data/1/497.htm' };
      expect(() => renamedFund([{ ...entry, renamedTo: 'old' }], 'OLD')).toThrow('RENAMED_FUNDS');
      expect(renamedFund(RENAMED_FUNDS, 'IMSI')?.renamedTo).toBe('IROC');
      const aaaMeta = readFileSync(new URL('funds/AAA/meta.json', root), 'utf8');
      RENAMED_FUNDS.push(entry);
      const seen = mock.requests.length;
      try {
        await runUpdater(pipelineControls({ SKIP_YAHOO: 'true', CONCURRENCY: '2' }));
        expect(mock.requests.slice(seen).filter((request) => /\/OLD\/|old-name/.test(request.url))).toEqual([]);
        expect((await readIndex(root)).funds.map((fund) => fund.ticker)).toEqual(['AAA']);
        expect(readdirSync(new URL('funds/', root)).sort()).toEqual(['AAA']);
        expect(readFileSync(new URL('funds/AAA/meta.json', root), 'utf8')).toBe(aaaMeta);
      } finally {
        RENAMED_FUNDS.splice(RENAMED_FUNDS.indexOf(entry), 1);
      }
    }, ['OLD']);
    // the renamed run fetched AAA once more and never asked for the old ticker
    expect(mock.requests.filter((request) => request.url.includes('/holdings/fund')).length).toBe(2);
  });

  test('a run where every source fails exits red and keeps every fund with its published returns', async () => {
    quiet();
    globalThis.fetch = (async () => new Response('', { status: 404 })) as unknown as typeof fetch;
    await withTempFeed(MOCK_FUNDS.slice(0, 2), async (root) => {
      await expect(runUpdater(pipelineControls())).rejects.toThrow(/every examined fund failed/);
      const index = await readIndex(root);
      expect(index.funds.map((fund) => fund.ticker)).toEqual(['AAA', 'BBB']);
      for (const fund of index.funds) {
        expect(fund.metrics.ytd).toBe(1.5);
        expect(fund.metrics.tr10y).not.toBe(0);
        expect(fund.metrics.performanceAsOf).toBe('2026-08-31');
        expect(fund.aumValue).toBe(1_000_000);
        // counts stay as published, and no meta.json exists for the seeded rows
        expect([fund.holdings, fund.history]).toEqual([7, 9]);
        expect(fund.dataFile).toBeNull();
      }
    });
  });

  test('without invesco.com holdings the fund N-PORT filing is published, empty where it has no number; an older report never replaces it, a newer one does', async () => {
    quiet();
    const [aaa] = MOCK_FUNDS;
    await withTempFeed([aaa], async (root) => {
      installMockFetch({ listed: [aaa] });
      const calls: string[] = [];
      installSecWorld(NPORT_SEC_WORLD('2026-06-30', '0001378872-26-000613'), calls);
      await runUpdater(pipelineControls({ SKIP_YAHOO: 'true', EDGAR_FALLBACK: 'true' }));
      const meta = await readJson(root, 'funds/AAA/meta.json');
      expect([meta.holdings.asOfDate, meta.holdings.totalRows, meta.holdings.source]).toEqual(['2026-06-30', 5, 'SEC EDGAR Form N-PORT-P (accession 0001378872-26-000613, report period 2026-06-30)']);
      const page = await readJson(root, 'funds/AAA/holdings/001.json');
      expect(page.headers).toEqual(BOND_SHEET_HEADERS);
      // AAPL and MSFT by name, NVIDIA is not in the name table, the Visa note keeps its CUSIP and an empty weight
      expect(page.rows.map((row: Record<string, string>) => [row.Ticker, row.Weight, row.Maturity])).toEqual([['AAPL', '30', ''], ['MSFT', '30', ''], ['-', '20', ''], ['-', '19.9', ''], ['-', '', 'Jan 31 2028']]);
      // the document is read from the registrant's own folder
      expect(calls.filter((url) => url.endsWith('/primary_doc.xml'))).toEqual(['https://www.sec.gov/Archives/edgar/data/1378872/000137887226000613/primary_doc.xml']);
      // an older report period (a late filing): nothing is written
      const dir = fileURLToPath(root);
      for (const path of Object.keys(snapshot(dir))) {
        if (path.endsWith('.json')) writeFileSync(path, readFileSync(path, 'utf8').replace(/"(generatedAt|savedAt)": "[^"]+"/g, '"$1": "2000-01-01T00:00:00Z"'));
        utimesSync(path, 1_000_000_000, 1_000_000_000);
      }
      const first = snapshot(dir);
      installMockFetch({ listed: [aaa] });
      installSecWorld(NPORT_SEC_WORLD('2026-03-31', '0001378872-26-000100'), calls);
      await runUpdater(pipelineControls({ SKIP_YAHOO: 'true', EDGAR_FALLBACK: 'true' }));
      expect(snapshot(dir)).toEqual(first);
      // a strictly newer report replaces it
      installMockFetch({ listed: [aaa] });
      installSecWorld(NPORT_SEC_WORLD('2026-09-30', '0001378872-26-000999'), calls);
      await runUpdater(pipelineControls({ SKIP_YAHOO: 'true', EDGAR_FALLBACK: 'true' }));
      expect((await readJson(root, 'funds/AAA/meta.json')).holdings.asOfDate).toBe('2026-09-30');
    });
  });
});

const NPORT_SEC_WORLD = (period: string, accession: string) => ({
  tickers: { fields: ['cik', 'seriesId', 'classId', 'symbol'], data: [[1378872, 'S000056733', 'C000178590', 'AAA']] },
  companies: { 0: { ticker: 'AAPL', title: 'Apple Inc.' }, 1: { ticker: 'MSFT', title: 'MICROSOFT CORP' }, 2: { ticker: 'V', title: 'VISA INC.' } },
  submissions: { cik: '1378872', filings: { recent: { form: ['NPORT-P'], accessionNumber: [accession], filingDate: ['2026-08-27'], reportDate: [period] } } },
  feed: `<feed><entry><content><accession-number>${accession}</accession-number><filing-date>2026-08-27</filing-date><filing-type>NPORT-P</filing-type><filing-href>https://www.sec.gov/Archives/edgar/data/1378872/${accession.replace(/-/g, '')}/${accession}-index.htm</filing-href><period>${period}</period></content></entry></feed>`,
  document: `<edgarSubmission><genInfo><seriesName>Invesco Fund AAA ETF</seriesName><seriesId>S000056733</seriesId><repPdDate>${period}</repPdDate></genInfo><fundInfo><netAssets>1000000</netAssets></fundInfo><invstOrSecs>${[
    ['Apple Inc', '037833100', '30', 'EC'], ['Microsoft Corp', '594918104', '30', 'EC'], ['NVIDIA Corp', '67066G104', '20', 'EC'], ['Amazon.com Inc', '023135106', '19.9', 'EC'],
  ].map(([name, cusip, weight, cat]) => `<invstOrSec><name>${name}</name><cusip>${cusip}</cusip><balance>10</balance><curCd>USD</curCd><valUSD>100</valUSD><pctVal>${weight}</pctVal><assetCat>${cat}</assetCat></invstOrSec>`).join('')}<invstOrSec><name>Visa Inc.</name><cusip>92826CAD4</cusip><curCd>USD</curCd><valUSD>100</valUSD><assetCat>DBT</assetCat><debtSec><maturityDt>2028-01-31</maturityDt><annualizedRt>3.15</annualizedRt></debtSec></invstOrSec></invstOrSecs></edgarSubmission>`,
});

function installSecWorld(world: ReturnType<typeof NPORT_SEC_WORLD>, calls: string[]): void {
  const good = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const json = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200 });
    if (url.includes('/holdings/fund')) return new Response('', { status: 404 });
    if (url.endsWith('/company_tickers_mf.json')) return json(world.tickers);
    if (url.endsWith('/company_tickers.json')) return json(world.companies);
    if (url.includes('data.sec.gov/submissions/CIK0001378872.json')) return json(world.submissions);
    if (url.includes('/cgi-bin/browse-edgar') && url.includes('S000056733')) return new Response(world.feed, { status: 200 });
    if (url.startsWith('https://www.sec.gov/Archives/edgar/data/1378872/') && url.endsWith('/primary_doc.xml')) return new Response(world.document, { status: 200 });
    return good(input, init);
  }) as unknown as typeof fetch;
}

describe('pipeline 2', () => {
  test('holdings that fail the guard keep the fund exactly as published and report it failed', async () => {
    quiet();
    const summaryDir = mkdtempSync(join(tmpdir(), 'invesco-summary-'));
    try {
      await withTempFeed(MOCK_FUNDS.slice(0, 2), async (root) => {
        installMockFetch();
        await runUpdater(pipelineControls());
        const dir = fileURLToPath(root);
        const contents = () => Object.fromEntries(Object.keys(snapshot(dir)).map((path) => [path, readFileSync(path, 'utf8')]));
        const first = contents();
        expect((await readJson(root, 'funds/AAA/meta.json')).holdings.totalRows).toBe(3);
        // the API renames its weight field: every Weight cell of the fresh sheet turns blank
        const good = globalThis.fetch;
        const renamed = { ...HOLDINGS_SAMPLE, holdings: HOLDINGS_SAMPLE.holdings.map(({ percentageOfTotalNetAssets, ...rest }) => ({ ...rest, weightPct: percentageOfTotalNetAssets })) };
        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
          String(input).includes('/holdings/fund') ? new Response(JSON.stringify(renamed), { status: 200 }) : good(input, init)) as unknown as typeof fetch;
        process.env.GITHUB_STEP_SUMMARY = join(summaryDir, 'summary.md');
        await expect(runUpdater(pipelineControls({ TICKERS: 'AAA' }))).rejects.toThrow(/every examined fund failed/);
        expect(contents()).toEqual(first);
        expect(readFileSync(join(summaryDir, 'summary.md'), 'utf8')).toContain('- failed: 1');
      });
    } finally {
      rmSync(summaryDir, { recursive: true, force: true });
    }
  });

  test('a HISTORY_RANGE window never shrinks the published history: older days are rescaled to the new adjusted closes', async () => {
    quiet();
    await withTempFeed(MOCK_FUNDS.slice(0, 1), async (root) => {
      installMockFetch({ listed: MOCK_FUNDS.slice(0, 1) });
      await runUpdater(pipelineControls({ TICKERS: 'AAA' }));
      expect((await readJson(root, 'funds/AAA/meta.json')).history.totalRows).toBe(3);
      // a 1y window that starts on the second published day, after a dividend: Yahoo rescaled every adjusted close by 0.99
      const good = globalThis.fetch;
      const windowed = mockChart([99.5, 99.99]) as any;
      const result = windowed.chart.result[0];
      result.timestamp = result.timestamp.slice(1);
      result.indicators.quote[0] = { close: [100.5, 101], volume: [20, 30] };
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input).includes('/v8/finance/chart/') ? new Response(JSON.stringify(windowed), { status: 200 }) : good(input, init)) as unknown as typeof fetch;
      await runUpdater(pipelineControls({ TICKERS: 'AAA', HISTORY_RANGE: '1y' }));
      const meta = await readJson(root, 'funds/AAA/meta.json');
      expect(meta.history.totalRows).toBe(3);
      const rows = (await readJson(root, 'funds/AAA/history/001.json')).rows;
      expect([rows[0].Close, rows[0]['Adj Close']]).toEqual(['100', '99']);
      expect(rows.map((row: Record<string, string>) => row['Adj Close'])).toEqual(['99', '99.5', '99.99']);
    });
    // a split rescales the raw closes too, a window without overlap cannot be joined: the caller keeps the published history
    const day = (date: string, close: number) => ({ date, close, adjClose: close, volume: 0 });
    const published = [{ Date: 'Jan 02 2026', Close: '40', 'Adj Close': '40', Volume: '0' }, { Date: 'Jan 05 2026', Close: '42', 'Adj Close': '42', Volume: '0' }];
    const chart = { exchangeName: '', longName: '', navPrice: null, regularMarketPrice: null, regularMarketTime: null, firstTradeDate: null, dividends: [] };
    expect(mergeWindowedChart({ ...chart, days: [day('2026-01-05', 21), day('2026-01-06', 22)] }, published, [])).toBeNull();
    expect(mergeWindowedChart({ ...chart, days: [day('2026-01-07', 42)] }, published, [])).toBeNull();
    // older distributions stay
    const kept = mergeWindowedChart({ ...chart, days: [day('2026-01-05', 42)] }, published, [['01/02/2026', '0.5']]);
    expect<unknown[]>([kept?.days.length, kept?.dividends]).toEqual([2, [{ epoch: Date.UTC(2026, 0, 2) / 1000, amount: 0.5 }]]);
  });

  test('a closed fund is never fetched or reported failed: its files stay as published, its index row says closed, a rerun writes nothing', async () => {
    const entry = { ticker: 'AAA', closed: '2026-10-01', source: 'https://www.sec.gov/Archives/edgar/data/1/notice.htm' };
    expect(() => closedFund([{ ...entry, closed: 'soon' }], 'AAA')).toThrow('CLOSED_FUNDS');
    expect(closedFund([entry], 'aaa')).toEqual(entry);
    quiet();
    await withTempFeed(MOCK_FUNDS.slice(0, 2), async (root) => {
      installMockFetch({ listed: MOCK_FUNDS.slice(0, 2) });
      await runUpdater(pipelineControls({ SKIP_YAHOO: 'true' }));
      const dir = fileURLToPath(root);
      const contents = () => Object.fromEntries(Object.keys(snapshot(dir)).map((path) => [path, readFileSync(path, 'utf8')]));
      const first = contents();
      expect(first[join(dir, 'funds', 'AAA', 'meta.json')]).toBeDefined();
      // the guard would reject these holdings: every Weight cell turns blank
      const good = globalThis.fetch;
      const calls: string[] = [];
      const renamed = { ...HOLDINGS_SAMPLE, holdings: HOLDINGS_SAMPLE.holdings.map(({ percentageOfTotalNetAssets, ...rest }) => ({ ...rest, weightPct: percentageOfTotalNetAssets })) };
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push(String(input));
        return String(input).includes('/holdings/fund') ? new Response(JSON.stringify(renamed), { status: 200 }) : good(input, init);
      }) as unknown as typeof fetch;
      CLOSED_FUNDS.push(entry);
      try {
        await runUpdater(pipelineControls({ SKIP_YAHOO: 'true', TICKERS: 'AAA' }));
        expect(calls.filter((url) => /aaa|46137V350/i.test(url))).toEqual([]);
        expect(process.exitCode).not.toBe(1);
        const closed = contents();
        for (const path of Object.keys(first)) if (!path.endsWith('index.json')) expect([path, closed[path]]).toEqual([path, first[path]]);
        const rows = (await readIndex(root)).funds;
        expect(rows.map((row) => row.ticker)).toEqual(['AAA', 'BBB']);
        expect(rows[0]).toMatchObject({ status: 'closed', closedDate: '2026-10-01', closedSource: entry.source, dataFile: './funds/AAA/meta.json' });
        expect(rows.filter((row) => row.status === 'closed')).toHaveLength(1);
        // a full rerun whose live catalog no longer lists the closed fund keeps its row and writes nothing
        for (const path of Object.keys(closed)) utimesSync(path, 1_000_000_000, 1_000_000_000);
        const aged = snapshot(dir);
        installMockFetch({ listed: MOCK_FUNDS.slice(1, 2) });
        await runUpdater(pipelineControls({ SKIP_YAHOO: 'true' }));
        expect(snapshot(dir)).toEqual(aged);
      } finally {
        CLOSED_FUNDS.splice(CLOSED_FUNDS.indexOf(entry), 1);
      }
    });
  });

  test('a new fund whose holdings fail the guard is reported failed and still gets a catalog-only row; the next run publishes it', async () => {
    const lines: string[] = [];
    console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
    const summaryDir = mkdtempSync(join(tmpdir(), 'invesco-summary-'));
    const [aaa] = MOCK_FUNDS;
    const fresh: MockFund = { ticker: 'NEW', cusip: '46137V398', slug: 'invesco-brand-new-etf' };
    const dark: MockFund = { ticker: 'DRK', cusip: '46137V397', slug: 'invesco-dark-etf' };
    try {
      await withTempFeed([aaa], async (root) => {
        const mock = installMockFetch({ listed: [aaa, fresh, dark] });
        const good = globalThis.fetch;
        const renamed = { ...HOLDINGS_SAMPLE, holdings: HOLDINGS_SAMPLE.holdings.map(({ percentageOfTotalNetAssets, ...rest }) => ({ ...rest, weightPct: percentageOfTotalNetAssets })) };
        // NEW: holdings the guard rejects; DRK: its page is found, every fund API source fails (no throw, no files)
        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          if (url.includes(dark.cusip)) return new Response('', { status: 404 });
          return url.includes(`${fresh.cusip}/holdings/fund`) ? new Response(JSON.stringify(renamed), { status: 200 }) : good(input, init);
        }) as unknown as typeof fetch;
        process.env.GITHUB_STEP_SUMMARY = join(summaryDir, 'summary.md');
        await runUpdater(pipelineControls({ SKIP_YAHOO: 'true' }));
        expect(lines.some((line) => /\] NEW\s+failed\s.*holdings guard/.test(line))).toBe(true);
        expect(lines.some((line) => /\[ done +\] 3 funds: .*1 failed/.test(line))).toBe(true);
        expect(readFileSync(join(summaryDir, 'summary.md'), 'utf8')).toContain('- failed: 1');
        const index = await readIndex(root);
        expect(index.funds.map((fund) => fund.ticker)).toEqual(['AAA', 'DRK', 'NEW']);
        const keys = Object.keys(index.funds[0].metrics);
        for (const ticker of ['NEW', 'DRK']) {
          const row = index.funds.find((fund) => fund.ticker === ticker)!;
          expect([row.dataFile, row.holdings, row.history, row.listed, row.terValue]).toEqual([null, 0, 0, true, 0.19]);
          expect(Object.keys(row.metrics)).toEqual(keys);
          for (const key of keys) if (key !== 'returnsBasis') expect([key, row.metrics[key] === null || row.metrics[key] === '—']).toEqual([key, true]);
          expect(typeof row.metrics.returnsBasis).toBe('string');
          expect(() => statSync(new URL(`funds/${ticker}/`, root))).toThrow();
        }
        // the catalog-only row is not published data: the next run with good holdings publishes the fund in full
        globalThis.fetch = good;
        await runUpdater(pipelineControls({ SKIP_YAHOO: 'true', TICKERS: 'NEW' }));
        const created = (await readIndex(root)).funds.find((fund) => fund.ticker === 'NEW')!;
        expect([created.dataFile, created.holdings]).toEqual(['./funds/NEW/meta.json', 3]);
        expect((await readJson(root, 'funds/NEW/meta.json')).holdings.totalRows).toBe(3);
        expect(mock.requests.some((request) => request.url.includes(`${fresh.cusip}/holdings/fund`))).toBe(true);
      });
    } finally {
      rmSync(summaryDir, { recursive: true, force: true });
    }
  });

  test('funds with only a meta.json stay in the index, new sitemap funds are discovered', async () => {
    quiet();
    const newFund: MockFund = { ticker: 'NEW', cusip: '46137V399', slug: 'invesco-brand-new-etf' };
    installMockFetch({ listed: [...MOCK_FUNDS.slice(0, 1), newFund] });
    await withTempFeed(MOCK_FUNDS.slice(0, 1), async (root) => {
      await runUpdater(pipelineControls({ SKIP_YAHOO: 'true' }));
      const index = await readIndex(root);
      expect(index.funds.map((fund) => fund.ticker)).toEqual(['AAA', 'NEW', 'ZZZ']);
      const created = index.funds.find((fund) => fund.ticker === 'NEW')!;
      expect(created.cusip).toBe('46137V399');
      expect(created.category).toBe('US Equity');
      expect(created.terValue).toBe(0.19);
      expect(created.metrics.returnsBasis).toBe(OFFICIAL_RETURNS_BASIS);
      expect(index.counts.funds).toBe(3);
    }, ['ZZZ']);
  });
});

describe('pipeline 3', () => {
  test('MAX_FETCHES counts only funds that pass the filters; the cursor wraps and is ignored for another filter set', async () => {
    quiet();
    installMockFetch();
    await withTempFeed(MOCK_FUNDS, async (root) => {
      await runUpdater(pipelineControls({ TICKERS: 'FFF', MAX_FETCHES: '1', SKIP_YAHOO: 'true' }));
      const index = await readIndex(root);
      expect(index.funds.length).toBe(6);
      expect(index.funds.find((fund) => fund.ticker === 'FFF')!.metrics.ytd).toBe(15.44);
      expect(index.funds.find((fund) => fund.ticker === 'AAA')!.metrics.ytd).toBe(1.5);
      // a TICKERS run never reads, writes or deletes the cursor
      expect(() => readFileSync(new URL('update-state.json', root))).toThrow();
      const seen: string[] = [];
      for (let run = 0; run < 4; run++) {
        await runUpdater(pipelineControls({ MAX_FETCHES: '2', SKIP_YAHOO: 'true' }));
        seen.push((await readJson(root, 'update-state.json')).cursor);
      }
      expect(seen).toEqual(['BBB', 'DDD', 'FFF', 'BBB']);
      const stateBefore = readFileSync(new URL('update-state.json', root), 'utf8');
      await runUpdater(pipelineControls({ MAX_FETCHES: '1', TICKERS: 'CCC', SKIP_YAHOO: 'true' }));
      expect(readFileSync(new URL('update-state.json', root), 'utf8')).toBe(stateBefore);
    });
  });

  test('a second identical run writes nothing and leaves no temporary files', async () => {
    quiet();
    installMockFetch();
    await withTempFeed(MOCK_FUNDS.slice(0, 2), async (root) => {
      await runUpdater(pipelineControls());
      const dir = fileURLToPath(root);
      // an older run timestamp must not count as a change, and aged mtimes make any rewrite visible without waiting on the clock
      for (const path of Object.keys(snapshot(dir))) {
        if (path.endsWith('.json')) writeFileSync(path, readFileSync(path, 'utf8').replace(/"(generatedAt|savedAt)": "[^"]+"/g, '"$1": "2000-01-01T00:00:00Z"'));
        utimesSync(path, 1_000_000_000, 1_000_000_000);
      }
      const first = snapshot(dir);
      await runUpdater(pipelineControls());
      expect(snapshot(dir)).toEqual(first);
      expect(Object.keys(first).some((path) => path.endsWith('.tmp'))).toBe(false);
    });
  });

  test('two runs on the same source data write zero changes even when Yahoo adjusted closes jitter across a cent boundary', async () => {
    quiet();
    await withTempFeed(MOCK_FUNDS.slice(0, 1), async (root) => {
      const dir = fileURLToPath(root);
      const historyPage = () => JSON.parse(readFileSync(join(dir, 'funds', 'AAA', 'history', '001.json'), 'utf8')).rows.map((row: Record<string, string>) => row['Adj Close']);
      // Yahoo float32 noise seen live: BAB came back as 16.41 and 16.42 on two runs with the same data
      installMockFetch({ adjclose: [99.915001, 100.484999, 100.995001] });
      await runUpdater(pipelineControls());
      expect(historyPage()).toEqual(['99.92', '100.48', '101']);
      for (const path of Object.keys(snapshot(dir))) {
        if (path.endsWith('.json')) writeFileSync(path, readFileSync(path, 'utf8').replace(/"(generatedAt|savedAt)": "[^"]+"/g, '"$1": "2000-01-01T00:00:00Z"'));
        utimesSync(path, 1_000_000_000, 1_000_000_000);
      }
      const first = snapshot(dir);
      installMockFetch({ adjclose: [99.914998, 100.485002, 100.994999] });
      await runUpdater(pipelineControls());
      expect(snapshot(dir)).toEqual(first);
      // a real change beyond the noise is still written
      installMockFetch({ adjclose: [99.9, 100.47, 100.98] });
      await runUpdater(pipelineControls());
      expect(historyPage()).toEqual(['99.9', '100.47', '100.98']);
    });
  });

  test('the soft deadline stops taking funds, still writes the full index and the next run resumes', async () => {
    quiet();
    installMockFetch({ delayMs: 25 });
    await withTempFeed(MOCK_FUNDS, async (root) => {
      configureFetchForTests({ deadlineMs: 120 });
      await runUpdater(pipelineControls({ SKIP_YAHOO: 'true' }));
      expect((await readIndex(root)).funds.length).toBe(6);
      const state = await readJson(root, 'update-state.json');
      expect(state.partial).toBe(true);
      expect(state.cursor).not.toBeNull();
      expect(state.cursor).not.toBe('FFF');
      configureFetchForTests({ deadlineMs: 25 * 60_000 });
      await runUpdater(pipelineControls({ SKIP_YAHOO: 'true' }));
      const done = await readJson(root, 'update-state.json');
      expect(done.partial).toBe(false);
      expect(done.cursor).toBeNull();
    });
  });

  test('a kept fund keeps the dates, distribution rows and source label of its own meta.json; a fund under one year old gets no siAnn', async () => {
    quiet();
    const [aaa, bbb] = MOCK_FUNDS;
    installMockFetch();
    const base = globalThis.fetch;
    const failing: RegExp[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (failing.some((pattern) => pattern.test(url))) return new Response('', { status: 404 });
      if (url.includes('/v8/finance/chart/')) {
        const chart = mockChart() as { chart: { result: Array<Record<string, unknown>> } };
        chart.chart.result[0].events = { dividends: { a: { amount: 0.25, date: 1_782_000_000 }, b: { amount: 0.3, date: 1_789_900_000 } } };
        return new Response(JSON.stringify(chart), { status: 200 });
      }
      const response = await base(input, init);
      // BBB launched 2026-03-18, so its official since-inception figure as of 2026-08-31 is cumulative
      if (url !== `${MOCK_PAGE_BASE}${bbb.slug}.html`) return response;
      return new Response((await response.text()).replace('2003-04-24', '2026-03-18'), { status: 200 });
    }) as unknown as typeof fetch;
    await withTempFeed([aaa, bbb], async (root) => {
      await runUpdater(pipelineControls());
      const first = await readJson(root, 'funds/AAA/meta.json');
      expect([first.holdings.asOfDate, first.aum.asOfDate, first.distributions.rows.length]).toEqual(['2026-09-30', 'Oct 01 2026', 2]);
      const [aaaRow, bbbRow] = (await readIndex(root)).funds;
      // same feed, same table: the fund from 2003 keeps its annualized 11.39, the five-month-old one publishes none
      expect([aaaRow.metrics.siAnn, bbbRow.metrics.siAnn, bbbRow.returns.monthEnd.sinceInception]).toEqual([11.39, null, null]);
      expect(bbbRow.metrics.ytd).toBe(15.44);
      // AAA's sheet came from an N-PORT filing; this run its holdings, prices and Yahoo requests fail
      const nport = 'SEC EDGAR Form N-PORT-P (accession 0001378872-26-000613, report period 2026-09-30)';
      writeFileSync(new URL('funds/AAA/meta.json', root), JSON.stringify({ ...first, holdings: { ...first.holdings, source: nport } }));
      failing.push(/\/holdings\/fund/, /\/prices\?/, /\/v8\/finance\/chart\//);
      await runUpdater(pipelineControls({ TICKERS: 'AAA' }));
      const kept = await readJson(root, 'funds/AAA/meta.json');
      // the index row has counts under these keys (holdings: 3, history: 3) and no rows: nothing is read from it
      expect([kept.holdings.asOfDate, kept.holdings.source, kept.source.holdingsSource, kept.holdings.totalRows]).toEqual(['2026-09-30', nport, nport, 3]);
      expect([kept.history.asOf, kept.history.totalRows]).toEqual([first.history.asOf, 3]);
      expect(kept.history.asOf).not.toBe('—');
      expect(kept.aum.asOfDate).toBe('Oct 01 2026');
      expect(kept.distributions.rows).toEqual(first.distributions.rows);
    });
  });
});


describe('pipeline 4', () => {
  test('a HISTORY_RANGE run after a full run keeps the older history and writes nothing (Q25)', async () => {
    quiet();
    await withTempFeed(MOCK_FUNDS.slice(0, 1), async (root) => {
      installMockFetch({ listed: MOCK_FUNDS.slice(0, 1) });
      await runUpdater(pipelineControls());
      const dir = fileURLToPath(root);
      for (const path of Object.keys(snapshot(dir))) {
        if (path.endsWith('.json')) writeFileSync(path, readFileSync(path, 'utf8').replace(/"(generatedAt|savedAt)": "[^"]+"/g, '"$1": "2000-01-01T00:00:00Z"'));
        utimesSync(path, 1_000_000_000, 1_000_000_000);
      }
      const first = snapshot(dir);
      // the 1y window has the last two of the three published days, with the same closes
      const good = globalThis.fetch;
      const windowed = mockChart() as any;
      const result = windowed.chart.result[0];
      result.timestamp = result.timestamp.slice(1);
      result.indicators.quote[0] = { close: [100.5, 101], volume: [20, 30] };
      result.indicators.adjclose[0] = { adjclose: [100.5, 101] };
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input).includes('/v8/finance/chart/') ? new Response(JSON.stringify(windowed), { status: 200 }) : good(input, init)) as unknown as typeof fetch;
      await runUpdater(pipelineControls({ HISTORY_RANGE: '1y' }));
      expect(snapshot(dir)).toEqual(first);
      expect((await readJson(root, 'funds/AAA/meta.json')).history.totalRows).toBe(3);
    });
  });

  test('a relaxed guard still keeps numeric published weights from an all-blank sheet (Q24)', async () => {
    quiet();
    await withTempFeed(MOCK_FUNDS.slice(0, 1), async (root) => {
      installMockFetch({ listed: MOCK_FUNDS.slice(0, 1) });
      await runUpdater(pipelineControls({ SKIP_YAHOO: 'true' }));
      const dir = fileURLToPath(root);
      const contents = () => Object.fromEntries(Object.keys(snapshot(dir)).map((path) => [path, readFileSync(path, 'utf8')]));
      const first = contents();
      const good = globalThis.fetch;
      const blank = { ...HOLDINGS_SAMPLE, holdings: HOLDINGS_SAMPLE.holdings.map((item) => ({ ...item, percentageOfTotalNetAssets: null })) };
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input).includes('/holdings/fund') ? new Response(JSON.stringify(blank), { status: 200 }) : good(input, init)) as unknown as typeof fetch;
      HOLDINGS_GUARD_RELAX.AAA = ['numeric', 'sum'];
      try {
        await expect(runUpdater(pipelineControls({ SKIP_YAHOO: 'true', TICKERS: 'AAA' }))).rejects.toThrow(/every examined fund failed/);
      } finally {
        delete HOLDINGS_GUARD_RELAX.AAA;
      }
      expect(contents()).toEqual(first);
      expect(holdingsWeightCount(['Name', 'Weight'], [['A', '-'], ['B', '2']])).toBe(1);
    });
  });

  test('TICKERS outside the sitemap and the published feed stops the run before any fund request; a stale catalog-only row is dropped (Q27)', async () => {
    quiet();
    const [aaa] = MOCK_FUNDS;
    const mock = installMockFetch({ listed: [aaa] });
    await withTempFeed([aaa], async (root) => {
      const stale = { ...seedIndexRow({ ticker: 'NOPE', cusip: '46137V390', slug: 'invesco-nope-etf' }), dataFile: null, holdings: 0, history: 0 };
      writeFileSync(new URL('index.json', root), JSON.stringify({ funds: [seedIndexRow(aaa), stale] }));
      const dir = fileURLToPath(root);
      const before = snapshot(dir);
      await expect(runUpdater(pipelineControls({ TICKERS: 'NOPE' }))).rejects.toThrow('TICKERS: NOPE not in the Invesco catalog (invesco.com sitemap) or published feed; nothing was fetched or written');
      expect(mock.requests.map((request) => request.url).filter((url) => !url.endsWith('/us/en/sitemap.xml'))).toEqual([]);
      expect(snapshot(dir)).toEqual(before);
      await runUpdater(pipelineControls({ SKIP_YAHOO: 'true' }));
      expect((await readIndex(root)).funds.map((fund) => fund.ticker)).toEqual(['AAA']);
    });
  });

  test('NEW FUNDS announces a fund on its first successful publish, a failed new fund as not published yet (Q28)', async () => {
    const lines: string[] = [];
    console.log = (...args: unknown[]) => { const line = args.map(String).join(' '); if (/^NEW FUNDS/.test(line)) lines.push(line); };
    const summaryDir = mkdtempSync(join(tmpdir(), 'invesco-summary-'));
    const [aaa] = MOCK_FUNDS;
    const fresh: MockFund = { ticker: 'NEW', cusip: '46137V398', slug: 'invesco-brand-new-etf' };
    const dark: MockFund = { ticker: 'DRK', cusip: '46137V397', slug: 'invesco-dark-etf' };
    try {
      await withTempFeed([aaa], async (root) => {
        installMockFetch({ listed: [aaa, fresh, dark] });
        const good = globalThis.fetch;
        // NEW is a catalog-only row of an earlier run whose first read failed; DRK is new and every fund API source fails for it
        writeFileSync(new URL('index.json', root), JSON.stringify({ funds: [seedIndexRow(aaa), { ...seedIndexRow(fresh), dataFile: null, holdings: 0, history: 0 }] }));
        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => (String(input).includes(dark.cusip) ? new Response('', { status: 404 }) : good(input, init))) as unknown as typeof fetch;
        process.env.GITHUB_STEP_SUMMARY = join(summaryDir, 'summary.md');
        await runUpdater(pipelineControls({ SKIP_YAHOO: 'true' }));
        expect(lines).toEqual(['NEW FUNDS: NEW', 'NEW FUNDS (not published yet): DRK']);
        expect(readFileSync(join(summaryDir, 'summary.md'), 'utf8')).toContain('- NEW FUNDS: NEW\n- NEW FUNDS (not published yet): DRK\n');
        lines.length = 0;
        await runUpdater(pipelineControls({ SKIP_YAHOO: 'true' }));
        expect(lines).toEqual([]);
        globalThis.fetch = good;
        await runUpdater(pipelineControls({ SKIP_YAHOO: 'true' }));
        expect(lines).toEqual(['NEW FUNDS: DRK']);
      });
    } finally {
      rmSync(summaryDir, { recursive: true, force: true });
    }
  });
});


// ---------------------------------------------------------------------------
// network: timeouts, bounded retries, real concurrency, HISTORY_RANGE URL, TLS trust
// ---------------------------------------------------------------------------

describe('network', () => {
  test('a hanging request times out, is retried a bounded number of times, then fails', async () => {
    configureFetchForTests({ timeoutMs: 30, sleepMs: 0, lanes: 1 });
    let calls = 0;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      calls += 1;
      const signal = init?.signal;
      if (!signal) { await new Promise((resolve) => setTimeout(resolve, 150)); return new Response('late', { status: 200 }); }
      return new Promise<Response>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
    }) as unknown as typeof fetch;
    await expect(fetchWithRetry('https://example.test/x', 't', {}, 1)).rejects.toThrow(/network error/);
    expect(calls).toBe(2);
  });

  test('the timeout also covers the body: a stalled body is aborted and retried, the run does not hang', async () => {
    quiet();
    configureFetchForTests({ timeoutMs: 40 });
    const attempts: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      attempts.push(String(input));
      const signal = init?.signal;
      if (!signal) return new Response('late', { status: 200 });
      const body = new ReadableStream({ start: (controller) => { signal.addEventListener('abort', () => controller.error(new Error('body aborted'))); } });
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;
    await withTempFeed(MOCK_FUNDS.slice(0, 1), async () => {
      await expect(runUpdater(pipelineControls({ SKIP_YAHOO: 'true', MAX_RETRIES: '1' }))).rejects.toThrow(/every examined fund failed/);
    });
    const sitemap = attempts.filter((url) => url.endsWith('/sitemap.xml'));
    expect(sitemap.length).toBe(2);
  });

  test('pacing reserves a lane slot synchronously: 4 simultaneous requests on 2 lanes start 2 now and 2 later', async () => {
    configureFetchForTests({ sleepMs: 1000, lanes: 2 });
    let started = 0;
    const all = Promise.all([0, 1, 2, 3].map(async () => { await paceRequests(); started += 1; }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(started).toBe(2);
    await all;
    expect(started).toBe(4);
  });

  test('CONCURRENCY really runs funds in parallel: peak in-flight 1 at c=1, N at c=N', async () => {
    quiet();
    for (const [concurrency, expected] of [[1, 1], [3, 3]] as const) {
      const mock = installMockFetch({ delayMs: 15 });
      await withTempFeed(MOCK_FUNDS, async () => {
        await runUpdater(pipelineControls({ CONCURRENCY: String(concurrency), SKIP_YAHOO: 'true' }));
      });
      expect(mock.peak()).toBe(expected);
    }
  });
});

describe('network 2', () => {
  test('HISTORY_RANGE shrinks the Yahoo request through explicit period1/period2', () => {
    const now = 1_790_000_000_000;
    const max = new URL(chartUrl('AAA', { historyRange: 'max' }, now));
    expect(max.searchParams.get('period1')).toBe('0');
    expect(max.searchParams.get('period2')).toBe('1790000000');
    const five = new URL(chartUrl('AAA', { historyRange: '5y' }, now));
    expect(Number(five.searchParams.get('period1'))).toBe(Math.floor(1_790_000_000 - 5 * 365.25 * 86_400));
    expect(five.searchParams.get('period2')).toBe('1790000000');
    expect(five.searchParams.has('range')).toBe(false);
  });

  test('USE_SYSTEM_CA: certificate errors are detected, mode false or an active store leave fetch alone, true restarts at once', () => {
    const certError = () => Object.assign(new Error('unable to get local issuer certificate'), { code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' });
    expect(isCertError({ code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' })).toBe(true);
    expect(isCertError(new Error('unable to get local issuer certificate'))).toBe(true);
    expect(isCertError(new Error('fetch failed', { cause: certError() }))).toBe(true);
    expect(isCertError({ code: 'ECONNRESET', message: 'socket hang up' })).toBe(false);
    expect(isCertError(new Error('HTTP 403 Forbidden'))).toBe(false);
    let restarts = 0;
    const reexec = (() => { restarts += 1; return undefined as never; }) as () => never;
    installSystemCa('false', reexec, false);
    installSystemCa('auto', reexec, true);
    installSystemCa('true', reexec, true);
    expect(globalThis.fetch).toBe(realFetch);
    expect(restarts).toBe(0);
    installSystemCa('true', reexec, false);
    expect(restarts).toBe(1);
  });

  test('USE_SYSTEM_CA=auto wraps fetch: a certificate error restarts once, other errors rethrow, success passes through', async () => {
    console.error = () => {};
    let restarts = 0;
    const reexec = (() => { restarts += 1; return undefined as never; }) as () => never;
    globalThis.fetch = (async () => new Response('ok')) as unknown as unknown as typeof fetch;
    installSystemCa('auto', reexec, false);
    expect(await (await fetch('https://example.test')).text()).toBe('ok');
    globalThis.fetch = (async () => { throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }); }) as unknown as unknown as typeof fetch;
    installSystemCa('auto', reexec, false);
    await expect(fetch('https://example.test')).rejects.toThrow('socket hang up');
    expect(restarts).toBe(0);
    globalThis.fetch = (async () => { throw Object.assign(new Error('unable to get local issuer certificate'), { code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' }); }) as unknown as unknown as typeof fetch;
    installSystemCa('auto', reexec, false);
    await fetch('https://example.test');
    expect(restarts).toBe(1);
  });
});
