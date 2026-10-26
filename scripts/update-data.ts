#!/usr/bin/env bun
// Bun provides Node-compatible fs/promises and process globals for this script.
/// <reference types="bun" />
import { readFile as outputReadFile, readdir as outputReadDir } from 'node:fs/promises';
import { createHash as outputCreateHash } from 'node:crypto';
import { join as outputJoin } from 'node:path';
import { fileURLToPath as outputFileURLToPath } from 'node:url';

// Console presentation; no changes to provider requests or persisted data.
/** Presentation only: no requests, writes, filtering, or changes to updater state. */

const outputClean = (value: unknown): string => String(value ?? 'null').replace(/[\r\n\t]+/g, ' ');
/** Presentation only: per-fund retry and fallback notices are printed when VERBOSE is enabled. */
const outputVerbose = (): boolean => /^(1|true|yes|on)$/i.test((globalThis as any).process?.env?.VERBOSE ?? '');
function outputNote(message: string): void { if (outputVerbose()) console.warn(message); }
/** Names are the canonical environment knobs, not internal parser properties. */
function outputConfigEntries(config: Record<string, any>): [string, string][] {
  const values = new Map<string, string>();
  const aliases: Record<string, string> = {
    requestSleepSeconds: 'REQUEST_SLEEP', categories: 'CATEGORY',
    aumRange: 'AUM', terRange: 'TER', dividendYieldRange: 'DIVIDEND_YIELD', secYieldRange: 'SEC_YIELD',
    performanceRanges: 'PERFORMANCE', totalReturnRanges: 'TOTAL_RETURN',
    skipVanEck: 'SKIP_VANECK', skipProShares: 'SKIP_PROSHARES',
    skipWisdomTree: 'SKIP_WISDOMTREE', skipGoldmanSachs: 'SKIP_GOLDMANSACHS',
    skipGlobalX: 'SKIP_GLOBALX', skipNorthernTrust: 'SKIP_NORTHERNTRUST',
  };
  const range = (v: any): string => typeof v === 'string' ? v : v?.source ?? `${Number.isFinite(v?.min) ? v.min : ''}:${Number.isFinite(v?.max) ? v.max : ''}`;
  for (const [key, value] of Object.entries(config)) {
    if (['proxyGapMs', 'fetchTimeoutMs', 'retryDelayMs'].includes(key)) continue;
    const name = aliases[key] ?? (/^[A-Z0-9_]+$/.test(key) ? key : key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase());
    if (name === 'PERFORMANCE' || name === 'TOTAL_RETURN') {
      for (const period of ['YTD', '1Y', '3Y', '5Y', '10Y']) values.set(`${name}_${period}`, range(value?.[period]));
    } else if (['AUM', 'TER', 'DIVIDEND_YIELD', 'SEC_YIELD'].includes(name)) {
      values.set(name, range(value));
    } else {
      values.set(name, value instanceof Set ? [...value].join(',') || 'all' : Array.isArray(value) ? value.join(',') || 'all' : outputClean(value));
    }
  }
  const first = ['MAX_FETCHES', 'REQUEST_SLEEP', 'CONCURRENCY'];
  return [...values].sort(([a], [b]) => {
    const ai = first.indexOf(a), bi = first.indexOf(b);
    return (ai < 0 ? first.length : ai) - (bi < 0 ? first.length : bi) || a.localeCompare(b);
  });
}
function outputConfigValue(key: string, value: string): string {
  if (/TOKEN|PASSWORD|SECRET|COOKIE|SEC_UA/i.test(key)) return '<redacted>';
  if (key === 'TICKERS' && ['', 'null', 'undefined'].includes(value)) return 'all';
  return outputClean(value);
}
function outputPrintConfig(brand: string, config: Record<string, any>): void {
  const entries: [string, string][] = [...outputConfigEntries(config), ['VERBOSE', String(outputVerbose())]];
  console.log(`[ config   ] ${brand} updater:\n${entries.map(([key, value]) => `              ${key}=${outputConfigValue(key, value)}`).join('\n')}`);
}
function outputHasOutputFilters(config: Record<string, any>): boolean {
  return outputConfigEntries(config).some(([name, value]) =>
    /^(CATEGORY|AUM|TER|DIVIDEND_YIELD|SEC_YIELD|PERFORMANCE_|TOTAL_RETURN_)/.test(name) &&
    !['', ':', 'null', 'all'].includes(value));
}
function outputPrintFilter(selected: number, total: number, deferred = false): void {
  console.log(`[ filter   ] ${selected} of ${total} funds ${deferred ? 'selected for evaluation (data-dependent filters applied per fund)' : 'pass filters'}`);
}
function outputStable(value: any): any {
  if (Array.isArray(value)) return value.map(outputStable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => !['generatedAt', 'catalogReadAt'].includes(key)).map(key => [key, outputStable(value[key])]));
  return value;
}
function outputContentKey(value: unknown): string { return JSON.stringify(outputStable(value)) ?? 'null'; }
async function outputInspectFund(root: URL | string, ticker: string): Promise<{ digest: string; meta: any }> {
  const dir = outputJoin(root instanceof URL ? outputFileURLToPath(root) : root, 'funds', ticker);
  const hash = outputCreateHash('sha256');
  async function visit(path: string): Promise<void> {
    const entries = await outputReadDir(path, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) await visit(outputJoin(path, entry.name));
      else if (entry.name.endsWith('.json')) {
        const text = await outputReadFile(outputJoin(path, entry.name), 'utf8').catch(() => '');
        hash.update(outputJoin(path.slice(dir.length), entry.name));
        try { hash.update(outputContentKey(JSON.parse(text))); } catch { hash.update(text); }
      }
    }
  }
  await visit(dir);
  const meta = await outputReadFile(outputJoin(dir, 'meta.json'), 'utf8').then(JSON.parse).catch(() => ({}));
  return { digest: hash.digest('hex'), meta };
}
const outputCount = (value: any): unknown => typeof value === 'number' ? value : Array.isArray(value) ? value.length : value?.totalRows ?? value?.rows?.length ?? null;
const outputScalar = (value: any): any => value && typeof value === 'object' ? value.display ?? value.value ?? null : value;
const outputUnits: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12, THOUSAND: 1e3, MILLION: 1e6, BILLION: 1e9, TRILLION: 1e12 };
function outputMoney(value: any): string {
  const raw = value && typeof value === 'object' && typeof value.value === 'number' && Number.isFinite(value.value) ? value.value : outputScalar(value);
  if (raw === null || raw === undefined || raw === '—' || raw === '--') return 'null';
  const text = String(raw).replace(/[$,\s]/g, '');
  const match = text.match(/^([+-]?[\d.]+)(K|M|B|T|Thousand|Million|Billion|Trillion)?$/i);
  if (!match) return outputClean(raw);
  const number = Number(match[1]) * (outputUnits[match[2]?.toUpperCase() ?? ''] ?? 1);
  if (!Number.isFinite(number)) return 'null';
  for (const [unit, scale] of [['T', 1e12], ['B', 1e9], ['M', 1e6], ['K', 1e3]] as const) {
    if (Math.abs(number) >= scale) return `$${(number / scale).toFixed(1)}${unit}`;
  }
  return `$${number.toFixed(2)}`;
}
/** Yields: rounded to 2 decimals without trailing zeros; placeholders are omitted like null. */
function outputPercent(value: any): unknown {
  const raw = outputScalar(value);
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? Number(raw.toFixed(2)) : null;
  const text = String(raw).trim().replace(/%$/, '').trim();
  if (['', '-', '—', '--', 'n/a'].includes(text.toLowerCase())) return null;
  const number = Number(text.replace(/,/g, ''));
  return Number.isFinite(number) ? Number(number.toFixed(2)) : outputClean(raw);
}
function outputFundLine(index: number, total: number, ticker: string, status: string, data: any = {}, reason?: unknown): string {
  const width = Math.max(2, String(total).length);
  const metrics = data.metrics ?? {};
  // Presentation only. Keep valid zero/false values; omit unavailable fields.
  // outputMoney returns the string 'null' for an unavailable monetary value.
  const field = (key: string, value: unknown): string =>
    value === null || value === undefined || value === 'null' ? '' : `${key}=${outputClean(value)}`;
  const sources = [
    field('official', data.officialHistoryCount),
    field('yahoo', data.yahooHistoryCount),
  ].filter(part => part !== '').join(' ');
  const detail = [
    field('port', data.portId ?? data.portfolioId),
    field('history', outputCount(data.history ?? data.historyCount)),
    sources ? `(${sources})` : '',
    field('holdings', outputCount(data.holdings ?? data.holdingsCount)),
    field('divs', outputCount(data.worksheets?.Distributions ?? data.distributions)),
    field('netAssets', outputMoney(data.netAssets ?? data.aum)),
    field('total', outputMoney(data.totalFundNetAssets ?? data.totalNetAssets)),
    field('div', outputPercent(data.trailingYield ?? data.yields?.effectiveYield ?? data.yields?.dividendYield ?? data.dividendYield ?? metrics.dividendYield)),
    field('sec', outputPercent(data.secYield ?? data.yields?.secYield ?? metrics.secYield)),
    field('wp', data.workplaceRaw),
  ].filter(part => part !== '').join(' ');
  return `[ ${String(index).padStart(width)}/${String(total).padEnd(width)}  ] ${outputClean(ticker).padEnd(5)} ${status.padEnd(9)}${detail ? ` ${detail}` : ''}${reason ? ` reason=${outputClean(reason)}` : ''}`;
}
function outputCreateReporter(root: URL | string, total: number) {
  let completed = 0;
  const tally = new Map<string, number>();
  return {
    before: (ticker: string) => outputInspectFund(root, ticker),
    async result(ticker: string, before: { digest: string }, status?: string, reason?: unknown, extra: any = {}) {
      const after = await outputInspectFund(root, ticker);
      const final = status ?? (before.digest === after.digest ? 'unchanged' : 'updated');
      tally.set(final, (tally.get(final) ?? 0) + 1);
      console.log(outputFundLine(++completed, total, ticker, final, { ...after.meta, ...extra }, reason));
    },
    /** First [ done ] line: the statuses of every fund line this reporter printed. */
    summary(startedAt: number): string {
      const order = ['updated', 'unchanged', 'kept', 'skipped', 'failed'];
      const statuses = [...order, ...[...tally.keys()].filter(status => !order.includes(status))];
      return `[ done     ] ${completed} fund${completed === 1 ? '' : 's'}: ${statuses.map(status => `${tally.get(status) ?? 0} ${status}`).join(', ')} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
    },
  };
}
/** Second [ done ] line: published totals. */
function outputCounts(funds: number, holdings: number, history: number): string {
  return `[ done     ] counts: ${funds.toLocaleString('en-US')} funds / ${holdings.toLocaleString('en-US')} holdings rows / ${history.toLocaleString('en-US')} history rows`;
}


// Invesco Ltd. (US ETFs) static data updater.
//
// Fetches the invesco.com fund pages and the JSON API behind them (month-end
// NAV returns, NAV, net assets, yields, full daily holdings) plus the Yahoo
// Finance public chart feed (adjusted close / volume + dividend history), then
// writes a deterministic, paginated static JSON API under ./api/invesco - the
// same design as the daggerok/SPDR, daggerok/Fidelity and daggerok/iShares
// updaters (zero dependencies, Bun only: node:fs/promises + fetch).
//
// Official issuer data wins whenever it exists for a fund; Yahoo is used only
// for what invesco.com does not publish (daily market closes, dividends,
// exchange listing, live quote) and to fill return periods Invesco does not
// publish yet (young funds).
//
// Data sources (verified live on 2026-10-02; the legacy CSV downloads are gone)
//   - fund list              : invesco.com sitemap.xml (every live fund page)
//                              plus every fund already published
//   - fund facts, expense    : the fund page (CUSIP, ISIN, index, total and net
//     ratio                    expense ratio are embedded as page JSON)
//   - returns, NAV, net      : dng-api.invesco.com fund API, addressed by CUSIP
//     assets, yields           (month-end performance, prices, yieldInformation)
//   - per-fund daily holdings: dng-api.invesco.com holdings/fund (all positions)
//   - market history,
//     distributions, quote   : Yahoo Finance public chart API
//   - holdings fallback      : SEC EDGAR Form N-PORT-P filings of the Invesco
//                              ETF registrant (funds invesco.com no longer lists)
// invesco.com answers HTTP 406 to browser-like User-Agents, so every invesco.com
// request carries a non-browser User-Agent.
//
// Usage: bun ./scripts/update-data.ts   (or ./scripts/update-data.ts --help)

import { mkdir, readFile, writeFile, readdir, rm, appendFile, rename } from 'node:fs/promises';

// ---------------------------------------------------------------------------
// Constants and small helpers
// ---------------------------------------------------------------------------

type JsonRecord = Record<string, any>;

const INVESCO_SITE = 'https://www.invesco.com';
const LEGACY_BASE = `${INVESCO_SITE}/us/financial-products/etfs`;
const INVESCO_SITEMAP_URL = `${INVESCO_SITE}/us/en/sitemap.xml`;
const INVESCO_CATALOG_PAGE = `${INVESCO_SITE}/us/en/financial-products/etfs.html`;
const DNG_API = 'https://dng-api.invesco.com/cache/v1/accounts/en_US/shareclasses';

// The generic ?ticker= route: invesco.com redirects it to the canonical fund
// page (or, for a renamed fund, to the page of the new ticker).
export function invescoProductDetailUrl(ticker: string, audience = 'Investor'): string {
  return `${LEGACY_BASE}/product-detail?audienceType=${encodeURIComponent(audience)}&ticker=${encodeURIComponent(String(ticker).toUpperCase())}`;
}

const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';
const YAHOO_SEARCH_URL = 'https://query1.finance.yahoo.com/v1/finance/search';
const INVESCO_UA = 'daggerok-etf-feed/1.0 (+https://github.com/daggerok/Invesco)';
const YAHOO_BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const SEC_EFTS_HOST = 'https://efts.sec.gov/LATEST';
// Official SEC lookup tables (public, no key): ETF/mutual-fund ticker ->
// registrant CIK + series/class id, and operating-company ticker -> name.
const SEC_FUND_TICKERS_URL = 'https://www.sec.gov/files/company_tickers_mf.json';
const SEC_COMPANY_TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
const SEC_UA_DEFAULT = 'daggerok ETF feed daggerok@gmail.com';

let API_ROOT = new URL('../api/invesco/', import.meta.url);
let INDEX_FILE = new URL('index.json', API_ROOT);
let STATE_FILE = new URL('update-state.json', API_ROOT);

/** Tests point the writers at a temporary directory instead of ./api/invesco. */
export function setApiRootForTests(root: URL): void {
  API_ROOT = root;
  INDEX_FILE = new URL('index.json', root);
  STATE_FILE = new URL('update-state.json', root);
}

const HOLDINGS_PAGE_SIZE_FALLBACK = 250;
const HISTORY_PAGE_SIZE_FALLBACK = 1000;
const CONCURRENCY_FALLBACK = 2;
const REQUEST_SLEEP_FALLBACK = 1;
const MAX_RETRIES_FALLBACK = 2;


// The three Invesco ETF share classes below are excluded from the feed:
// Invesco Ltd. (IVZ) is the listed asset manager, not a fund, and the two
// legacy CurrencyShares trusts are no longer offered to new investors.
const EXCLUDED_FUND_NAMES = [/^Invesco Ltd\.?$/i];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad3(value: number): string {
  return String(value).padStart(3, '0');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeTicker(raw: unknown): string {
  return String(raw ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function cleanText(raw: unknown): string {
  return String(raw ?? '')
    .replace(/\u00ae/g, '') // ®
    .replace(/\u2122/g, '') // ™
    .replace(/&#174;|&reg;/gi, '')
    .replace(/&#8482;|&trade;/gi, '')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// "2.97057744E8" -> "297057744"; keeps non-numeric text untouched (same as SPDR).
export function normalizeNumberText(raw: unknown): string {
  const text = String(raw ?? '').trim();
  if (text === '' || text === '-') return text;
  if (!/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(text.replace(/,/g, ''))) return text;
  const number = Number(text.replace(/,/g, ''));
  if (!Number.isFinite(number) || Math.abs(number) >= 1e21) return text;
  return number.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 10 });
}

export function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text === '' || text === '—' || text === '-' || text === '--' || /^n\/?a$/i.test(text)) return null;
  // Percent first, then plain numbers: "0.40%" -> 0.4, "$1,234.56" -> 1234.56.
  const parsed = Number(text.replace(/[$,\s]/g, '').replace(/%$/i, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// "2026-06-30" -> "Jun 30 2026" (the display style shared with the sibling apps).
export function formatEdgarDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!match) return String(iso || '');
  const [, year, month, day] = match;
  return `${MONTHS[Number(month) - 1] ?? month} ${day} ${year}`;
}

export function epochToIsoDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

export function formatEpochDate(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000);
  return `${MONTHS[date.getUTCMonth()]} ${String(date.getUTCDate()).padStart(2, '0')} ${date.getUTCFullYear()}`;
}

export function formatUsDate(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000);
  return `${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')}/${date.getUTCFullYear()}`;
}

// "08/21/2026" / "2026-08-21T00:00:00Z" / "Aug 21 2026" -> "2026-08-21" as plain calendar text, never through the local
// time zone (shared calendar-dates block); anything else passes through untouched so an unexpected source format never
// silently corrupts a date column.
export function toIsoDate(raw: unknown): string {
  const text = String(raw ?? '').trim();
  return calendarIso(text) ?? text;
}

// "2026-08-21" -> "08/21/2026" (how invesco.com renders dates in its CSVs).
export function formatInvescoDate(raw: unknown): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(toIsoDate(raw));
  if (!match) return String(raw ?? '');
  return `${match[2]}/${match[3]}/${match[1]}`;
}

/** One spelling per venue: the page, Yahoo and older rows use several for the same exchange. */
export function normalizeExchange(raw: unknown): string {
  const text = cleanText(raw);
  if (/^nyse\s*arca$/i.test(text)) return 'NYSE Arca';
  if (/^nasdaq/i.test(text)) return 'Nasdaq';
  if (/^cboe/i.test(text)) return 'Cboe BZX';
  return text;
}

export function formatAumDisplay(value: number): string {
  return `$${(value / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} M`;
}

// ---------------------------------------------------------------------------
// Updater configuration (environment variables, iShares/SPDR/Fidelity-style)
// ---------------------------------------------------------------------------

type Range = { min?: number; max?: number };
type ReturnPeriod = 'YTD' | '1Y' | '3Y' | '5Y' | '10Y';
const RETURN_PERIODS: readonly ReturnPeriod[] = ['YTD', '1Y', '3Y', '5Y', '10Y'];
type RangeMap = Partial<Record<ReturnPeriod, Range>>;

type UpdaterConfig = {
  concurrency: number;
  requestSleep: number;
  maxFetches: number;
  holdingsPageSize: number;
  historyPageSize: number;
  maxRetries: number;
  tickers: string[];
  historyRange: string;
  sitemapUrl: string;
  secUa: string;
  skipYahoo: boolean;
  skipInvesco: boolean;
  edgarFallback: boolean;
  aumRange?: Range & { source?: string };
  terRange?: Range;
  dividendYieldRange?: Range;
  performanceRanges: RangeMap;
  totalReturnRanges: RangeMap;
};

const AUM_PRESET_BOUNDS = {
  nano: { min: 0, max: 10_000_000 },
  micro: { min: 10_000_000, max: 300_000_000 },
  small: { min: 300_000_000, max: 2_000_000_000 },
  mid: { min: 2_000_000_000, max: 10_000_000_000 },
  large: { min: 10_000_000_000, max: undefined },
} as const;
type AumPreset = keyof typeof AUM_PRESET_BOUNDS;

const AMOUNT_SUFFIXES: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };

function envValue(env: Record<string, string | undefined>, name: string, aliases: string[] = []): string {
  for (const key of [`INVESCO_${name}`, name, ...aliases]) {
    const value = env[key];
    if (value !== undefined && value.trim() !== '') return value.trim();
  }
  return '';
}

function parsePositiveInt(raw: string, fallback: number): number {
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function parseNonNegativeFloat(raw: string, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function parseBoolean(raw: string, fallback = false): boolean {
  const text = String(raw ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(text)) return false;
  return fallback;
}

// Strict "min:max" ranges (same parser and errors as the sibling repos).
export function parseRange(raw: string, label: string): Range | undefined {
  const text = String(raw ?? '').trim();
  if (text === '' || text === ':') return undefined;
  if (!text.includes(':')) {
    throw new Error(`${label}: "${text}" must use the "min:max" range syntax (a colon is required)`);
  }
  const colonParts = text.split(':');
  if (colonParts.length !== 2) throw new Error(`${label}: "${text}" must contain exactly one colon (min:max)`);
  const [rawMin, rawMax] = colonParts;
  const parseBound = (bound: string): number | undefined => {
    const cleaned = bound.trim().replace(/%$/, '').replace(/[$,]/g, '');
    if (cleaned === '') return undefined;
    const value = Number(cleaned);
    if (!Number.isFinite(value)) throw new Error(`${label}: "${bound.trim()}" is not a number`);
    return value;
  };
  const min = parseBound(rawMin);
  const max = parseBound(rawMax);
  if (min === undefined && max === undefined) return undefined;
  if (min !== undefined && max !== undefined && min > max) {
    throw new Error(`${label}: min (${min}) must not exceed max (${max})`);
  }
  return { min, max };
}

function parseAumBound(bound: string): number | undefined {
  const cleaned = bound.trim().replace(/[$,]/g, '');
  if (cleaned === '') return undefined;
  const suffixMatch = /^(\d+(?:\.\d+)?|\.\d+)([KMBT])$/i.exec(cleaned);
  if (suffixMatch) return Number(suffixMatch[1]) * (AMOUNT_SUFFIXES[suffixMatch[2].toUpperCase()] ?? 1);
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) throw new Error(`AUM: "${bound.trim()}" is not an amount, a K/M/B/T suffix or a preset`);
  return value;
}

export function parseAumRange(raw: string): (Range & { source?: string }) | undefined {
  const text = String(raw ?? '').trim();
  if (text === '' || text === ':') return undefined;
  const lower = text.toLowerCase();
  for (const preset of Object.keys(AUM_PRESET_BOUNDS) as AumPreset[]) {
    if (lower === preset) return { ...AUM_PRESET_BOUNDS[preset] } as Range & { source?: string };
  }
  if (!text.includes(':')) {
    throw new Error(`AUM: "${text}" must use the "min:max" range syntax (a colon is required)`);
  }
  const aumParts = text.split(':');
  if (aumParts.length !== 2) throw new Error(`AUM: "${text}" must contain exactly one colon (min:max)`);
  const [rawMin, rawMax] = aumParts;
  const min = parseAumBound(rawMin);
  const max = parseAumBound(rawMax);
  if (min === undefined && max === undefined) return undefined;
  if (min !== undefined && max !== undefined && min > max) {
    throw new Error(`AUM: min (${min}) must not exceed max (${max})`);
  }
  return { min, max };
}

function parseRanges(env: Record<string, string | undefined>, prefix: 'PERFORMANCE' | 'TOTAL_RETURN'): RangeMap {
  const ranges: RangeMap = {};
  for (const period of RETURN_PERIODS) {
    const parsed = parseRange(envValue(env, `${prefix}_${period}`), `${prefix}_${period}`);
    if (parsed) ranges[period] = parsed;
  }
  return ranges;
}

export function readConfig(env: Record<string, string | undefined> = process.env): UpdaterConfig {
  return {
    concurrency: parsePositiveInt(envValue(env, 'CONCURRENCY'), CONCURRENCY_FALLBACK),
    requestSleep: parseNonNegativeFloat(envValue(env, 'REQUEST_SLEEP'), REQUEST_SLEEP_FALLBACK),
    maxFetches: parsePositiveInt(envValue(env, 'MAX_FETCHES', ['INVESCO_LIMIT']), 0),
    holdingsPageSize: parsePositiveInt(envValue(env, 'HOLDINGS_PAGE_SIZE'), HOLDINGS_PAGE_SIZE_FALLBACK),
    historyPageSize: parsePositiveInt(envValue(env, 'HISTORY_PAGE_SIZE', ['HISTORICAL_PAGE_SIZE']), HISTORY_PAGE_SIZE_FALLBACK),
    maxRetries: parsePositiveInt(envValue(env, 'MAX_RETRIES'), MAX_RETRIES_FALLBACK),
    tickers: envValue(env, 'TICKERS')
      .split(/[\s,;]+/)
      .map(sanitizeTicker)
      .filter(Boolean),
    historyRange: envValue(env, 'HISTORY_RANGE') || 'max',
    sitemapUrl: envValue(env, 'SITEMAP_URL') || INVESCO_SITEMAP_URL,
    secUa: envValue(env, 'SEC_UA') || SEC_UA_DEFAULT,
    skipYahoo: parseBoolean(envValue(env, 'SKIP_YAHOO'), false),
    skipInvesco: parseBoolean(envValue(env, 'SKIP_INVESCO'), false),
    edgarFallback: parseBoolean(envValue(env, 'EDGAR_FALLBACK'), true),
    aumRange: parseAumRange(envValue(env, 'AUM')),
    terRange: parseRange(envValue(env, 'TER'), 'TER'),
    dividendYieldRange: parseRange(envValue(env, 'DIVIDEND_YIELD'), 'DIVIDEND_YIELD'),
    performanceRanges: parseRanges(env, 'PERFORMANCE'),
    totalReturnRanges: parseRanges(env, 'TOTAL_RETURN'),
  };
}

function rangeLabel(range?: Range): string {
  if (!range) return 'any';
  const min = range.min === undefined ? '' : String(range.min);
  const max = range.max === undefined ? '' : String(range.max);
  return `${min}:${max}`;
}

function configLines(config: UpdaterConfig): string[] {
  return [
    `CONCURRENCY         ${config.concurrency}`,
    `REQUEST_SLEEP       ${config.requestSleep} s between outgoing request starts`,
    `MAX_FETCHES         ${config.maxFetches === 0 ? 'all eligible funds (full pass, cursor ignored)' : `${config.maxFetches} per run (resumes after the saved cursor)`}`,
    `HOLDINGS_PAGE_SIZE  ${config.holdingsPageSize}`,
    `HISTORY_PAGE_SIZE   ${config.historyPageSize}`,
    `MAX_RETRIES         ${config.maxRetries}`,
    `TICKERS             ${config.tickers.length ? config.tickers.join(' ') : 'all Invesco ETFs in the catalog'}`,
    `HISTORY_RANGE       ${config.historyRange} (max or Ny, explicit period1/period2)`,
    `SITEMAP_URL        ${config.sitemapUrl}`,
    `AUM                 ${rangeLabel(config.aumRange)}`,
    `TER                 ${rangeLabel(config.terRange)}`,
    `DIVIDEND_YIELD      ${rangeLabel(config.dividendYieldRange)}`,
    `PERFORMANCE_*       ${RETURN_PERIODS.filter((p) => config.performanceRanges[p]).map((p) => `${p}=${rangeLabel(config.performanceRanges[p])}`).join(' ') || 'any'}`,
    `TOTAL_RETURN_*      ${RETURN_PERIODS.filter((p) => config.totalReturnRanges[p]).map((p) => `${p}=${rangeLabel(config.totalReturnRanges[p])}`).join(' ') || 'any'}`,
    `SEC_UA              <redacted>`,
    `SKIP_YAHOO          ${config.skipYahoo}`,
    `SKIP_INVESCO        ${config.skipInvesco}`,
    `EDGAR_FALLBACK      ${config.edgarFallback}`,
  ];
}

const USAGE = `
Invesco ETF static data updater (Bun, no dependencies).

  bun ./scripts/update-data.ts            update ./api/invesco from invesco.com + Yahoo
  ./scripts/update-data.ts -h | --help    print this help

Defaults live in scripts/update-data.config.json (every control below).
Precedence: config file < workflow advanced JSON < nonblank workflow inputs <
environment variables (the protected Actions variable SEC_UA is passed as
environment). Each control may also be set as INVESCO_<NAME>.

Data: fund list from the invesco.com sitemap (plus every fund already
published), fund facts and expense ratio from each fund page, month-end
returns, NAV, net assets, yields and daily holdings from the JSON API behind
the fund pages (dng-api.invesco.com, addressed by CUSIP), market history and
distributions from Yahoo Finance, SEC EDGAR N-PORT-P as the holdings fallback.
invesco.com answers HTTP 406 to browser-like User-Agents, so the updater sends
its own non-browser User-Agent.

Environment variables (all optional; strict "min:max" ranges; AND logic):

  MAX_FETCHES          Batch size: continue after the ticker cursor saved in
                       api/invesco/update-state.json. Empty or 0 (the default)
                       means a full pass: every Invesco ETF in the catalog is
                       refreshed in one run, starting from the first ticker,
                       and the cursor is reset when it finishes.
                       Legacy alias: INVESCO_LIMIT.
  REQUEST_SLEEP        Minimum seconds between outgoing request starts per
                       worker lane, including retries (default 1). invesco.com
                       and the SEC both throttle bursty clients; the SEC allows
                       at most 10 requests per second, Yahoo throttles hard,
                       keep >= 1.
  CONCURRENCY          Parallel fund workers (default 2). Each worker has its
                       own paced request lane.
  MAX_RETRIES          Retries after the initial request (default 2, at least
                       1). Only network errors and HTTP 403/408/425/429/5xx
                       responses are retried with bounded exponential backoff.
  TICKERS              Space-, comma- or semicolon-separated ticker allowlist,
                       for example "QQQ QQQM RSP PGX".
  AUM                  Net assets range in USD: "min:max". Bounds accept plain
                       amounts or K/M/B/T suffixes; a whole-value preset may be
                       one of nano, micro, small, mid, large.
  TER                  Expense ratio range in percent, for example "0.1:0.5".
  DIVIDEND_YIELD       Dividend-yield range in percent (the trailing-12-month
                       distribution rate published by Invesco, indicated when
                       derived here).
  PERFORMANCE_YTD      Annualized return ranges (also 1Y, 3Y, 5Y, 10Y).
  TOTAL_RETURN_YTD     Cumulative return ranges (also 1Y, 3Y, 5Y, 10Y).
  HOLDINGS_PAGE_SIZE   Rows per generated current-holdings JSON page (default 250).
  HISTORY_PAGE_SIZE    Rows per generated price-history JSON page (default 1000).
                       Legacy alias: HISTORICAL_PAGE_SIZE.
  HISTORY_RANGE        Yahoo chart range for history rows (default "max").
  SITEMAP_URL          invesco.com sitemap that lists the canonical fund pages
                       (default ${INVESCO_SITEMAP_URL}).
  VERBOSE              1/true to print per-fund retry and fallback notices
                       (default false).
  USE_SYSTEM_CA        auto, true or false (default auto). TLS trust store:
                       auto restarts the updater once with Bun's
                       --use-system-ca when a request fails with an
                       untrusted-certificate error; true always uses the
                       system CA store; false never restarts.
  EDGAR_FALLBACK       0/false to skip the SEC EDGAR Form N-PORT-P fallback for
                       funds without Invesco holdings (default on; needs the
                       declared SEC_UA).
  SEC_UA               Declared SEC User-Agent (default daggerok ETF feed
                       daggerok@gmail.com; the protected Actions variable
                       SEC_UA overrides it). Redacted in logs.
  SKIP_YAHOO           1/true to skip the Yahoo chart request entirely. The
                       invesco.com data still updates; price history,
                       distributions, exchange listing and the live quote keep
                       their previously published values.
  SKIP_INVESCO         1/true to update history only (Yahoo), keeping the
                       previously published fund facts, returns and holdings.
                       Useful when invesco.com is down and only prices moved.

AUM, TER, yield and return filters are evaluated against the freshly
fetched fund values before the heavier holdings download. Funds that are
filtered out (or that fail) keep their previously published files, exactly like
the sibling updaters.

Examples:

  MAX_FETCHES=10 ./scripts/update-data.ts
  TICKERS="QQQ QQQM RSP" ./scripts/update-data.ts
  AUM="1B:" TER=":0.5" ./scripts/update-data.ts
  PERFORMANCE_1Y="15:" ./scripts/update-data.ts
  SKIP_YAHOO=1 ./scripts/update-data.ts
`;

// ---------------------------------------------------------------------------
// Fetch layer with global pacing and bounded retries (SPDR/Fidelity-style)
// ---------------------------------------------------------------------------

// One pacing lane per concurrent worker (sized from config.concurrency in
// main()). A single shared gate capped total throughput at one request per
// REQUEST_SLEEP no matter how high CONCURRENCY was set; CONCURRENCY workers
// now each get their own paced lane, so concurrency actually multiplies
// throughput as documented instead of only overlapping wait time.
let nextRequestAtLanes: number[] = [0];
let requestSleepMs = REQUEST_SLEEP_FALLBACK * 1000;
let fetchTimeoutMs = 45_000;
// The workflow times out at 30 minutes: stop taking new funds after 25 and still write the index
let softDeadlineMs = 25 * 60_000;

/** Tests shrink the per-request timeout and set the pacing lanes directly. */
export function configureFetchForTests(options: { timeoutMs?: number; sleepMs?: number; lanes?: number; deadlineMs?: number }): void {
  if (options.deadlineMs !== undefined) softDeadlineMs = options.deadlineMs;
  if (options.timeoutMs !== undefined) fetchTimeoutMs = options.timeoutMs;
  if (options.sleepMs !== undefined) requestSleepMs = options.sleepMs;
  if (options.lanes !== undefined) nextRequestAtLanes = new Array(Math.max(1, options.lanes)).fill(0);
}

/**
 * Reserves the earliest free lane slot synchronously (before any await), so
 * concurrent callers can never pick the same slot: N workers on N lanes start
 * together, the next request on a lane starts REQUEST_SLEEP after the last.
 */
export async function paceRequests(): Promise<void> {
  let lane = 0;
  for (let i = 1; i < nextRequestAtLanes.length; i++) if (nextRequestAtLanes[i] < nextRequestAtLanes[lane]) lane = i;
  const now = Date.now();
  const start = Math.max(now, nextRequestAtLanes[lane]);
  nextRequestAtLanes[lane] = start + requestSleepMs;
  if (start > now) await sleep(start - now);
}

class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

/** `fetchWithRetry` already prefixes its messages with the fetch label, so a
    caller that prints its own tag must not repeat the label. */
function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^\[[^\]]*\] ?/, '');
}

/**
 * One paced attempt per try, each with its own timeout that covers the headers
 * AND the body read; a timeout or a failed body read is retried like any
 * network error, up to maxRetries more times.
 */
async function fetchAttempts<T>(
  url: string,
  label: string,
  init: RequestInit,
  maxRetries: number,
  read: (response: Response) => Promise<T>,
): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await paceRequests();
    try {
      const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(fetchTimeoutMs), ...init });
      if (response.ok) return await read(response);
      const retryable = [403, 408, 425, 429].includes(response.status) || response.status >= 500;
      if (!retryable) throw new HttpError(`${label}: HTTP ${response.status} ${response.statusText}`, response.status, false);
      lastError = new HttpError(`${label}: HTTP ${response.status} (attempt ${attempt + 1} of ${maxRetries + 1})`, response.status, true);
    } catch (error) {
      if (error instanceof HttpError && !error.retryable) throw error;
      lastError = error instanceof HttpError ? error : new Error(`${label}: network error (${String(error)})`);
    }
    if (attempt < maxRetries) await sleep(Math.min(30_000, 1_000 * 2 ** attempt) + 250);
  }
  throw lastError instanceof Error ? lastError : new Error(`${label}: failed`);
}

export async function fetchWithRetry(
  url: string,
  label: string,
  init: RequestInit = {},
  maxRetries = 2,
): Promise<Response> {
  return fetchAttempts(url, label, init, maxRetries, async (response) => response);
}

function yahooHeaders(): Record<string, string> {
  return { 'User-Agent': YAHOO_BROWSER_UA, Accept: 'application/json' };
}

function secHeaders(config: UpdaterConfig): Record<string, string> {
  return { 'User-Agent': config.secUa, Accept: 'application/json,*/*' };
}

// invesco.com sits behind a CDN that answers HTTP 406 to browser-like
// User-Agents (checked on 2026-10-02: Chrome and Safari strings fail, curl, bun
// and a custom bot string pass, from a laptop and from a GitHub Actions runner).
// The updater therefore identifies itself honestly instead of posing as a browser.
function invescoHeaders(): Record<string, string> {
  return { 'User-Agent': INVESCO_UA, Accept: 'application/json,text/html;q=0.9,application/xml;q=0.8,*/*;q=0.5' };
}

async function fetchText(url: string, label: string, headers: Record<string, string>, config: UpdaterConfig): Promise<string> {
  return fetchAttempts(url, label, { headers }, config.maxRetries, (response) => response.text());
}

async function fetchJson(url: string, label: string, headers: Record<string, string>, config: UpdaterConfig): Promise<JsonRecord> {
  const text = await fetchText(url, label, headers, config);
  try {
    return JSON.parse(text) as JsonRecord;
  } catch {
    throw new Error(`${label}: response is not valid JSON`);
  }
}

// ---------------------------------------------------------------------------
// Catalog layer: the invesco.com ETF product-list download
// ---------------------------------------------------------------------------

export type CatalogReturns = {
  ytd: number | null;
  yr1: number | null;
  yr3: number | null;
  yr5: number | null;
  yr10: number | null;
  sinceInception: number | null;
};

export type CatalogFund = {
  ticker: string;
  name: string;
  category: string;
  categoryPath: string;
  inception: string | null;
  exchange: string;
  cusip: string;
  isin: string;
  benchmark: string;
  ter: number | null; // NET expense ratio (after waivers); the only number when just one is published
  terGross: number | null; // GROSS (total) expense ratio when published
  nav: number | null;
  close: number | null;
  premiumDiscount: number | null;
  netAssets: number | null;
  dividendYield: number | null;
  // code of the definition behind dividendYield (see YieldBasis), null exactly when dividendYield is null
  dividendYieldBasis: YieldBasis | null;
  secYield: number | null;
  distributionRate: number | null;
  asOfDate: string | null;
  // ISO date the official returns are as of: the "Returns as of MM/DD/YYYY"
  // line above the product list table (or a returns date column), else null.
  returnsAsOf: string | null;
  returns: CatalogReturns;
  fundPage: string;
  trustCik: string | null;
  source: 'invesco' | 'previous index' | 'seed';
};

// `metrics.dividendYieldBasis`: which definition stands behind `dividendYield` (null exactly when it is null).
export type YieldBasis = 'official-trailing-12m' | 'official-distribution-rate' | 'official-other' | 'computed-trailing-12m' | 'indicated';
const YIELD_BASIS_KIND: Record<YieldBasis, string> = {
  'official-trailing-12m': 'trailing 12-month distribution rate, published by invesco.com',
  'official-distribution-rate': 'distribution rate, published by invesco.com',
  'official-other': 'yield published by invesco.com',
  'computed-trailing-12m': 'trailing 12-month distributions / price, computed by the updater',
  indicated: 'indicated (latest distribution x inferred frequency / market price)',
};
export function isYieldBasis(value: unknown): value is YieldBasis {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(YIELD_BASIS_KIND, value);
}
/** Maps the free-text `yields.dividendYieldKind` of an older meta.json to a code (unknown text: provider-published -> official-other, none -> indicated). */
export function yieldBasisFromKind(kind: unknown): YieldBasis {
  const text = typeof kind === 'string' ? kind.trim() : '';
  if (/^trailing 12-month distribution rate/.test(text)) return 'official-trailing-12m';
  if (/^indicated/.test(text)) return 'indicated';
  return /published by invesco\.com/.test(text) ? 'official-other' : 'indicated';
}

const EMPTY_RETURNS: CatalogReturns = { ytd: null, yr1: null, yr3: null, yr5: null, yr10: null, sinceInception: null };

// Invesco groups its line-up by asset class and sub-category ("Equity,
// Alternatives"). The catalog tabs use the asset class; the full path is kept
// in meta.json for provenance. Long labels are abbreviated so the tabs read
// like the sibling apps' (Fidelity: "US Equity", "Factor", "Bond").
const CATEGORY_LABELS: Record<string, string> = {
  'us equity': 'US Equity',
  'u s equity': 'US Equity',
  'global ex us equity': 'International',
  'sector equity': 'Sector',
  'international equity': 'International',
  'asia-pacific equity': 'Asia-Pacific Equity',
  'europe middle east africa equity': 'EMEA Equity',
  'latin america equity': 'Latin America Equity',
  'frontier markets equity': 'Frontier Equity',
  'global equity': 'Global Equity',
  'emerging markets equity': 'Emerging Markets Equity',
  'real assets and commodities': 'Real Assets',
  'alternatives': 'Alternatives',
  'alternative': 'Alternatives',
  'absolute return': 'Alternatives',
  'fixed income': 'Fixed Income',
  'bond': 'Bond',
  'hedged us equity': 'Hedged US Equity',
  'balanced': 'Balanced',
  'digital assets': 'Digital Assets',
  'thematic': 'Thematic',
  'multi asset': 'Multi-Asset',
  'currency': 'Currency',
  'real estate': 'Real Estate',
  'mlps': 'MLPs',
  'bank loans': 'Bank Loans',
  'commodity': 'Commodity',
  'commodities': 'Commodity',
  'factor': 'Factor',
  'sector': 'Sector',
  'esg': 'ESG',
  'income': 'Income',
  'small cap': 'Small Cap',
  'mid cap': 'Mid Cap',
  'large cap': 'Large Cap',
};

export function normalizeInvescoCategory(raw: unknown): string {
  const text = cleanText(raw);
  if (!text) return 'ETF';
  const categoryKey = (part: string): string =>
    part.trim().toLowerCase().replace(/&/g, ' and').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  // "Real Assets & Commodities, Agriculture" is the group plus the sleeve:
  // whichever part is a known asset class wins, the group being only a tiebreak.
  const parts = [text, ...text.split(',')];
  for (const part of parts) {
    const key = categoryKey(part);
    if (CATEGORY_LABELS[key]) return CATEGORY_LABELS[key];
  }
  const head = categoryKey(text.split(',')[0]);
  if (head.includes('equity')) return 'US Equity';
  if (head.includes('fixed income') || head.includes('bond')) return 'Fixed Income';
  return head ? head.replace(/\b\w/g, (letter) => letter.toUpperCase()) : 'ETF';
}

// ---------------------------------------------------------------------------
// Holdings layer: shared sheet headers (equity and bond flavours)
// ---------------------------------------------------------------------------

export const HOLDINGS_HEADERS = ['Name', 'Ticker', 'Identifier', 'Weight', 'Market Value', 'Shares Held', 'Asset Category'];
export const BOND_SHEET_HEADERS = [...HOLDINGS_HEADERS, 'Coupon', 'Maturity'];
/** Funds whose holdings legitimately fail a holdingsGuard check (geared, futures, look-through, top-N lists): ticker, or '*' for every fund -> relaxed checks. */
export const HOLDINGS_GUARD_RELAX: Record<string, string[]> = {
  // currency, crypto and commodity trusts: 2-3 rows, one of them "USD Pending Dividends" with a blank weight, so only 50-67% are numeric
  BTCO: ['numeric'], EVMT: ['numeric'], FXA: ['numeric'], FXB: ['numeric'], FXC: ['numeric'], FXE: ['numeric'],
  FXF: ['numeric'], FXY: ['numeric'], PDBA: ['numeric'], PDBC: ['numeric'], QETH: ['numeric'], QSOL: ['numeric'],
};
/** Funds the issuer closed, each confirmed from an SEC filing or the issuer notice (`source`): never fetched or guarded, last published data kept, index row marked closed. */
export const CLOSED_FUNDS: ClosedFund[] = [];
/** A fund the issuer renamed to a new ticker (same CUSIP, same SEC series), confirmed from an SEC filing (`source`). */
export type RenamedFund = { ticker: string; renamedTo: string; renamed: string; source: string };
/**
 * Funds renamed to a new ticker: the old ticker leaves the run, index.json and its api/invesco/funds folder once its
 * successor is in the catalog; the successor carries the fund (Yahoo moved the whole price history to the new ticker).
 * Without an entry the old page keeps a row with 0 holdings next to the full new row (the CUSIP check blanks its values).
 */
export const RENAMED_FUNDS: RenamedFund[] = [
  // 497 of 2025-02-18, Invesco Actively Managed Exchange-Traded Fund Trust: Invesco Municipal Strategic Income ETF (IMSI)
  // becomes Invesco Rochester High Yield Municipal ETF (IROC) on 2025-02-24 (CUSIP 46090A747 stays)
  { ticker: 'IMSI', renamedTo: 'IROC', renamed: '2025-02-24', source: 'https://www.sec.gov/Archives/edgar/data/1418144/000110465925014725/tm256636d1_497.htm' },
  // 497 of 2025-02-18, same trust: Invesco Short Duration Bond ETF (ISDB) becomes Invesco Short Duration Total Return Bond
  // ETF (GTOS) on 2025-02-24, moved from 2025-02-20 by this supplement (CUSIP 46090A739 stays)
  { ticker: 'ISDB', renamedTo: 'GTOS', renamed: '2025-02-24', source: 'https://www.sec.gov/Archives/edgar/data/1418144/000110465925014724/tm256642d1_497.htm' },
];

/** The RENAMED_FUNDS entry of an old ticker, or null. A malformed entry throws, so a typo (no ISO date, no https source) never ships. */
export function renamedFund(list: ReadonlyArray<RenamedFund>, ticker: unknown): RenamedFund | null {
  const wanted = String(ticker === null || ticker === undefined ? '' : ticker).trim().toUpperCase();
  let found: RenamedFund | null = null;
  for (const fund of list) {
    const symbol = /^[A-Z0-9][A-Z0-9.-]{0,9}$/;
    if (!symbol.test(fund.ticker) || !symbol.test(fund.renamedTo) || fund.ticker === fund.renamedTo || !/^\d{4}-\d{2}-\d{2}$/.test(fund.renamed) || !/^https:\/\/\S+$/.test(fund.source)) {
      throw new Error(`RENAMED_FUNDS: ${fund.ticker} needs upper-case old and new tickers, an ISO date and an https source`);
    }
    if (fund.ticker === wanted) found = fund;
  }
  return found;
}

/** Removes every renamed fund whose successor is in the catalog and returns the old tickers removed (sorted). */
export function dropRenamedFunds(catalog: Map<string, unknown>, list: ReadonlyArray<RenamedFund>): string[] {
  const dropped: string[] = [];
  for (const ticker of Array.from(catalog.keys())) {
    const entry = renamedFund(list, ticker);
    if (entry && catalog.has(entry.renamedTo)) {
      catalog.delete(ticker);
      dropped.push(ticker);
    }
  }
  return dropped.sort();
}

export type ParsedHoldings = {
  asOfDate: string | null;
  headers: string[];
  rows: JsonRecord[];
};

// ---------------------------------------------------------------------------
// Official invesco.com layer: the fund pages and the JSON API behind them
//
// The legacy CSV downloads (product list, per-fund holdings, prices & yields)
// are gone: they answer a redirect to the catalog page, and any browser-like
// User-Agent gets HTTP 406. What invesco.com still publishes, without a key:
//   - sitemap.xml                  : the canonical page of every live US ETF
//   - <fund page>.html             : fund facts (ticker, CUSIP, ISIN, index,
//                                    expense ratios) embedded as page JSON
//   - dng-api.invesco.com/cache/v1 : month-end performance, daily NAV/price/
//                                    net assets, yields and the full daily
//                                    holdings, addressed by CUSIP
// Every request must carry a non-browser User-Agent (see invescoHeaders()).
// ---------------------------------------------------------------------------

export type FundPageInfo = {
  ticker: string;
  cusip: string;
  isin: string;
  name: string;
  benchmark: string;
  exchange: string;
  inception: string | null;
  ter: number | null;
  netTer: number | null;
  managementFee: number | null;
  assetClass: string;
  assetSubClass: string;
};

export type OfficialPerformance = { asOfDate: string | null; returns: CatalogReturns };
export type OfficialPrices = { asOfDate: string | null; nav: number | null; close: number | null; netAssets: number | null };
export type OfficialYields = { secYield: number | null; dividendYield: number | null; distributionRate: number | null };

const FUND_PAGE_URL_RE = /^https:\/\/www\.invesco\.com\/us\/en\/financial-products\/etfs\/([a-z0-9-]+)\.html$/i;

export function dngUrl(cusip: string, endpoint: 'performance' | 'prices' | 'yields' | 'holdings'): string {
  const id = encodeURIComponent(String(cusip).toUpperCase());
  const common = 'idType=cusip&productType=ETF';
  switch (endpoint) {
    case 'performance':
      return `${DNG_API}/${id}/performance/standard?${common}&performanceSubType=annualized&performancePeriod=monthly`;
    case 'prices':
      return `${DNG_API}/${id}/prices?${common}&variationType=priceListing&productSubType=ETF`;
    case 'yields':
      return `${DNG_API}/${id}?expand=nav&${common}&variationType=yieldInformation&managementFeeWaiver=0.0`;
    case 'holdings':
      return `${DNG_API}/${id}/holdings/fund?${common}`;
  }
}

/**
 * The prices endpoint addressed by ticker instead of CUSIP. It answers an empty list for a ticker
 * that no longer owns its CUSIP: a renamed fund's old page stays online with the CUSIP of the new
 * ticker (IMSI -> IROC, ISDB -> GTOS on 2026-10-13).
 */
export function dngTickerPricesUrl(ticker: string): string {
  return `${DNG_API}/${encodeURIComponent(String(ticker).toUpperCase())}/prices?idType=ticker&productType=ETF&variationType=priceListing&productSubType=ETF`;
}

/** Unique canonical fund page URLs listed in the US sitemap, in file order. */
export function parseSitemapFundPages(xml: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const match of String(xml ?? '').matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
    const url = cleanText(match[1]).replace(/^http:/i, 'https:');
    if (!FUND_PAGE_URL_RE.test(url) || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

/** True for a real slug page (the old `<ticker>.html` guesses never resolved). */
export function isFundPageUrl(url: unknown, ticker?: string): boolean {
  const match = FUND_PAGE_URL_RE.exec(String(url ?? ''));
  if (!match) return false;
  return !ticker || match[1].toLowerCase() !== ticker.toLowerCase();
}

// The page embeds its component configuration as JSON inside HTML attributes
// (&#34; for quotes), so the markup is decoded before fields are read.
function decodePageJson(html: string): string {
  return String(html ?? '').replace(/&#34;|&quot;/g, '"').replace(/&amp;/g, '&');
}

function pageField(text: string, key: string): string {
  const match = new RegExp(`"${key}":"([^"]*)"`).exec(text);
  return match ? cleanText(match[1]) : '';
}

/**
 * Fund facts of one invesco.com fund page, or null when the page is not a fund
 * page (country splash, 404, marketing microsite such as the QQQ home page).
 */
export function parseFundPage(html: string): FundPageInfo | null {
  const text = decodePageJson(html);
  const facts = /"productListFieldValueMap":\{("ticker":"[^}]*)\}/.exec(text);
  if (!facts) return null;
  const body = facts[1];
  const ticker = sanitizeTicker(pageField(body, 'ticker'));
  const cusip = pageField(body, 'cusip').toUpperCase();
  if (!ticker || !/^[0-9A-Z]{9}$/.test(cusip)) return null;
  const inception = pageField(body, 'InceptionDate');
  return {
    ticker,
    cusip,
    isin: pageField(body, 'isin').toUpperCase(),
    name: pageField(text, 'fundName') || cleanText((/<title>([^<|]*)/i.exec(html) || [])[1] || ''),
    benchmark: pageField(body, 'bloombergTicker'),
    exchange: pageField(body, 'exchange'),
    inception: inception ? toIsoDate(inception) : null,
    ter: numberOrNull(pageField(body, 'totalExpenseRatio')),
    netTer: numberOrNull(pageField(body, 'netExpenseRatio')),
    managementFee: numberOrNull(pageField(body, 'managementFee')),
    assetClass: pageField(text, 'assetClass'),
    assetSubClass: pageField(text, 'assetSubClass'),
  };
}

function isoOrNull(raw: unknown): string | null {
  const iso = toIsoDate(raw);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
}

const percent = (raw: unknown): number | null => {
  const value = numberOrNull(raw);
  return value === null ? null : round(value, 2);
};

/** Month-end annualized NAV returns of the "fund" row (YTD and 1Y cumulative, 3Y+ annualized). */
export function parseDngPerformance(payload: JsonRecord): OfficialPerformance {
  const rows: JsonRecord[] = Array.isArray(payload?.annualizedPerformance) ? payload.annualizedPerformance : [];
  const row = rows.find((candidate) => candidate?.label === 'fund');
  if (!row) throw new Error('performance: no fund NAV row');
  return {
    asOfDate: isoOrNull(payload.effectiveDate),
    returns: {
      ytd: percent(row.ytd),
      yr1: percent(row.y1),
      yr3: percent(row.y3),
      yr5: percent(row.y5),
      yr10: percent(row.y10),
      // A published since-inception of exactly 0.00 is the provider's placeholder
      // (BSMU: 0.00 next to a -3.89 5Y after six years): unavailable, never 0.
      sinceInception: percent(row.inception) === 0 ? null : percent(row.inception),
    },
  };
}

export function parseDngPrices(payload: JsonRecord): OfficialPrices {
  const nav = numberOrNull(payload?.nav);
  const close = numberOrNull(payload?.closingPrice);
  if (nav === null && close === null) throw new Error('prices: no NAV or closing price');
  const netAssets = numberOrNull(payload?.marketValue);
  return {
    asOfDate: isoOrNull(payload.effectiveDate),
    nav: nav === null ? null : round(nav, 6),
    close,
    netAssets: netAssets === null ? null : round(netAssets, 2),
  };
}

export function parseDngYields(payload: JsonRecord): OfficialYields {
  if (!payload || typeof payload !== 'object' || !('cusip' in payload)) throw new Error('yields: unexpected payload');
  return {
    secYield: percent(payload.secYield30Day),
    dividendYield: percent(payload.twelveMonthDistributionRate),
    distributionRate: percent(payload.distributionYield),
  };
}

/**
 * The exchange ticker of a non-bond invesco.com holding, or '' (published as '-'). A bare symbol is kept only for a U.S.
 * listing: the API names no exchange, only the local currency of the line, so a line traded in another currency has none
 * (IMFL lists Saputo as `SAP` in Canadian dollars, PID the SAP SE ADR as `SAP`; Samsung is `005930`), and neither has a
 * global depositary receipt (listed in London). Cash and currency lines (`USD`, `EUR`, `USDPDV`), futures, swaps, options,
 * rights, warrants and preferred shares carry codes or the issuer's common-stock ticker, never their own exchange ticker.
 * A line without a local currency (older payloads) keeps its ticker.
 */
export function dngHoldingTicker(item: JsonRecord): string {
  const type = cleanText(item?.securityTypeName);
  if (/currency|cash|future|swap|option|forward|right|warrant|preferred|global depository/i.test(type)) return '';
  const local = cleanText(item?.localCurrencyName);
  if (local && !/^us dollars?$/i.test(local)) return '';
  return cleanHoldingTicker(item?.ticker);
}

/**
 * A kept N-PORT sheet published before the shared reader: only equity rows (assetCat EC common, EP preferred) may carry a
 * ticker, so a bond keeps its CUSIP and never its issuer's stock ticker (BSCP listed Visa notes as `V`, Rogers notes as `RCI`).
 */
export function withoutNportDebtTickers(rows: JsonRecord[]): JsonRecord[] {
  return rows.map((row) => {
    // an N-PORT asset category code (DBT, STIV, ABS-O, ...), never an invesco.com sector name such as Health Care
    const category = String(row['Asset Category'] ?? '').trim();
    const nportCode = /^[A-Z]{2,5}(?:-[A-Z]{1,5})?$/.test(category);
    return nportCode && category !== 'EC' && category !== 'EP' && row.Ticker && row.Ticker !== '-' ? { ...row, Ticker: '-' } : row;
  });
}

/** Full daily holdings of one fund (percent weights; bond rows keep coupon and maturity). */
export function parseDngHoldings(payload: JsonRecord, ticker: string): ParsedHoldings {
  const raw: JsonRecord[] = Array.isArray(payload?.holdings) ? payload.holdings : [];
  // Futures carry a maturityDate too (the contract expiry), so those rows do not count as bonds.
  const isBond = (item: JsonRecord): boolean => (Boolean(item.maturityDate) && !item.contractExpiryDate) || (numberOrNull(item.coupon) ?? 0) > 0;
  const hasBondColumns = raw.some(isBond);
  const rows: JsonRecord[] = [];
  for (const item of raw) {
    const name = cleanText(item?.issuerName);
    if (!name) continue;
    const weight = numberOrNull(item.percentageOfTotalNetAssets);
    const value = numberOrNull(item.marketValueBase);
    const units = numberOrNull(item.units);
    const rating = cleanText(item.spMoodysRating);
    const sector = cleanText(item.sectorName) || cleanText(item.securityTypeName);
    const bond = isBond(item);
    const row: JsonRecord = {
      Name: name,
      // Bond, futures and cash rows carry internal codes instead of exchange tickers; a foreign listing a local one.
      Ticker: bond ? '-' : dngHoldingTicker(item) || '-',
      Identifier: cleanText(item.cusip) || '-',
      Weight: weight === null ? '' : String(round(weight, 6)),
      'Market Value': value === null ? '' : normalizeNumberText(String(value)),
      'Shares Held': units === null ? '-' : normalizeNumberText(String(units)),
      'Asset Category': (bond && rating && rating !== 'NR/NR' ? `${sector ? `${sector} / ` : ''}${rating}` : sector) || '-',
    };
    if (hasBondColumns) {
      const coupon = numberOrNull(item.coupon);
      const maturity = isoOrNull(item.maturityDate);
      row['Coupon'] = coupon === null ? '' : String(round(coupon, 4));
      row['Maturity'] = maturity ? formatEdgarDate(maturity) : '';
    }
    rows.push(row);
  }
  if (!rows.length) throw new Error(`${ticker}: holdings payload contains no positions`);
  return {
    asOfDate: isoOrNull(payload.effectiveBusinessDate) || isoOrNull(payload.effectiveDate),
    headers: hasBondColumns ? BOND_SHEET_HEADERS : HOLDINGS_HEADERS,
    rows,
  };
}

// ---------------------------------------------------------------------------
// Holding ticker resolution
//
// invesco.com labels every exchange-listed holding with a ticker, but its
// bond, futures and cash rows come back blank or "n/a". Those rows keep "-"
// and are keyed by their CUSIP/ISIN Identifier in the Watchlist — the exact
// convention daggerok/SPDR and daggerok/Fidelity use. Names still missing a
// ticker are resolved from the Yahoo Finance symbol search with a STRICT name
// match so a fuzzy hit can never pin the wrong security.
// ---------------------------------------------------------------------------

const HOLDING_NAME_SUFFIXES = new Set([
  'STOCK', 'COMMON', 'PREFERRED', 'PFD', 'SHARES', 'ORDINARY', 'DEPOSITARY', 'ADS', 'ADR',
  'INC', 'INCORPORATED', 'CORP', 'CORPORATION', 'CO', 'COMPANY', 'LTD', 'LIMITED', 'PLC',
  'PUBLIC', 'SA', 'SAS', 'SARL', 'SRL', 'SL', 'KG', 'AG', 'BA', 'BV', 'NV', 'OY', 'SE',
  'AS', 'AB', 'AD', 'KK', 'KABUSHIKI', 'KAISHA', 'PTY', 'PT', 'SFC', 'ANONIMA', 'GMBH',
  'HOLDINGS', 'HLDGS', 'DEL', 'NEW', 'DELISTED', 'REPR', 'GROUP', 'TR', 'TRUST', 'NOTE',
  'NL', 'SPA', 'LP', 'LC', 'LLC', 'CAP', 'STK', 'SHS',
  'NOTES', 'BOND', 'BONDS', 'SER', 'SERIES',
]);
const HOLDING_NAME_PHRASES = new Set([
  'COMMON STOCK', 'PREFERRED STOCK', 'DEPOSITARY SHARES', 'AMERICAN DEPOSITARY SHARES',
  'ORDINARY SHARES', 'LIABILITY CO', 'S A', 'N V', 'B V', 'PRIVATE LTD', 'PUBLIC LTD',
]);
// Words that carry no identity at all: dropped wherever they sit at the edge
// of a filed name, so "The Coca-Cola Co" and "Coca CO" meet.
const HOLDING_NAME_FILLERS = new Set([
  'THE', 'OF', 'AND', 'FOR', 'DE', 'LA', 'LE', 'VAN', 'VON', 'DER', 'DEN', 'DI', 'Y',
  'E', 'DU', 'DA', 'LOS', 'LAS', 'EL', 'AL', 'DEL', 'NPV', 'PAR', 'VAL', 'USD', 'EUR',
  'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'HKD', 'CNY', 'SEK', 'NOK', 'NZD', 'MXN', 'INR',
]);

// Trailing share-class / security-type designations. The class letter is kept
// and canonicalized ("... Class C Capital Stock" -> "... Cl C") rather than
// dropped, so GOOG vs GOOGL — like BF/A vs BF/B — never collide.
const SHARE_CLASS_RE = /(?:\s+(?:CLASS|CL))\s+([A-Z])\b\s*$/;
// Words that only describe the security, never the issuer; safe to peel off the
// end of a filed name (and, once a share class is known, from behind it).
const SECURITY_TYPE_WORDS = new Set([
  'STOCK', 'STK', 'SHARES', 'SHS', 'SH', 'SHARE', 'CAPITAL', 'CAP', 'COMMON', 'ORDINARY',
  'GENERAL', 'VOTING', 'NON', 'NONVOTING', 'NVOTING', 'CONVERTIBLE', 'DEPOSITARY', 'PAID',
  'SUBORDINATED', 'NOTES', 'NOTE', 'SER', 'SERIES', 'LIABILITY', 'NEW', 'REP', 'REPR',
]);

export function normalizeHoldingName(raw: unknown): string {
  const text = String(raw ?? '')
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
  let tokens = text.split(' ').filter(Boolean);
  let classLetter = '';
  let changed = true;
  while (changed && tokens.length > 1) {
    changed = false;
    const withClass = tokens.join(' ').match(SHARE_CLASS_RE);
    if (withClass) {
      classLetter = withClass[1];
      tokens = tokens.slice(0, tokens.length - 2); // drop "Class C" (or "Cl C")
      changed = true;
    }
    const last = tokens[tokens.length - 1];
    if (SECURITY_TYPE_WORDS.has(last) && tokens.length > 1) {
      tokens.pop(); // "... Capital Stock" -> "... Capital"
      changed = true;
      continue;
    }
    if (tokens.length >= 2 && HOLDING_NAME_PHRASES.has(`${tokens[tokens.length - 2]} ${last}`)) {
      tokens = tokens.slice(0, -2);
      changed = true;
      continue;
    }
    if (HOLDING_NAME_SUFFIXES.has(last)) {
      tokens.pop();
      changed = true;
      continue;
    }
    while (tokens.length > 2 && HOLDING_NAME_FILLERS.has(tokens[tokens.length - 1])) {
      tokens.pop(); // keep peeling: a filler may hide the next legal-form suffix
      changed = true;
    }
  }
  while (tokens.length > 1 && HOLDING_NAME_FILLERS.has(tokens[0])) tokens.shift();
  const body = tokens.join(' ').trim();
  return classLetter ? `${body} CL ${classLetter}`.replace(/\s+/g, ' ').trim() : body;
}

export function normalizeHoldingNameCore(raw: unknown): string {
  return normalizeHoldingName(raw).replace(/ /g, '');
}

// Holding tickers keep their class-share markers (SCE^L, BF/A, BRK-B): they
// are the real exchange symbols, unlike fund tickers which sanitizeTicker
// upper-cases and strips everything but letters/digits.
const HOLDING_TICKER_PLACEHOLDERS = new Set(['', 'N/A', 'NA', 'NONE', 'NIL', 'NULL', '-', '--', '---', 'SEE FILE', 'VARIES']);

export function cleanHoldingTicker(raw: unknown): string {
  const symbol = String(raw ?? '').trim().toUpperCase();
  if (HOLDING_TICKER_PLACEHOLDERS.has(symbol)) return '';
  return /^[A-Z0-9][A-Z0-9.^/-]*$/.test(symbol) ? symbol : '';
}

export function yahooSearchUrl(name: string): string {
  return `${YAHOO_SEARCH_URL}?q=${encodeURIComponent(name)}&quotesCount=10&newsCount=0&enableFuzzyQuery=false`;
}

// Strict matcher for Yahoo search payloads: the quote's long name must
// normalize to the same name (or token-core) as the filed holding name. Only
// EQUITY/ETF quotes are accepted, and single/two-word holdings may additionally
// match by token containment (e.g. "BULLISH" -> "Bullish BLCM Inc").
export function pickSearchTicker(name: string, payload: JsonRecord): string | null {
  const matches: unknown[] = Array.isArray(payload?.quoteMatches) ? payload.quoteMatches : [];
  const norm = normalizeHoldingName(name);
  if (!norm) return null;
  const core = norm.replace(/ /g, '');
  const tokens = norm.split(' ');
  for (const match of matches) {
    if (!match || typeof match !== 'object') continue;
    const record = match as JsonRecord;
    const quoteType = String(record.quoteType || '').toUpperCase();
    if (quoteType !== 'EQUITY' && quoteType !== 'ETF') continue;
    const symbol = cleanHoldingTicker(record.symbol);
    if (!symbol) continue;
    const longName = String(record.longname || record.shortname || '');
    const candidate = normalizeHoldingName(longName);
    if (!candidate) continue;
    if (candidate === norm || candidate.replace(/ /g, '') === core) return symbol;
    if (tokens.length <= 2 && tokens.every((token) => candidate.includes(token))) return symbol;
  }
  return null;
}

// ---------------------------------------------------------------------------
// SEC EDGAR fallback layer: N-PORT-P positions for funds invesco.com does not
// publish holdings for. The shared nport-reader block at the end of this file
// finds, reads and checks the filing; this layer only maps it to the Invesco sheet.
// ---------------------------------------------------------------------------

/**
 * The Invesco holdings sheet of an N-PORT filing: HOLDINGS_HEADERS, plus Coupon and Maturity when the filing holds debt
 * (like the invesco.com bond sheets). A missing number stays empty (never 0), a missing text is '-'; tickers come from
 * nportTickers (U.S. equities only), identifiers are the position's own.
 */
export function nportHoldingsSheet(filing: NportFiling, tickers: ReadonlyArray<string>): { headers: string[]; rows: JsonRecord[] } {
  const debt = filing.positions.some((position) => Boolean(position.maturity) || position.coupon !== null);
  const rows = filing.positions.map((position, index) => ({
    Name: position.name || position.title || '-',
    Ticker: tickers[index] || '-',
    Identifier: nportIdentifier(position) || '-',
    Weight: nportCell(position.weight),
    'Market Value': nportCell(position.value, 2),
    'Shares Held': nportCell(position.balance),
    'Asset Category': position.assetCat || '-',
    ...(debt ? { Coupon: nportCell(position.coupon), Maturity: position.maturity ? formatEdgarDate(position.maturity) : '' } : {}),
  }));
  return { headers: debt ? BOND_SHEET_HEADERS : HOLDINGS_HEADERS, rows };
}

// EDGAR full-text search maps a fund ticker to the registrant that filed its
// N-PORT-P when SEC's fund ticker table does not list it (the filing is then
// matched by the fund name).
export function eftsSearchUrl(query: string): string {
  const params = new URLSearchParams({
    q: `"${query}"`,
    forms: 'NPORT-P',
    dateRange: 'custom',
    start: '0',
    end: String(25),
  });
  return `${SEC_EFTS_HOST}/search-index?${params.toString()}`;
}

export function pickEftsCik(payload: JsonRecord, fundName: string): string | null {
  // EDGAR returns { hits: { hits: [...] } }; older/simplified payloads (and the
  // unit-test fixtures) use a flat { hits: [...] } array.
  const hits: unknown[] = Array.isArray(payload?.hits)
    ? (payload.hits as unknown[])
    : Array.isArray((payload?.hits as JsonRecord)?.hits)
      ? ((payload.hits as JsonRecord).hits as unknown[])
      : [];
  const wanted = normalizeHoldingName(fundName);
  for (const raw of hits) {
    if (!raw || typeof raw !== 'object') continue;
    const hit = raw as JsonRecord;
    const source = (hit._source || {}) as JsonRecord;
    const display = source.display_names;
    // Real payload: display_names is ["NAME  (CIK 0001209466)", ...].
    const names: string[] = Array.isArray(display)
      ? display.map((entry: unknown) => String(entry))
      : Array.isArray((display as JsonRecord)?.names)
        ? ((display as JsonRecord).names as unknown[]).map((entry) => String(entry))
        : [];
    const fromDisplay = names.map((name) => /\(CIK\s*(\d{4,10})\)/i.exec(name)).find(Boolean);
    const ciks: string[] = Array.isArray(source.ciks) ? source.ciks.map((entry: unknown) => String(entry)) : [];
    const rawCik = String((display as JsonRecord)?.cik || fromDisplay?.[1] || ciks[0] || '');
    const cik = rawCik.replace(/\D/g, '').padStart(10, '0');
    if (!cik || cik === '0000000000') continue;
    if (wanted && names.length) {
      const matched = names.some((name) => {
        const normalized = normalizeHoldingName(name.replace(/\(CIK\s*\d+\)/i, ''));
        return normalized && (wanted.includes(normalized) || normalized.includes(wanted));
      });
      if (!matched) continue;
    }
    return cik;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Yahoo chart layer: daily history, distributions, quote meta
// ---------------------------------------------------------------------------

// adjCloseRaw: Yahoo's unrounded value, only used to tell float noise from a real change (never persisted).
export type ChartDay = { date: string; close: number; adjClose: number; volume: number; adjCloseRaw?: number };

export type ParsedChart = {
  exchangeName: string;
  longName: string;
  navPrice: number | null;
  regularMarketPrice: number | null;
  regularMarketTime: number | null;
  firstTradeDate: number | null;
  days: ChartDay[];
  dividends: Array<{ epoch: number; amount: number }>;
};

export function parseChart(payload: JsonRecord): ParsedChart {
  const result = (payload?.chart?.result || [])[0] as JsonRecord | undefined;
  if (!result) throw new Error('chart: empty result');
  const meta = (result.meta || {}) as JsonRecord;
  const timestamps: number[] = result.timestamp || [];
  const quote = ((result.indicators || {}).quote || [])[0] as JsonRecord | undefined;
  const adj = ((result.indicators || {}).adjclose || [])[0] as JsonRecord | undefined;
  const closes: unknown[] = (quote && quote.close) || [];
  const volumes: unknown[] = (quote && quote.volume) || [];
  const adjCloses: unknown[] = (adj && adj.adjclose) || closes;
  const days: ChartDay[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    if (typeof close !== 'number' || !Number.isFinite(close)) continue;
    const adjClose = typeof adjCloses[i] === 'number' && Number.isFinite(adjCloses[i] as number) ? (adjCloses[i] as number) : close;
    days.push({
      date: epochToIsoDate(timestamps[i]),
      close: round(close, 6),
      // Yahoo recomputes the split/dividend-adjusted close on every request;
      // at 6 decimals the last digit or two jitters between otherwise
      // identical requests, making every history row (and the fund) look
      // "updated" on every single run. 2 decimals is well past any
      // meaningful precision for a price and absorbs that jitter.
      adjClose: round(adjClose, 2),
      volume: typeof volumes[i] === 'number' ? (volumes[i] as number) : 0,
      adjCloseRaw: adjClose,
    });
  }
  const events = ((result.events || {}) as JsonRecord).dividends as Record<string, JsonRecord> | undefined;
  const dividends = Object.values(events || {})
    .map((event) => ({ epoch: Number(event.date), amount: Number(event.amount) }))
    .filter((event) => Number.isFinite(event.epoch) && Number.isFinite(event.amount) && event.amount > 0)
    .sort((a, b) => a.epoch - b.epoch);
  return {
    exchangeName: String(meta.fullExchangeName || meta.exchangeName || ''),
    longName: String(meta.longName || meta.shortName || ''),
    navPrice: numberOrNull(meta.navPrice),
    regularMarketPrice: numberOrNull(meta.regularMarketPrice) ?? numberOrNull(meta.previousClose),
    regularMarketTime: numberOrNull(meta.regularMarketTime),
    firstTradeDate: numberOrNull(meta.firstTradeDate),
    days,
    dividends,
  };
}

export function chartUrl(ticker: string, config: Pick<UpdaterConfig, 'historyRange'>, nowMs: number = Date.now()): string {
  // Explicit period1/period2: `range=max` silently downgrades to monthly bars.
  const period2 = Math.floor(nowMs / 1000);
  let period1 = 0; // "max"
  const yearsMatch = /^(\d+)y$/i.exec(config.historyRange.trim());
  if (yearsMatch) period1 = Math.floor(period2 - Number(yearsMatch[1]) * 365.25 * 86_400);
  return `${YAHOO_CHART_URL}/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1d&events=div%7Csplit`;
}

// ---------------------------------------------------------------------------
// Derived catalog metrics (unit-tested helpers, sibling parity)
// ---------------------------------------------------------------------------

// (1 + CAGR)^n - 1 — the exact inverse of annualizing (same helper as SPDR).
export function annualizedToTotal(annualizedPercent: number | null | undefined, years: number): number | null {
  if (typeof annualizedPercent !== 'number' || !Number.isFinite(annualizedPercent)) return null;
  if (years <= 0) return null;
  return round(((1 + annualizedPercent / 100) ** years - 1) * 100, 2);
}

export function totalToAnnualized(totalPercent: number | null | undefined, years: number): number | null {
  if (typeof totalPercent !== 'number' || !Number.isFinite(totalPercent)) return null;
  if (years <= 0) return null;
  return round(((1 + totalPercent / 100) ** (1 / years) - 1) * 100, 2);
}

// Indicated yield: latest distribution x payments per year / price — used only
// when the product list publishes no trailing-12-month yield for the fund.
export function indicatedYield(
  latestDistribution: number | null | undefined,
  paymentsPerYear: number | null | undefined,
  price: number | null | undefined,
): number | null {
  if (typeof latestDistribution !== 'number' || typeof paymentsPerYear !== 'number' || typeof price !== 'number') return null;
  if (!Number.isFinite(latestDistribution) || !Number.isFinite(paymentsPerYear) || !Number.isFinite(price) || price <= 0) return null;
  if (paymentsPerYear <= 0 || latestDistribution <= 0) return null;
  return round(((latestDistribution * paymentsPerYear) / price) * 100, 2);
}

export function inferDistributionFrequency(
  dividends: Array<{ epoch: number; amount: number }>,
): { frequency: string; paymentsPerYear: number | null } {
  if (!dividends.length) return { frequency: 'None', paymentsPerYear: null };
  const recent = dividends.slice(-9);
  if (recent.length < 2) return { frequency: 'Unknown', paymentsPerYear: null };
  const gapsDays: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    const gap = (recent[i].epoch - recent[i - 1].epoch) / 86_400;
    if (gap > 14 && gap < 400) gapsDays.push(gap);
  }
  if (!gapsDays.length) return { frequency: 'Unknown', paymentsPerYear: null };
  gapsDays.sort((a, b) => a - b);
  const medianGap = gapsDays[Math.floor(gapsDays.length / 2)];
  if (medianGap >= 300) return { frequency: 'Annually', paymentsPerYear: 1 };
  if (medianGap >= 150) return { frequency: 'Semiannually', paymentsPerYear: 2 };
  if (medianGap >= 75) return { frequency: 'Quarterly', paymentsPerYear: 4 };
  if (medianGap >= 25) return { frequency: 'Monthly', paymentsPerYear: 12 };
  return { frequency: 'Irregular', paymentsPerYear: null };
}

export type PriceReturns = {
  asOfDate: string;
  ytd: number | null;
  yr1: number | null;
  cagr3y: number | null;
  cagr5y: number | null;
  cagr10y: number | null;
  siAnn: number | null;
  mo1: number | null;
  qtd: number | null;
};

const EMPTY_PRICE_RETURNS: PriceReturns = {
  asOfDate: '', ytd: null, yr1: null, cagr3y: null, cagr5y: null, cagr10y: null, siAnn: null, mo1: null, qtd: null,
};

function pctChange(start: number, end: number): number {
  return round(((end - start) / start) * 100, 2);
}

function annualized(start: number, end: number, years: number): number | null {
  if (start <= 0 || years <= 0) return null;
  return round(((end / start) ** (1 / years) - 1) * 100, 2);
}

// The first close is the fund's own start only when it falls within this many days of the first trade
// (a HISTORY_RANGE=Ny window starts years later, and its since-inception figure would equal cagrNy).
export const INCEPTION_TOLERANCE_DAYS = 10;

// Market-price total returns (adjusted close) anchored to the last trading day
// at or before `now`. Invesco publishes official returns for every fund, so
// these only fill the gaps and drive the History-derived month/quarter blocks.
// `firstTradeIso` is Yahoo's first trade date (or the official inception): siAnn needs the series to start
// there and to span at least one year, a shorter period is never annualized (null, like the official table).
export function priceReturns(days: ChartDay[], now = new Date(), firstTradeIso: string | null = null): PriceReturns {
  const empty: PriceReturns = { ...EMPTY_PRICE_RETURNS };
  if (!days.length) return empty;
  const last = days[days.length - 1];
  const lastEpoch = Date.parse(`${last.date}T00:00:00Z`) / 1000;
  const atOrBefore = (iso: string): ChartDay | null => {
    const target = Date.parse(`${iso}T00:00:00Z`) / 1000;
    if (Number.isNaN(target)) return null;
    let found: ChartDay | null = null;
    for (const day of days) {
      if (Date.parse(`${day.date}T00:00:00Z`) / 1000 <= target) found = day;
      else break;
    }
    return found;
  };
  const yearsAgo = (years: number): ChartDay | null => {
    const date = new Date(now.getTime());
    date.setUTCFullYear(date.getUTCFullYear() - years);
    return atOrBefore(date.toISOString().slice(0, 10));
  };
  const ytdStart = atOrBefore(`${now.getUTCFullYear()}-01-01`);
  const mo1Start = new Date(now.getTime() - 31 * 86_400_000).toISOString().slice(0, 10);
  const quarterStart = `${now.getUTCFullYear()}-${String(Math.floor(now.getUTCMonth() / 3) * 3 + 1).padStart(2, '0')}-01`;
  const year1 = yearsAgo(1);
  const year3 = yearsAgo(3);
  const year5 = yearsAgo(5);
  const year10 = yearsAgo(10);
  const first = days[0];
  const firstEpoch = Date.parse(`${first.date}T00:00:00Z`) / 1000;
  const siYears = (lastEpoch - firstEpoch) / (365.25 * 86_400);
  const firstTradeEpoch = firstTradeIso ? Date.parse(`${firstTradeIso}T00:00:00Z`) / 1000 : Number.NaN;
  const startsAtInception = Number.isFinite(firstTradeEpoch) && firstEpoch - firstTradeEpoch <= INCEPTION_TOLERANCE_DAYS * 86_400;
  const mo1StartDay = atOrBefore(mo1Start);
  const qtdStartDay = atOrBefore(quarterStart);
  return {
    asOfDate: last.date,
    ytd: ytdStart && ytdStart.date < last.date && ytdStart.adjClose > 0 ? pctChange(ytdStart.adjClose, last.adjClose) : null,
    yr1: year1 && year1.date < last.date ? pctChange(year1.adjClose, last.adjClose) : null,
    cagr3y: year3 && year3.date < last.date ? annualized(year3.adjClose, last.adjClose, 3) : null,
    cagr5y: year5 && year5.date < last.date ? annualized(year5.adjClose, last.adjClose, 5) : null,
    cagr10y: year10 && year10.date < last.date ? annualized(year10.adjClose, last.adjClose, 10) : null,
    siAnn: startsAtInception && siYears >= 1 ? annualized(first.adjClose, last.adjClose, siYears) : null,
    mo1: mo1StartDay && mo1StartDay.date < last.date ? pctChange(mo1StartDay.adjClose, last.adjClose) : null,
    qtd: qtdStartDay && qtdStartDay.date < last.date ? pctChange(qtdStartDay.adjClose, last.adjClose) : null,
  };
}

// Newest date of a stored history sheet (rows carry "Oct 01 2026" labels or ISO
// dates) as ISO: the last close a derived return can be attributed to when no
// fresh history was fetched this run.
export function lastHistoryIsoDate(rows: JsonRecord[]): string | null {
  let best: string | null = null;
  for (const row of rows) {
    const iso = calendarIso(row.Date);
    if (iso && (!best || iso > best)) best = iso;
  }
  return best;
}

export function lastCompletedQuarterEnd(now = new Date()): Date {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-based
  if (month <= 2) return new Date(Date.UTC(year - 1, 11, 31)); // Jan-Mar -> Dec 31
  if (month <= 5) return new Date(Date.UTC(year, 2, 31)); // Apr-Jun -> Mar 31
  if (month <= 8) return new Date(Date.UTC(year, 5, 30)); // Jul-Sep -> Jun 30
  return new Date(Date.UTC(year, 8, 30)); // Oct-Dec -> Sep 30
}

export const OFFICIAL_RETURNS_BASIS =
  'official Invesco month-end NAV total returns (invesco.com fund API); periods Invesco does not publish (young funds) are filled from adjusted closes up to the last close (performanceAsOf is the date of the official table, the filled periods end later)';

// A fund without a fresh month-end table (renamed, matured or delisted funds, or a
// failed request) keeps the last official figures that were published; they are
// labelled as not refreshed, never as fresh.
export const STALE_OFFICIAL_RETURNS_BASIS =
  'last published official Invesco NAV total returns (not refreshed in this run: invesco.com provided no month-end table for this fund, for example a renamed or delisted one); periods Invesco did not publish are filled from adjusted closes';

/**
 * `returnsBasis` and `performanceAsOf` (STANDARD.md 9a). Official returns are
 * as of the effective date of Invesco's month-end performance table (null when
 * unknown); derived ones are as of the last close used. Never the NAV date.
 */
export function returnsBasisFields(
  hasOfficial: boolean,
  derivedAsOfDate: string | null | undefined,
  derivedCloseSource = 'Yahoo chart API',
  officialReturnsAsOf: string | null = null,
  officialBasis: string = OFFICIAL_RETURNS_BASIS,
): { returnsBasis: string; performanceAsOf: string | null } {
  const iso = (value: string | null | undefined): string | null => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);
  return hasOfficial
    ? { returnsBasis: officialBasis, performanceAsOf: iso(officialReturnsAsOf) }
    : {
        returnsBasis: `derived from adjusted market-price closes (${derivedCloseSource}), estimates and not official NAV returns`,
        performanceAsOf: iso(derivedAsOfDate),
      };
}

/**
 * Merges the official Invesco returns with the ones derived from adjusted
 * closes. Official figures win wherever they exist (they are NAV total
 * returns — the same basis the sibling apps publish); derived figures fill
 * the gaps for young funds and for funds Invesco lists without returns.
 */
export function deriveCatalogMetrics(
  official: CatalogReturns,
  derived: PriceReturns,
  publishedDividendYield: number | null,
  publishedSecYield: number | null,
  latestDistribution: number | null,
  paymentsPerYear: number | null,
  price: number | null,
  derivedCloseSource = 'Yahoo chart API',
  officialReturnsAsOf: string | null = null,
  officialBasis: string = OFFICIAL_RETURNS_BASIS,
  publishedYieldBasis: YieldBasis | null = null,
): JsonRecord {
  const coalesce = (value: number | null | undefined): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
  const ytd = coalesce(official.ytd) ?? coalesce(derived.ytd);
  const tr1y = coalesce(official.yr1) ?? coalesce(derived.yr1);
  const cagr3y = coalesce(official.yr3) ?? coalesce(derived.cagr3y);
  const cagr5y = coalesce(official.yr5) ?? coalesce(derived.cagr5y);
  const cagr10y = coalesce(official.yr10) ?? coalesce(derived.cagr10y);
  const siAnn = coalesce(official.sinceInception) ?? coalesce(derived.siAnn);
  const published = coalesce(publishedDividendYield);
  const dividendYield = published ?? indicatedYield(latestDistribution, paymentsPerYear, price);
  // A retained yield keeps the code it was published with; a fresh published one is the trailing 12-month rate.
  const dividendYieldBasis: YieldBasis | null = dividendYield === null ? null : published !== null ? (publishedYieldBasis ?? 'official-trailing-12m') : 'indicated';
  const text = (value: number | null): string | null => (value === null ? null : `${value.toFixed(2)}%`);
  return {
    ytd,
    tr1y,
    tr3y: annualizedToTotal(cagr3y, 3),
    tr5y: annualizedToTotal(cagr5y, 5),
    tr10y: annualizedToTotal(cagr10y, 10),
    cagr3y,
    cagr5y,
    cagr10y,
    siAnn,
    dividendYield,
    dividendYieldText: text(dividendYield) ?? '—',
    dividendYieldBasis,
    secYield: coalesce(publishedSecYield),
    secYieldText: text(coalesce(publishedSecYield)) ?? '—',
    ...returnsBasisFields(Object.values(official).some((value) => value !== null), derived.asOfDate, derivedCloseSource, officialReturnsAsOf, officialBasis),
  };
}

// ---------------------------------------------------------------------------
// Eligibility filters (AND logic, iShares semantics)
// ---------------------------------------------------------------------------

function inRange(value: number | null | undefined, range?: Range): boolean {
  if (!range) return true;
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (range.min !== undefined && value < range.min) return false;
  if (range.max !== undefined && value > range.max) return false;
  return true;
}

function annualizedValue(metrics: JsonRecord, period: ReturnPeriod): number | null {
  if (period === 'YTD') return numberOrNull(metrics.ytd);
  if (period === '1Y') return numberOrNull(metrics.tr1y);
  return numberOrNull(metrics[`cagr${period.toLowerCase()}`]);
}

function cumulativeValue(metrics: JsonRecord, period: ReturnPeriod): number | null {
  const key = period === 'YTD' ? 'ytd' : period === '1Y' ? 'tr1y' : `tr${period.toLowerCase()}`;
  return numberOrNull(metrics[key]);
}

function fundFilterReasons(
  candidate: { ticker: string; aumValue?: number | null; terValue?: number | null; metrics: JsonRecord },
  config: UpdaterConfig,
): string[] {
  const reasons: string[] = [];
  if (config.tickers.length && !config.tickers.includes(candidate.ticker)) reasons.push('TICKERS');
  if (config.aumRange && !inRange(candidate.aumValue ?? null, config.aumRange)) reasons.push('AUM');
  if (config.terRange && !inRange(candidate.terValue ?? null, config.terRange)) reasons.push('TER');
  if (config.dividendYieldRange && !inRange(numberOrNull(candidate.metrics.dividendYield), config.dividendYieldRange)) {
    reasons.push('DIVIDEND_YIELD');
  }
  for (const period of RETURN_PERIODS) {
    const performance = config.performanceRanges[period];
    if (performance && !inRange(annualizedValue(candidate.metrics, period), performance)) reasons.push(`PERFORMANCE_${period}`);
    const total = config.totalReturnRanges[period];
    if (total && !inRange(cumulativeValue(candidate.metrics, period), total)) reasons.push(`TOTAL_RETURN_${period}`);
  }
  return reasons;
}

// ---------------------------------------------------------------------------
// Deterministic writers (iShares/SPDR/Fidelity-style)
// ---------------------------------------------------------------------------

// Comparing raw text would treat a run that only refreshed generatedAt (with
// every fund's actual data unchanged) as a real change and rewrite the file
// every time. Compare with both timestamps stripped instead.
export function samePublishedContent(previous: string, value: unknown): boolean {
  const withoutRunTimestamp = (item: unknown): unknown => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const { generatedAt, savedAt, ...content } = item as Record<string, unknown>;
    return content;
  };
  try {
    return JSON.stringify(withoutRunTimestamp(JSON.parse(previous))) === JSON.stringify(withoutRunTimestamp(value));
  } catch { return false; }
}

async function writeIfChanged(file: URL, value: unknown): Promise<boolean> {
  const next = `${JSON.stringify(value, null, 1)}\n`;
  let previous: string | null = null;
  try {
    previous = await readFile(file, 'utf8');
  } catch {
    // First write.
  }
  if (previous === next || (previous !== null && samePublishedContent(previous, value))) return false;
  // tmp file + rename: a killed run leaves the old complete file, never a truncated one
  const tmp = new URL(`${file.href}.${process.pid}.tmp`);
  await writeFile(tmp, next, 'utf8');
  await rename(tmp, file);
  return true;
}

async function writePages(
  dir: URL,
  ticker: string,
  kind: 'holdings' | 'history',
  headers: string[],
  rows: JsonRecord[],
  pageSize: number,
): Promise<{ pages: string[]; pageSize: number; totalRows: number; cleanup: () => Promise<void> }> {
  await mkdir(new URL(`${kind}/`, dir), { recursive: true });
  const pages: string[] = [];
  if (rows.length) {
    const pageCount = Math.ceil(rows.length / pageSize);
    for (let page = 1; page <= pageCount; page++) {
      const slice = rows.slice((page - 1) * pageSize, page * pageSize);
      const name = `${kind}/${pad3(page)}.json`;
      await writeIfChanged(new URL(name, dir), {
        ticker,
        page,
        pageSize,
        totalRows: rows.length,
        headers,
        rows: slice,
      });
      pages.push(name);
    }
  }
  // Stale pages are removed only after the new meta.json is written (see processFund)
  return { pages, pageSize, totalRows: rows.length, cleanup: () => removeStalePages(dir, kind, new Set(pages)) };
}

async function removeStalePages(fundDir: URL, kind: 'holdings' | 'history', kept: Set<string>): Promise<void> {
  const kindDir = new URL(`${kind}/`, fundDir);
  let entries: string[] = [];
  try {
    entries = await readdir(kindDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.endsWith('.json') && !kept.has(`${kind}/${entry}`)) {
      await rm(new URL(entry, kindDir), { force: true });
    }
  }
}

type UpdateState = { cursor: string | null; savedAt: string; scope?: string; partial?: boolean };

async function readUpdateState(): Promise<UpdateState | null> {
  try {
    return JSON.parse(await readFile(STATE_FILE, 'utf8')) as UpdateState;
  } catch {
    return null;
  }
}

/** The run order: only the TICKERS selection (all funds when empty), rotated after the cursor. */
export function runOrder<T extends { ticker: string }>(universe: T[], tickers: string[], cursor: string | null): T[] {
  const selected = universe.filter((fund) => !tickers.length || tickers.includes(fund.ticker));
  const index = cursor ? selected.findIndex((fund) => fund.ticker === cursor) : -1;
  return index >= 0 ? selected.slice(index + 1).concat(selected.slice(0, index + 1)) : selected.slice();
}

/** The filter set a cursor belongs to: a cursor saved for other filters is never reused. */
export function cursorScope(config: UpdaterConfig): string {
  return JSON.stringify([config.tickers, config.aumRange ?? null, config.terRange ?? null, config.dividendYieldRange ?? null, config.performanceRanges, config.totalReturnRanges]);
}

async function writeUpdateState(lastProcessedTicker: string | null, scope: string, partial: boolean): Promise<void> {
  await writeIfChanged(STATE_FILE, {
    cursor: lastProcessedTicker,
    scope,
    partial,
    savedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  });
}

// The published universe: index.json rows plus a row rebuilt from every
// funds/<ticker>/meta.json the index does not list, so no run ever drops a
// fund that has published files.
async function readPreviousIndex(): Promise<Map<string, JsonRecord>> {
  const map = new Map<string, JsonRecord>();
  try {
    const payload = JSON.parse(await readFile(INDEX_FILE, 'utf8')) as JsonRecord;
    for (const fund of payload.funds || []) {
      if (fund && typeof fund.ticker === 'string') map.set(fund.ticker, fund);
    }
  } catch {
    // First run.
  }
  let tickers: string[] = [];
  try {
    tickers = await readdir(new URL('funds/', API_ROOT));
  } catch {
    // No fund files yet.
  }
  for (const ticker of tickers) {
    if (map.has(ticker)) continue;
    const meta = await readPreviousMeta(ticker);
    if (typeof meta.ticker === 'string') map.set(ticker, indexRowFromMeta(meta));
  }
  return map;
}

/** Gives a kept index row the `dividendYieldBasis` key (right after `dividendYieldText`); null exactly when the yield is null. */
export function withYieldBasis(row: JsonRecord, metaYields?: JsonRecord): JsonRecord {
  const metrics = (row.metrics as JsonRecord) || {};
  const hasYield = numberOrNull(metrics.dividendYield) !== null;
  const basis = !hasYield ? null : isYieldBasis(metrics.dividendYieldBasis) ? metrics.dividendYieldBasis : yieldBasisFromKind(metaYields?.dividendYieldKind);
  const next: JsonRecord = {};
  for (const [key, value] of Object.entries(metrics)) {
    if (key === 'dividendYieldBasis') continue;
    next[key] = value;
    if (key === 'dividendYieldText') next.dividendYieldBasis = basis;
  }
  if (!('dividendYieldBasis' in next)) next.dividendYieldBasis = basis;
  return { ...row, metrics: next };
}

export function indexRowFromMeta(meta: JsonRecord): JsonRecord {
  const ticker = String(meta.ticker);
  const returns = (meta.returns as JsonRecord) || {};
  const monthEnd = (returns.monthEnd as JsonRecord) || {};
  const wasDerived = /^(derived|adjusted)/.test(String(returns.returnsBasis ?? ''));
  const official: CatalogReturns = wasDerived
    ? EMPTY_RETURNS
    : {
        ytd: numberOrNull(monthEnd.ytd),
        yr1: numberOrNull(monthEnd.yr1),
        yr3: numberOrNull(monthEnd.yr3),
        yr5: numberOrNull(monthEnd.yr5),
        yr10: numberOrNull(monthEnd.yr10),
        sinceInception: numberOrNull(monthEnd.sinceInception),
      };
  const yields = (meta.yields as JsonRecord) || {};
  const asOf = typeof returns.performanceAsOf === 'string' && !wasDerived ? returns.performanceAsOf : null;
  const metrics = deriveCatalogMetrics(official, EMPTY_PRICE_RETURNS, numberOrNull(yields.dividendYield), numberOrNull(yields.secYield), null, null, null, 'Yahoo chart API', asOf, undefined,
    isYieldBasis(yields.dividendYieldBasis) ? yields.dividendYieldBasis : yieldBasisFromKind(yields.dividendYieldKind));
  const display = (value: unknown): string => (typeof value === 'string' && value ? value : '—');
  const identifiers = (meta.identifiers as JsonRecord) || {};
  return {
    ticker,
    name: String(meta.name ?? ticker),
    category: String(meta.category ?? 'ETF'),
    fundPage: String((meta.source as JsonRecord)?.fundPage ?? invescoProductDetailUrl(ticker)),
    dataFile: `./funds/${ticker}/meta.json`,
    cusip: identifiers.cusip ?? null,
    isin: identifiers.isin ?? null,
    ter: display((meta.expenseRatio as JsonRecord)?.display),
    terValue: numberOrNull((meta.expenseRatio as JsonRecord)?.value),
    terGross: ((meta.expenseRatio as JsonRecord)?.gross as JsonRecord)?.display ?? '—',
    terGrossValue: numberOrNull(((meta.expenseRatio as JsonRecord)?.gross as JsonRecord)?.value),
    nav: display((meta.nav as JsonRecord)?.display),
    navValue: numberOrNull((meta.nav as JsonRecord)?.value),
    aum: display((meta.aum as JsonRecord)?.display),
    aumValue: numberOrNull((meta.aum as JsonRecord)?.value),
    asOfDate: display((meta.nav as JsonRecord)?.asOfDate),
    inceptionDate: '—',
    exchange: '',
    closePrice: display((meta.marketPrice as JsonRecord)?.display),
    closePriceValue: numberOrNull((meta.marketPrice as JsonRecord)?.value),
    premiumDiscount: display((meta.premiumDiscount as JsonRecord)?.display),
    premiumDiscountValue: numberOrNull((meta.premiumDiscount as JsonRecord)?.value),
    distributions: { frequency: String((meta.distributions as JsonRecord)?.frequency ?? '—'), exDate: '—', dividend: '—' },
    returns: { monthEnd, quarterEnd: returns.quarterEnd ?? null },
    metrics,
    holdings: numberOrNull((meta.holdings as JsonRecord)?.totalRows) ?? 0,
    history: numberOrNull((meta.history as JsonRecord)?.totalRows) ?? 0,
  };
}

async function readPreviousSheet(ticker: string, kind: 'holdings' | 'history'): Promise<JsonRecord[]> {
  const rows: JsonRecord[] = [];
  let page = 1;
  for (;;) {
    let payload: JsonRecord;
    try {
      payload = JSON.parse(await readFile(new URL(`funds/${ticker}/${kind}/${pad3(page)}.json`, API_ROOT), 'utf8')) as JsonRecord;
    } catch {
      return rows;
    }
    rows.push(...(payload.rows || []));
    const totalRows = numberOrNull(payload.totalRows);
    if (totalRows !== null && rows.length >= totalRows) return rows;
    if (!(payload.rows || []).length) return rows;
    page += 1;
  }
}

async function readPreviousMeta(ticker: string): Promise<JsonRecord> {
  try {
    return JSON.parse(await readFile(new URL(`funds/${ticker}/meta.json`, API_ROOT), 'utf8')) as JsonRecord;
  } catch {
    return {};
  }
}

async function readPreviousSheetHeaders(ticker: string, kind: 'holdings' | 'history'): Promise<string[]> {
  try {
    const payload = JSON.parse(await readFile(new URL(`funds/${ticker}/${kind}/${pad3(1)}.json`, API_ROOT), 'utf8')) as JsonRecord;
    return Array.isArray(payload.headers) ? (payload.headers as string[]) : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Fund assembly
// ---------------------------------------------------------------------------

// Yahoo's adjusted close is float32 and its last digits move with the request's period2, so a value
// sitting on a cent boundary (16.414998 vs 16.415001) flips between runs. Within that noise the
// published cent is kept: a rerun with the same source data changes nothing.
export const ADJ_CLOSE_NOISE = 1e-4;
export function keepPublishedAdjClose(days: ChartDay[], published: JsonRecord[]): ChartDay[] {
  const adjByDate = new Map<string, number>();
  for (const row of published) {
    const adjClose = numberOrNull(row['Adj Close']);
    if (adjClose !== null) adjByDate.set(String(row.Date), adjClose);
  }
  return days.map((day) => {
    const prior = adjByDate.get(formatEdgarDate(day.date));
    const raw = day.adjCloseRaw ?? day.adjClose;
    return prior !== undefined && prior !== day.adjClose && Math.abs(raw - prior) <= 0.005 + ADJ_CLOSE_NOISE ? { ...day, adjClose: prior } : day;
  });
}

function historyRows(days: ChartDay[]): JsonRecord[] {
  return days.map((day) => ({
    Date: formatEdgarDate(day.date),
    Close: String(day.close),
    'Adj Close': String(day.adjClose),
    Volume: String(day.volume),
  }));
}

// Array rows (not objects): meta.distributions feeds renderDistributionsTable
// directly, same as the sibling worksheet shape.
function distributionRows(dividends: Array<{ epoch: number; amount: number }>): string[][] {
  return dividends.map((dividend) => [formatUsDate(dividend.epoch), String(round(dividend.amount, 6))]);
}

function returnsBlock(
  derived: PriceReturns,
  official: CatalogReturns,
  officialAsOf: string | null,
  previous: JsonRecord,
  derivedCloseSource = 'Yahoo chart API',
  officialLive = true,
): JsonRecord | null {
  const hasOfficial = Object.values(official).some((value) => value !== null);
  const hasDerived = Boolean(derived.asOfDate);
  if (!hasOfficial && !hasDerived) return (previous.returns as JsonRecord) ?? null;
  const text = (value: number | null | undefined): string => (value === null || value === undefined ? '—' : `${value.toFixed(2)}%`);
  const quarterAnchor = lastCompletedQuarterEnd();
  // The month-end block carries the date of its official figures, not the NAV date.
  const asOf = hasOfficial ? officialAsOf : derived.asOfDate;
  return {
    derivedFrom: hasOfficial
      ? `${officialLive ? 'official Invesco month-end returns (invesco.com fund API)' : 'last published official Invesco returns (not refreshed in this run)'}; mo1/qtd derived from adjusted closes (${derivedCloseSource})`
      : `adjusted market-price closes (${derivedCloseSource}), not official NAV returns`,
    monthEnd: {
      asOfDate: asOf ? formatEdgarDate(asOf) : '—',
      // mo1 and qtd are always computed from adjusted closes up to this date, which is
      // later than asOfDate (the official month-end): they must not be read as month-end figures
      priceReturnsAsOf: derived.asOfDate ? formatEdgarDate(derived.asOfDate) : null,
      mo1: derived.mo1,
      mo1Text: text(derived.mo1),
      qtd: derived.qtd,
      qtdText: text(derived.qtd),
      ytd: official.ytd ?? derived.ytd,
      ytdText: text(official.ytd ?? derived.ytd),
      yr1: official.yr1 ?? derived.yr1,
      yr1Text: text(official.yr1 ?? derived.yr1),
      yr3: official.yr3 ?? derived.cagr3y,
      yr3Text: text(official.yr3 ?? derived.cagr3y),
      yr5: official.yr5 ?? derived.cagr5y,
      yr5Text: text(official.yr5 ?? derived.cagr5y),
      yr10: official.yr10 ?? derived.cagr10y,
      yr10Text: text(official.yr10 ?? derived.cagr10y),
      sinceInception: official.sinceInception ?? derived.siAnn,
      sinceInceptionText: text(official.sinceInception ?? derived.siAnn),
    },
    // invesco.com's monthly table is the only official source used, so the quarter-end
    // block carries the anchor date and null figures with the same keys as monthEnd.
    quarterEnd: {
      asOfDate: formatEdgarDate(quarterAnchor.toISOString().slice(0, 10)),
      ytd: null, yr1: null, yr3: null, yr5: null, yr10: null, sinceInception: null,
    },
  };
}

// meta.json repeats the basis and as-of date of the index metrics at the end of its returns block.
export function withReturnsBasis(block: JsonRecord | null, metrics: JsonRecord): JsonRecord | null {
  if (!block) return block;
  const { returnsBasis: _basis, performanceAsOf: _asOf, ...rest } = block;
  return { ...rest, returnsBasis: metrics.returnsBasis, performanceAsOf: metrics.performanceAsOf ?? null };
}

// Fund pages the sitemap discovery already fetched, plus the sitemap's own
// ticker -> canonical page mapping. A ticker the sitemap does not list is
// renamed, matured or delisted: invesco.com no longer publishes it.
type OfficialContext = {
  pageUrls: Map<string, string>;
  pages: Map<string, FundPageInfo>;
  sitemapLoaded: boolean;
  // tickers that received at least one fresh source in this run
  fresh: Set<string>;
  // CUSIP -> every catalog ticker that names it, built once before the fund loop
  cusipTickers: Map<string, string[]>;
};

type OfficialFund = {
  cusip: string;
  url: string;
  page: FundPageInfo | null;
  performance: OfficialPerformance | null;
  prices: OfficialPrices | null;
  yields: OfficialYields | null;
  // the tickers that own this fund's CUSIP now; set for a renamed fund's old ticker
  supersededBy: string | null;
};

async function loadOfficial(fund: CatalogFund, config: UpdaterConfig, ctx: OfficialContext): Promise<OfficialFund | null> {
  const ticker = fund.ticker;
  let url = ctx.pageUrls.get(ticker) ?? null;
  // Without a sitemap the fund page is still reachable through the ?ticker= route.
  if (!url && !ctx.sitemapLoaded) url = isFundPageUrl(fund.fundPage, ticker) ? fund.fundPage : invescoProductDetailUrl(ticker);
  if (!url) {
    outputNote(`[ ${'official'.padEnd(9)}] ${ticker}: not listed by invesco.com any more - keeping the published values`);
    return null;
  }
  let page = ctx.pages.get(ticker) ?? null;
  if (!page) {
    try {
      page = parseFundPageFor(ticker, await fetchText(url, `[ page     ] ${ticker}`, invescoHeaders(), config));
    } catch (error) {
      outputNote(`[ ${'page'.padEnd(9)}] ${ticker}: ${errorMessage(error)}`);
    }
  }
  const cusip = page?.cusip || fund.cusip;
  if (!cusip) return null;
  const official: OfficialFund = { cusip, url, page, performance: null, prices: null, yields: null, supersededBy: null };
  // Every endpoint below is addressed by CUSIP, so a CUSIP shared with another ticker would hand
  // this ticker the other fund's net assets, yields, returns and holdings.
  const others = (ctx.cusipTickers.get(cusip) ?? []).filter((other) => other !== ticker);
  if (others.length) {
    const owns = await ownsCusip(ticker, config);
    // unknown ownership: keep the published values rather than risk the other fund's
    if (owns === null) return null;
    if (!owns) {
      outputNote(`[ ${'official'.padEnd(9)}] ${ticker}: CUSIP ${cusip} belongs to ${others.join(', ')} now (renamed fund) - not listed`);
      return { ...official, supersededBy: others.join(', ') };
    }
  }
  const call = async <T>(label: string, endpoint: Parameters<typeof dngUrl>[1], parse: (payload: JsonRecord) => T): Promise<T | null> => {
    try {
      return parse(await fetchJson(dngUrl(cusip, endpoint), `[ ${label.padEnd(9)}] ${ticker}`, invescoHeaders(), config));
    } catch (error) {
      outputNote(`[ ${label.padEnd(9)}] ${ticker}: ${errorMessage(error)}`);
      return null;
    }
  };
  official.performance = await call('returns', 'performance', parseDngPerformance);
  official.prices = await call('prices', 'prices', parseDngPrices);
  official.yields = await call('yields', 'yields', parseDngYields);
  return official;
}

async function ownsCusip(ticker: string, config: UpdaterConfig): Promise<boolean | null> {
  try {
    const payload: unknown = await fetchJson(dngTickerPricesUrl(ticker), `[ prices   ] ${ticker}`, invescoHeaders(), config);
    return !Array.isArray(payload) || payload.length > 0;
  } catch (error) {
    outputNote(`[ ${'prices'.padEnd(9)}] ${ticker}: ${errorMessage(error)}`);
    return null;
  }
}

// A renamed fund's old ticker carries none of the values addressed by the CUSIP it lost.
function withoutCusipData(fund: CatalogFund): CatalogFund {
  return {
    ...fund,
    nav: null, close: null, premiumDiscount: null, netAssets: null, asOfDate: null,
    dividendYield: null, dividendYieldBasis: null, secYield: null, distributionRate: null,
    returns: EMPTY_RETURNS, returnsAsOf: null,
  };
}

/** The page of exactly this ticker; a renamed fund's old ticker redirects to the new fund's page. */
function parseFundPageFor(ticker: string, html: string): FundPageInfo {
  const page = parseFundPage(html);
  if (!page) throw new Error('not a fund page (no fund facts)');
  if (page.ticker !== ticker) throw new Error(`the page belongs to ${page.ticker}`);
  return page;
}

function applyOfficial(fund: CatalogFund, official: OfficialFund | null): CatalogFund {
  if (!official) return fund;
  const { page, performance, prices, yields } = official;
  const categoryPath = page && (page.assetClass || page.assetSubClass) ? [page.assetClass, page.assetSubClass].filter(Boolean).join(', ') : '';
  // A fund published without a real category (new, or only seeded from a registrant table) gets the page's.
  const placeholderCategory = fund.source === 'seed' || fund.category === 'ETF';
  return {
    ...fund,
    name: page?.name || fund.name,
    category: placeholderCategory && categoryPath ? normalizeInvescoCategory(categoryPath) : fund.category,
    // the page's full path whenever the page is available, so a rerun gives the same meta.json
    categoryPath: categoryPath || fund.categoryPath,
    inception: page?.inception ?? fund.inception,
    exchange: normalizeExchange(fund.exchange || page?.exchange || ''),
    cusip: official.cusip,
    isin: page?.isin || fund.isin,
    benchmark: page?.benchmark || fund.benchmark,
    ter: page ? (page.netTer ?? page.ter ?? fund.ter) : fund.ter,
    terGross: page ? (page.ter ?? page.netTer ?? fund.terGross) : fund.terGross,
    nav: prices ? prices.nav : fund.nav,
    close: prices ? prices.close : fund.close,
    // Recomputed from the fresh NAV and close when both are official.
    premiumDiscount: prices ? null : fund.premiumDiscount,
    netAssets: prices?.netAssets ?? fund.netAssets,
    dividendYield: yields ? yields.dividendYield : fund.dividendYield,
    dividendYieldBasis: yields ? (yields.dividendYield === null ? null : 'official-trailing-12m') : fund.dividendYieldBasis,
    secYield: yields ? yields.secYield : fund.secYield,
    distributionRate: yields ? yields.distributionRate : fund.distributionRate,
    asOfDate: prices?.asOfDate ?? fund.asOfDate,
    returns: performance ? performance.returns : fund.returns,
    returnsAsOf: performance ? performance.asOfDate : fund.returnsAsOf,
    fundPage: official.url,
    source: 'invesco',
  };
}

async function processFund(
  listed: CatalogFund,
  config: UpdaterConfig,
  previous: JsonRecord,
  ctx: OfficialContext,
): Promise<JsonRecord | null> {
  const ticker = listed.ticker;
  if (config.tickers.length && !config.tickers.includes(ticker)) return null;

  // 0) Official fund facts, month-end returns, NAV, net assets and yields from
  //    invesco.com; a fund invesco.com no longer lists keeps its published values.
  const official = config.skipInvesco ? null : await loadOfficial(listed, config, ctx);
  const supersededBy = official?.supersededBy ?? null;
  // Its published values came from the other fund's CUSIP: none of them is retained.
  if (supersededBy) previous = {};
  // A yield retained from an index without the code keeps the meaning its published meta.json gave it.
  const listedWithBasis =
    listed.dividendYield !== null && !listed.dividendYieldBasis
      ? { ...listed, dividendYieldBasis: yieldBasisFromKind(((await readPreviousMeta(ticker)).yields as JsonRecord | undefined)?.dividendYieldKind) }
      : listed;
  const assembled = supersededBy ? withoutCusipData(applyOfficial(listedWithBasis, official)) : applyOfficial(listedWithBasis, official);
  // The shared "younger than one year" rule (calendar anniversary, inclusive; an unknown date keeps the value): invesco.com's
  // since-inception figure is cumulative before the first anniversary, and no 1, 3, 5 or 10-year figure is published before
  // that anniversary, official or derived (below)
  const inception = assembled.inception ?? calendarIso(previous.inceptionDate);
  const fund: CatalogFund = {
    ...assembled,
    returns: withoutYoungReturns(assembled.returns, inception, assembled.returnsAsOf, { yr1: 1, yr3: 3, yr5: 5, yr10: 10, sinceInception: 1 }),
  };
  // meta.json-only fields of a kept fund (holdings and history dates, distribution rows, sources) come from its own
  // meta.json: the index row carries counts and display strings under the same keys
  const previousMeta: JsonRecord = supersededBy ? {} : await readPreviousMeta(ticker);
  // Lifecycle: a fund the loaded sitemap no longer lists (matured, renamed, delisted) stays in the
  // feed with its last values but is marked listed: false. Without a sitemap the status is unknown
  // and the previous one is kept.
  const sitemapSaysMissing = !config.skipInvesco && ctx.sitemapLoaded && !ctx.pageUrls.has(ticker);
  const isListed = supersededBy || sitemapSaysMissing ? false : !config.skipInvesco && ctx.sitemapLoaded ? true : previous.listed !== false;

  // Filters run against the fresh official values (or the published ones when
  // invesco.com has none) before the heavier downloads happen.
  const preMetrics = deriveCatalogMetrics(
    fund.returns,
    EMPTY_PRICE_RETURNS,
    fund.dividendYield,
    fund.secYield,
    null,
    null,
    fund.close,
    undefined,
    null,
    undefined,
    fund.dividendYieldBasis,
  );
  const reasons = fundFilterReasons(
    { ticker, aumValue: fund.netAssets ?? numberOrNull(previous.aumValue), terValue: fund.ter ?? numberOrNull(previous.terValue), metrics: preMetrics },
    config,
  );
  if (reasons.length) {
    return null;
  }

  const fundDir = new URL(`funds/${ticker}/`, API_ROOT);
  // A fund with no published meta.json that got no fresh source in this run is not given a hollow
  // meta.json or empty pages: its row keeps dataFile null and the counts as published.
  const hasPublishedMeta = typeof (await readPreviousMeta(ticker)).ticker === 'string';

  // 1) Daily holdings from the invesco.com API; SEC Form N-PORT-P as the fallback.
  let holdings: ParsedHoldings | null = null;
  let holdingsSource = supersededBy
    ? `none: the fund's CUSIP belongs to ${supersededBy} now`
    : 'invesco.com fund holdings API (dng-api.invesco.com)';
  let holdingsEdgar: NportFiling | null = null;
  if (official && !supersededBy) {
    try {
      holdings = parseDngHoldings(await fetchJson(dngUrl(official.cusip, 'holdings'), `[ holdings ] ${ticker}`, invescoHeaders(), config), ticker);
    } catch (error) {
      outputNote(`[ ${'holdings'.padEnd(9)}] ${ticker}: ${errorMessage(error)}${config.edgarFallback ? ' — trying SEC EDGAR N-PORT-P' : ''}`);
    }
  }

  // A fresh official holdings sheet is never replaced by an older quarterly filing
  // just because one API request failed: the previous official sheet stays.
  const previousHoldingsSource = String((previousMeta.holdings as JsonRecord | undefined)?.source ?? '');
  const keepPreviousOfficial = previousHoldingsSource.startsWith('invesco.com');
  if (!holdings && config.edgarFallback && !config.skipInvesco && !keepPreviousOfficial && !supersededBy) {
    try {
      // the fund's own newest filing (its series id, else its name), read only when strictly newer than the published
      // holdings (shared nport-reader block)
      const wanted = await nportFund(fund, config);
      const read: NportRead = wanted
        ? await readNportHoldings(wanted, { asOf: (previousMeta.holdings as JsonRecord | undefined)?.asOfDate, rows: numberOrNull((previousMeta.holdings as JsonRecord | undefined)?.totalRows) ?? 0 }, (url, label) => fetchText(url, `[ nport    ] ${label}`, secHeaders(config), config), { cache: secState.reader })
        : { problem: `${ticker}: no registrant CIK in the SEC fund ticker table or the EDGAR full-text search` };
      if ('problem' in read) outputNote(`[ ${'edgar'.padEnd(9)}] ${read.problem}`);
      else {
        let names: Map<string, string> | null = null;
        try {
          names = await loadCompanyNames(config);
        } catch (error) {
          outputNote(`[ ${'edgar'.padEnd(9)}] company ticker table: ${errorMessage(error)} - N-PORT tickers only from the filing`);
        }
        const sheet = nportHoldingsSheet(read.filing, nportTickers(read.filing.positions, names));
        if (read.loose) outputNote(`[ ${'edgar'.padEnd(9)}] ${ticker}: ${read.candidate.accession} matched by a partial name ("${read.filing.seriesName}")`);
        holdingsEdgar = read.filing;
        holdings = { asOfDate: read.filing.repPdDate || null, headers: sheet.headers, rows: sheet.rows };
        holdingsSource = `SEC EDGAR Form N-PORT-P (accession ${read.candidate.accession}, report period ${read.filing.repPdDate || 'n/a'})`;
      }
    } catch (error) {
      outputNote(`[ ${'edgar'.padEnd(9)}] ${ticker}: ${errorMessage(error)} — keeping previous holdings`);
    }
  }



  const hasFresh = Boolean(official?.performance || official?.prices || official?.yields || holdings);
  // a kept N-PORT sheet loses the equity tickers its debt rows were given before the shared reader (BSCP: Visa notes as V)
  const holdingsRows: JsonRecord[] = holdings
    ? holdings.rows
    : supersededBy
      ? []
      : previousHoldingsSource.startsWith('SEC EDGAR')
        ? withoutNportDebtTickers(await readPreviousSheet(ticker, 'holdings'))
        : await readPreviousSheet(ticker, 'holdings');
  const holdingsHeaders = holdings?.headers.length
    ? holdings.headers
    : (await readPreviousSheetHeaders(ticker, 'holdings')) || HOLDINGS_HEADERS;
  // kept rows keep the date and the source label they were published with (an N-PORT sheet stays N-PORT)
  if (!holdings && !supersededBy && previousHoldingsSource) holdingsSource = previousHoldingsSource;
  const holdingsAsOf = holdings?.asOfDate || (((previousMeta.holdings as JsonRecord)?.asOfDate as string) ?? null);
  // Fresh holdings (invesco.com API or N-PORT) that look broken (no weight column, non-numeric weights, a bad weight
  // sum, half the rows gone) never replace the published ones: the fund fails and keeps its previous complete state.
  // `holdings` is null when the rows above are the previous run's sheet, which is never checked again.
  if (holdings) {
    const previousRows = numberOrNull(((await readPreviousMeta(ticker)).holdings as JsonRecord | undefined)?.totalRows);
    // a published sheet with numeric weights is never replaced by one without any, whatever is relaxed (open-items etfs Q24)
    const publishedHeaders = hasPublishedMeta ? await readPreviousSheetHeaders(ticker, 'holdings') : [];
    const publishedWeights = hasPublishedMeta ? holdingsWeightCount(publishedHeaders.length ? publishedHeaders : HOLDINGS_HEADERS, await readPreviousSheet(ticker, 'holdings')) : null;
    const holdingsProblem = holdingsGuard(holdings.headers, holdings.rows, previousRows, HOLDINGS_GUARD_RELAX[ticker] ?? HOLDINGS_GUARD_RELAX['*'] ?? [], publishedWeights);
    if (holdingsProblem) throw new Error(`holdings guard: ${holdingsProblem}; ${hasPublishedMeta ? 'kept the previous complete data' : 'no data published for this fund yet'}`);
  }

  // 2) Yahoo chart: daily history, dividends, exchange and the live quote (the
  //    only public source for these; invesco.com publishes NAV, not closes).
  let chartDays: ChartDay[] = [];
  let dividends: Array<{ epoch: number; amount: number }> = [];
  let exchangeName = '';
  let navFromChart: number | null = null;
  let priceFromChart: number | null = null;
  let marketTime: number | null = null;
  let firstTradeDate: number | null = null;
  const historySource = 'Yahoo Finance public chart API (adjusted close)';

  if (!config.skipYahoo) {
    try {
      const fetched = parseChart(await fetchJson(chartUrl(ticker, config), `[ chart    ] ${ticker}`, yahooHeaders(), config));
      // A HISTORY_RANGE window never shrinks the published history (and with it 3y, 5y, 10y and since inception)
      const publishedDistributionRows = ((previousMeta.distributions as JsonRecord | undefined)?.rows as unknown[] | undefined) ?? [];
      const chart = supersededBy ? fetched : mergeWindowedChart(fetched, await readPreviousSheet(ticker, 'history'), publishedDistributionRows);
      if (!chart) throw new Error(`chart window does not join the published history (${config.historyRange})`);
      exchangeName = chart.exchangeName;
      // Yahoo's own navPrice estimate only fills the gap when invesco.com
      // supplied no NAV for this fund.
      navFromChart = chart.navPrice;
      priceFromChart = chart.regularMarketPrice;
      marketTime = chart.regularMarketTime;
      firstTradeDate = chart.firstTradeDate;
      dividends = chart.dividends;
      chartDays = chart.days;
    } catch (error) {
      outputNote(`[ ${'chart'.padEnd(9)}] ${ticker}: ${errorMessage(error)} — keeping previous history`);
    }
  }

  const haveFreshHistory = chartDays.length > 0;
  if (haveFreshHistory) chartDays = keepPublishedAdjClose(chartDays, await readPreviousSheet(ticker, 'history'));
  const persist = hasFresh || haveFreshHistory || hasPublishedMeta;
  const emptyPages = (pageSize: number) => ({ pages: [] as string[], pageSize, totalRows: 0, cleanup: async () => {} });
  if (persist) await mkdir(fundDir, { recursive: true });
  const { cleanup: cleanHoldingsPages, ...holdingsManifest } = persist
    ? await writePages(fundDir, ticker, 'holdings', holdingsHeaders, holdingsRows, config.holdingsPageSize)
    : emptyPages(config.holdingsPageSize);
  // siAnn is derived only from a series that starts at the first trade (HISTORY_RANGE=max), never from a window
  // and, like the official figures, no horizon the fund is too young for (an older Yahoo series never lends it one)
  const derived = haveFreshHistory
    ? withoutYoungReturns(priceReturns(chartDays, new Date(), firstTradeDate !== null ? epochToIsoDate(firstTradeDate) : fund.inception), inception, chartDays[chartDays.length - 1].date, { yr1: 1, cagr3y: 3, cagr5y: 5, cagr10y: 10, siAnn: 1 })
    : EMPTY_PRICE_RETURNS;
  const latestDividend = dividends.length ? dividends[dividends.length - 1] : null;
  const frequency = dividends.length
    ? inferDistributionFrequency(dividends)
    : { frequency: String((previous.distributions as JsonRecord)?.frequency || '—'), paymentsPerYear: null };
  const derivedCloseSource = 'Yahoo chart API';
  // True when this run read the month-end table from invesco.com (not the published copy).
  const officialLive = Boolean(official?.performance);

  if (supersededBy || official?.performance || official?.prices || official?.yields || holdings || haveFreshHistory) ctx.fresh.add(ticker);
  const metrics = deriveCatalogMetrics(
    fund.returns,
    derived,
    fund.dividendYield,
    fund.secYield,
    latestDividend ? latestDividend.amount : null,
    frequency.paymentsPerYear,
    official?.prices?.close ?? priceFromChart ?? fund.close,
    derivedCloseSource,
    fund.returnsAsOf,
    officialLive ? OFFICIAL_RETURNS_BASIS : STALE_OFFICIAL_RETURNS_BASIS,
    fund.dividendYieldBasis,
  );

  const historyHeaders = ['Date', 'Close', 'Adj Close', 'Volume'];
  const history = haveFreshHistory ? historyRows(chartDays) : await readPreviousSheet(ticker, 'history');
  const { cleanup: cleanHistoryPages, ...historyManifest } = (persist
    ? await writePages(fundDir, ticker, 'history', historyHeaders, history, config.historyPageSize)
    : emptyPages(config.historyPageSize));
  // Derived returns without a fresh chart still belong to the newest stored close.
  if (metrics.performanceAsOf == null && /^derived/.test(String(metrics.returnsBasis))) {
    metrics.performanceAsOf = lastHistoryIsoDate(history);
  }
  const distributions = dividends.length ? distributionRows(dividends) : (((previousMeta.distributions as JsonRecord | undefined)?.rows as string[][] | undefined) || []);

  // Without fresh invesco.com facts the filed N-PORT-P series name is the
  // most authoritative fund name available.
  const name =
    (fund.source !== 'invesco' && holdingsEdgar?.seriesName) || fund.name || String(previous.name ?? '') || ticker;
  // Official NAV and close share one date; otherwise the Yahoo quote is the
  // fresher value and the published one the last resort.
  const nav = official?.prices?.nav ?? navFromChart ?? fund.nav;
  const price = official?.prices?.close ?? priceFromChart ?? fund.close;
  const premiumDiscount = nav && price ? round(((price - nav) / nav) * 100, 2) : fund.premiumDiscount;
  // Fresh invesco.com net assets win; when invesco.com has none, the N-PORT-P
  // net assets of the filing we just parsed are the authoritative number.
  const nportTotal = holdingsEdgar ? holdingsEdgar.positions.reduce((sum, position) => sum + (position.value ?? 0), 0) : 0;
  const nportNetAssets = holdingsEdgar ? holdingsEdgar.netAssets ?? (nportTotal ? round(nportTotal, 2) : null) : null;
  const catalogNetAssets = official?.prices?.netAssets ?? null;
  const netAssets = catalogNetAssets ?? nportNetAssets ?? fund.netAssets ?? numberOrNull(previous.aumValue);
  const returnsData = returnsBlock(derived, fund.returns, fund.returnsAsOf, previous, derivedCloseSource, officialLive);
  const asOfLabel = fund.asOfDate ? formatEdgarDate(fund.asOfDate) : marketTime ? formatEpochDate(marketTime) : '—';

  const apiCusip = supersededBy ? '' : fund.cusip;
  const meta: JsonRecord = {
    ticker,
    name,
    listed: isListed,
    category: fund.category,
    categoryPath: fund.categoryPath,
    source: {
      fundPage: fund.fundPage,
      holdingsApi: apiCusip ? dngUrl(apiCusip, 'holdings') : null,
      performanceApi: apiCusip ? dngUrl(apiCusip, 'performance') : null,
      pricesApi: apiCusip ? dngUrl(apiCusip, 'prices') : null,
      yieldsApi: apiCusip ? dngUrl(apiCusip, 'yields') : null,
      // A stable provenance URL, not the live fetch URL: chartUrl(ticker, config)
      // embeds the current timestamp in period2, which would make this field
      // (and the file's digest) change on every single run.
      yahooChart: `${YAHOO_CHART_URL}/${encodeURIComponent(ticker)}`,
      holdingsSource,
      historySource,
      provider: 'invesco.com fund pages and fund API + Yahoo Finance public chart API',
    },
    identifiers: { cusip: fund.cusip || null, isin: fund.isin || null, indexTicker: fund.benchmark || null },
    expenseRatio: {
      display: fund.ter === null ? '—' : `${fund.ter}%`,
      value: fund.ter,
      gross: fund.terGross === null ? null : { display: `${fund.terGross}%`, value: fund.terGross },
    },
    nav: { display: nav === null ? '—' : `$${nav.toFixed(2)}`, value: nav, asOfDate: asOfLabel },
    marketPrice: { display: price === null ? '—' : `$${price.toFixed(2)}`, value: price, asOfDate: asOfLabel },
    premiumDiscount: { display: premiumDiscount === null ? '—' : `${premiumDiscount.toFixed(2)}%`, value: premiumDiscount },
    aum: {
      display: netAssets === null ? '—' : formatAumDisplay(netAssets),
      value: netAssets,
      asOfDate: official?.prices?.asOfDate && catalogNetAssets !== null
        ? formatEdgarDate(official.prices.asOfDate)
        : nportNetAssets !== null && holdingsEdgar?.repPdDate
          ? formatEdgarDate(holdingsEdgar.repPdDate)
          : (((previousMeta.aum as JsonRecord)?.asOfDate as string) ?? '—'),
      source:
        catalogNetAssets !== null
          ? 'Invesco fund API prices endpoint (net assets / market value)'
          : nportNetAssets !== null
            ? `SEC Form N-PORT-P net assets (report period ${holdingsEdgar?.repPdDate || 'n/a'})`
            // the net assets of a kept N-PORT filing (not newer than the published one) keep their label with their date
            : /^SEC Form N-PORT-P/.test(String((previousMeta.aum as JsonRecord | undefined)?.source ?? ''))
              ? String((previousMeta.aum as JsonRecord).source)
              : 'previous run',
    },
    yields: {
      dividendYield: metrics.dividendYield,
      dividendYieldText: metrics.dividendYieldText,
      dividendYieldBasis: metrics.dividendYieldBasis,
      dividendYieldKind: YIELD_BASIS_KIND[(metrics.dividendYieldBasis as YieldBasis | null) ?? 'indicated'],
      distributionRate: fund.distributionRate,
      secYield: fund.secYield,
      secYieldText: fund.secYield === null ? '—' : `${fund.secYield.toFixed(2)}%`,
      secYieldKind: '30-day SEC yield as published by invesco.com (fixed income funds; most equity funds publish none)',
    },
    returns: withReturnsBasis(returnsData, metrics),
    distributions: { frequency: frequency.frequency, paymentsPerYear: frequency.paymentsPerYear, headers: ['Ex-Date', 'Amount'], rows: distributions },
    holdings: {
      ...holdingsManifest,
      asOfDate: holdingsAsOf,
      asOf: holdingsAsOf ? formatEdgarDate(holdingsAsOf) : '—',
      source: holdingsSource,
    },
    history: {
      ...historyManifest,
      asOf: derived.asOfDate ? formatEdgarDate(derived.asOfDate) : (((previousMeta.history as JsonRecord)?.asOf as string) ?? '—'),
      source: haveFreshHistory ? historySource : 'previous run',
    },
  };
  if (persist) await writeIfChanged(new URL('meta.json', fundDir), meta);
  await cleanHoldingsPages();
  await cleanHistoryPages();

  const monthEnd = ((returnsData as JsonRecord)?.monthEnd as JsonRecord) || {};
  return {
    ticker,
    name,
    listed: isListed,
    category: fund.category,
    fundPage: fund.fundPage,
    dataFile: persist ? `./funds/${ticker}/meta.json` : null,
    cusip: fund.cusip || null,
    isin: fund.isin || null,
    ter: fund.ter === null ? '—' : `${fund.ter}%`,
    terValue: fund.ter,
    terGross: fund.terGross === null ? '—' : `${fund.terGross}%`,
    terGrossValue: fund.terGross,
    nav: nav === null ? '—' : `$${nav.toFixed(2)}`,
    navValue: nav,
    aum: netAssets === null ? '—' : formatAumDisplay(netAssets),
    aumValue: netAssets,
    asOfDate: fund.asOfDate ? formatEdgarDate(fund.asOfDate) : (previous.asOfDate || '—'),
    inceptionDate: fund.inception
      ? formatEdgarDate(fund.inception)
      : firstTradeDate
        ? formatEpochDate(firstTradeDate)
        : (previous.inceptionDate || '—'),
    exchange: normalizeExchange(fund.exchange || exchangeName || (previous.exchange || '')),
    closePrice: price === null ? '—' : `$${price.toFixed(2)}`,
    closePriceValue: price,
    premiumDiscount: premiumDiscount === null ? '—' : `${premiumDiscount.toFixed(2)}%`,
    premiumDiscountValue: premiumDiscount,
    distributions: {
      frequency: frequency.frequency,
      exDate: latestDividend ? formatUsDate(latestDividend.epoch) : '—',
      dividend: latestDividend ? String(round(latestDividend.amount, 6)) : '—',
    },
    returns: { monthEnd, quarterEnd: ((returnsData as JsonRecord)?.quarterEnd as JsonRecord) || null },
    metrics,
    // counts stay as published while the sheets could not be refreshed and no pages exist to count
    holdings: holdings || holdingsRows.length ? holdingsRows.length : numberOrNull(previous.holdings) ?? 0,
    history: haveFreshHistory || history.length ? history.length : numberOrNull(previous.history) ?? 0,
  };
}

// One run's SEC state for the EDGAR fallback: SEC's fund ticker table (ticker -> registrant CIK + series id) and its
// company name table (N-PORT row tickers), each loaded once; the registrant CIKs found through the EDGAR full-text
// search for funds the table does not list; the shared N-PORT reader cache (submissions and documents).
let secState: {
  funds: Promise<Map<string, NportSeriesRef>> | null;
  names: Promise<Map<string, string>> | null;
  ciks: Map<string, Promise<string | null>>;
  reader: Map<string, unknown>;
} = { funds: null, names: null, ciks: new Map(), reader: new Map() };

/** A fresh SEC state for a run (runUpdater and tests). */
export function resetSecState(): void {
  secState = { funds: null, names: null, ciks: new Map(), reader: new Map() };
}

/** SEC's ticker -> registrant CIK + series id table, loaded once per run (a failed load is asked again by the next fund). */
function loadFundTickerTable(config: UpdaterConfig): Promise<Map<string, NportSeriesRef>> {
  if (!secState.funds) {
    const loading = fetchJson(SEC_FUND_TICKERS_URL, '[ edgar    ] fund ticker table', secHeaders(config), config).then((payload) => parseSecFundTickers(payload));
    secState.funds = loading;
    loading.catch(() => { if (secState.funds === loading) secState.funds = null; });
  }
  return secState.funds;
}

/** SEC's company name -> ticker table for the N-PORT rows, loaded once per run. */
function loadCompanyNames(config: UpdaterConfig): Promise<Map<string, string>> {
  if (!secState.names) {
    const loading = fetchJson(SEC_COMPANY_TICKERS_URL, '[ edgar    ] company ticker table', secHeaders(config), config).then((payload) => parseSecCompanyNames(payload));
    secState.names = loading;
    loading.catch(() => { if (secState.names === loading) secState.names = null; });
  }
  return secState.names;
}

/**
 * The fund as the N-PORT reader needs it: registrant CIK and series id from SEC's fund ticker table; a fund the table does
 * not list gets the registrant from the EDGAR full-text search and no series id, so the reader matches the filing by the
 * fund name. Null when no registrant is known.
 */
async function nportFund(fund: CatalogFund, config: UpdaterConfig): Promise<{ ticker: string; cik: string; seriesId: string | null; name: string } | null> {
  let table: Map<string, NportSeriesRef> | null = null;
  try {
    table = await loadFundTickerTable(config);
  } catch (error) {
    outputNote(`[ ${'edgar'.padEnd(9)}] fund ticker table: ${errorMessage(error)} - falling back to full-text search`);
  }
  const ref = table ? table.get(fund.ticker) : undefined;
  if (ref) return { ticker: fund.ticker, cik: ref.cik, seriesId: ref.seriesId, name: fund.name };
  let lookup = secState.ciks.get(fund.ticker);
  if (!lookup) {
    lookup = fund.trustCik
      ? Promise.resolve(fund.trustCik)
      : fetchJson(eftsSearchUrl(fund.ticker), `[ edgar    ] search ${fund.ticker}`, secHeaders(config), config).then((payload) => pickEftsCik(payload, fund.name));
    secState.ciks.set(fund.ticker, lookup);
  }
  try {
    const cik = await lookup;
    return cik ? { ticker: fund.ticker, cik, seriesId: null, name: fund.name } : null;
  } catch (error) {
    outputNote(`[ ${'edgar'.padEnd(9)}] search ${fund.ticker}: ${errorMessage(error)}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// The sitemap lists the canonical page of every live US ETF. Pages already known
// from the published feed need no request here; unknown ones (new funds, or the
// first run after the old guessed page URLs) are fetched to learn their ticker.
async function discoverOfficialFunds(config: UpdaterConfig, catalog: Map<string, CatalogFund>, ctx: OfficialContext): Promise<number> {
  let urls: string[] = [];
  try {
    urls = parseSitemapFundPages(await fetchText(config.sitemapUrl, '[catalog ] sitemap', invescoHeaders(), config));
  } catch (error) {
    console.warn(`[ catalog  ] ${errorMessage(error)} - keeping the published universe`);
    return 0;
  }
  if (!urls.length) {
    console.warn('[ catalog  ] the sitemap lists no fund pages - keeping the published universe');
    return 0;
  }
  ctx.sitemapLoaded = true;
  const knownPages = new Map<string, string>();
  for (const fund of catalog.values()) if (isFundPageUrl(fund.fundPage, fund.ticker)) knownPages.set(fund.fundPage, fund.ticker);
  const unknown: string[] = [];
  for (const url of urls) {
    const ticker = knownPages.get(url);
    if (ticker) {
      if (!ctx.pageUrls.has(ticker)) ctx.pageUrls.set(ticker, url);
    } else {
      unknown.push(url);
    }
  }
  // A run limited to tickers whose pages are already known needs no discovery.
  if (!unknown.length || (config.tickers.length && config.tickers.every((ticker) => ctx.pageUrls.has(ticker) || closedFund(CLOSED_FUNDS, ticker)))) return 0;
  let added = 0;
  const queue = unknown.slice();
  await Promise.all(
    Array.from({ length: Math.max(1, config.concurrency) }, async () => {
      for (let url = queue.shift(); url; url = queue.shift()) {
        try {
          const page = parseFundPage(await fetchText(url, '[ catalog ] fund page', invescoHeaders(), config));
          if (!page) continue;
          ctx.pages.set(page.ticker, ctx.pages.get(page.ticker) ?? page);
          if (!ctx.pageUrls.has(page.ticker)) ctx.pageUrls.set(page.ticker, url);
          if (!catalog.has(page.ticker)) {
            catalog.set(page.ticker, catalogFundFromPage(page, url));
            added += 1;
          }
        } catch (error) {
          outputNote(`[ ${'catalog'.padEnd(9)}] ${url}: ${errorMessage(error)}`);
        }
      }
    }),
  );
  return added;
}

function catalogFundFromPage(page: FundPageInfo, url: string): CatalogFund {
  const categoryPath = [page.assetClass, page.assetSubClass].filter(Boolean).join(', ');
  return {
    ...catalogFundFromIndex(page.ticker, { name: page.name, fundPage: url }),
    category: normalizeInvescoCategory(categoryPath),
    categoryPath: categoryPath || 'ETF',
    cusip: page.cusip,
    isin: page.isin,
    ter: page.netTer ?? page.ter,
    terGross: page.ter ?? page.netTer,
    source: 'seed',
  };
}

export async function runUpdater(config: UpdaterConfig): Promise<void> {
  requestSleepMs = Math.max(0, config.requestSleep) * 1000;
  nextRequestAtLanes = new Array(Math.max(1, config.concurrency)).fill(0);
  resetSecState();
  const startedAt = Date.now();
  const deadlineAt = startedAt + softDeadlineMs;

  outputPrintConfig('Invesco', config);

  // 1) Catalog: every fund already published (index rows plus funds/*/meta.json,
  //    so a filtered run never shrinks the feed) and every fund the invesco.com
  //    sitemap lists.
  const catalog = new Map<string, CatalogFund>();
  const previousIndex = await readPreviousIndex();
  for (const [ticker, row] of previousIndex) catalog.set(ticker, catalogFundFromIndex(ticker, row));
  let catalogSource = 'published feed';

  const ctx: OfficialContext = { pageUrls: new Map(), pages: new Map(), sitemapLoaded: false, fresh: new Set(), cusipTickers: new Map() };
  if (!config.skipInvesco) {
    const discovered = await discoverOfficialFunds(config, catalog, ctx);
    if (ctx.sitemapLoaded) catalogSource = `published feed + invesco.com sitemap (${ctx.pageUrls.size} fund pages${discovered ? `, ${discovered} new` : ''})`;
  }
  // Renamed funds leave before anything else: never fetched, never in the index, their folder is removed after the index
  const renamedAway = dropRenamedFunds(catalog, RENAMED_FUNDS);
  if (renamedAway.length) {
    console.log(`[ ${'renamed'.padEnd(9)}] ${renamedAway.map((ticker) => `${ticker} -> ${renamedFund(RENAMED_FUNDS, ticker)?.renamedTo}`).join(', ')}: renamed by the issuer, old ticker removed`);
  }
  // The live catalog is the loaded sitemap (null without one): a catalog-only row (no published data) it no longer lists, for
  // example an old mistyped TICKERS entry, is dropped, never retried (open-items etfs Q27)
  const live = ctx.sitemapLoaded ? Array.from(ctx.pageUrls.keys()) : null;
  const previousRows = Array.from(previousIndex.values());
  const current = withoutStalePlaceholders(previousRows, live).map((row) => String(row.ticker));
  for (const row of previousRows) if (current.indexOf(String(row.ticker)) < 0) catalog.delete(String(row.ticker));
  // Q27: a TICKERS entry outside the live catalog and the published funds stops the run before any fund request
  assertKnownTickers(config.tickers.length ? config.tickers : null, knownTickers(live, previousRows), 'the Invesco catalog (invesco.com sitemap) or published feed');
  for (const fund of catalog.values()) {
    const cusip = ctx.pages.get(fund.ticker)?.cusip || fund.cusip;
    if (cusip) ctx.cusipTickers.set(cusip, [...(ctx.cusipTickers.get(cusip) ?? []), fund.ticker]);
  }

  const universe = [...catalog.values()].sort((a, b) => (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0));
  if (!universe.length) {
    console.log(
      '[ done     ] nothing to do: the invesco.com sitemap is unreachable and the published ' +
        'api/invesco/index.json is empty or missing - run this where invesco.com resolves, e.g. ' +
        'the "Update Invesco ETF data" GitHub Actions workflow',
    );
    return;
  }
  console.log(`[ ${'catalog'.padEnd(9)}] ${universe.length} Invesco ETFs (${catalogSource})`);

  // 2) Bounded, resumable batch run over the catalog (iShares/SPDR cursor).
  // A TICKERS run never reads, writes or deletes the cursor (First-Trust rule).
  const useCursor = config.tickers.length === 0;
  const state = useCursor ? await readUpdateState() : null;
  // A plain `bun ./scripts/update-data.ts` (no MAX_FETCHES) always walks the
  // whole catalog from the top and clears the cursor afterwards; the saved
  // cursor only rotates the queue for explicitly bounded batch runs, exactly
  // like the sibling SPDR / iShares updaters.
  // The cursor also resumes a run that stopped at the soft deadline, and is only
  // used for the same filter set it was saved for.
  const scope = cursorScope(config);
  const cursor = (config.maxFetches > 0 || state?.partial === true) && state?.scope === scope ? state?.cursor || null : null;
  // Closed funds leave the run before any request or MAX_FETCHES slot: never fetched, guarded or reported.
  const ordered = withoutClosedFunds(runOrder(universe, config.tickers, cursor), (fund) => fund.ticker, CLOSED_FUNDS);

  const queue = ordered.map((fund) => ({ fund }));
  const results: JsonRecord[] = [];
  // New funds (no published row or meta.json) whose refresh failed, e.g. holdings rejected by the guard: catalog-only rows.
  const catalogOnly: JsonRecord[] = [];
  // MAX_FETCHES counts only funds that pass the filters; funds a filter rejects are
  // examined (and move the cursor) but cost no batch slot.
  let passed = 0;
  let pending = 0;
  let started = 0;
  let deadlineHit = false;
  let failures = 0;

  outputPrintFilter(ordered.length, universe.length, outputHasOutputFilters({ ...config, tickers: [] }));
  const reporter = outputCreateReporter(API_ROOT, config.maxFetches > 0 ? Math.min(config.maxFetches, ordered.length) : ordered.length);
  async function worker(): Promise<void> {
    for (;;) {
      // never start more funds than the batch still needs: wait for in-flight ones to resolve
      while (config.maxFetches > 0 && passed + pending >= config.maxFetches) {
        if (pending === 0) return;
        await sleep(5);
      }
      if (Date.now() > deadlineAt) {
        deadlineHit = true;
        return;
      }
      const item = queue.shift();
      if (!item) return;
      started += 1;
      pending += 1;
      const before = await reporter.before(item.fund.ticker);
      try {
        const row = await processFund(item.fund, config, previousIndex.get(item.fund.ticker) || {}, ctx);
        if (row) {
          results.push(row);
          passed += 1;
        }
        await reporter.result(item.fund.ticker, before, row ? undefined : 'skipped');
      } catch (error) {
        failures += 1;
        if (!previousIndex.has(item.fund.ticker)) {
          const listed = config.skipInvesco || !ctx.sitemapLoaded || ctx.pageUrls.has(item.fund.ticker);
          catalogOnly.push(catalogOnlyRow(item.fund, listed));
        }
        await reporter.result(item.fund.ticker, before, 'failed', String(error));
      } finally {
        pending -= 1;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, config.concurrency) }, () => worker()));
  const lastExamined = started > 0 ? ordered[started - 1].ticker : cursor;
  if (deadlineHit) console.log(`[ ${'deadline'.padEnd(9)}] soft deadline reached after ${started} funds - the rest keeps its published rows and the next run resumes after ${lastExamined}`);

  // Funds not selected for a successful update keep their previously published rows.
  // A kept row whose funds/<T>/meta.json does not exist has dataFile null (the hub shows its Overview only).
  const keptFromPrevious: JsonRecord[] = [];
  for (const fund of universe.filter((item) => !results.some((row) => row.ticker === item.ticker))) {
    const row = previousIndex.get(fund.ticker);
    if (!row) continue;
    const hasMeta = typeof (await readPreviousMeta(fund.ticker)).ticker === 'string';
    const kept = hasMeta || row.dataFile == null ? row : { ...row, dataFile: null };
    keptFromPrevious.push(withYieldBasis(kept, hasMeta ? ((await readPreviousMeta(fund.ticker)).yields as JsonRecord | undefined) : undefined));
  }
  const funds = markClosedFunds(results.concat(catalogOnly, keptFromPrevious).sort((a, b) => String(a.ticker).localeCompare(String(b.ticker))), CLOSED_FUNDS);

  const counts = {
    funds: funds.length,
    holdings: funds.reduce((sum, fund) => sum + (numberOrNull(fund.holdings) || 0), 0),
    history: funds.reduce((sum, fund) => sum + (numberOrNull(fund.history) || 0), 0),
  };

  await writeIfChanged(INDEX_FILE, {
    generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    source: {
      provider: 'Invesco Ltd. (US ETFs)',
      market: 'us',
      site: INVESCO_SITE,
      catalog: INVESCO_CATALOG_PAGE,
      sitemap: config.sitemapUrl,
      fundApi: `${DNG_API}/{CUSIP}/(performance/standard|prices|holdings/fund)`,
      history: 'Yahoo Finance public chart API (adjusted close)',
    },
    counts,
    funds,
  });
  // Q28: a fund is announced on its first successful publish (a catalog-only row is not published), new catalog-only rows as pending
  const newFunds = newFundsLines(newFundsReport(previousRows, funds));
  for (const line of newFunds) console.log(line);
  // the index no longer lists a renamed fund, so its files can go
  for (const ticker of renamedAway) await rm(new URL(`funds/${ticker}/`, API_ROOT), { recursive: true, force: true });



  // Full passes reset the cursor: the next run starts from the top again.
  if (useCursor) await writeUpdateState(config.maxFetches > 0 || deadlineHit ? lastExamined : null, scope, deadlineHit);

  console.log(reporter.summary(startedAt));
  console.log(outputCounts(counts.funds, counts.holdings, counts.history));
  console.log(
    `[ cursor   ] ${!useCursor ? 'TICKERS run: cursor untouched' : (config.maxFetches > 0 || deadlineHit) && lastExamined ? `next run continues after ${lastExamined}` : 'full pass complete (cursor reset)'}`,
  );

  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `### Invesco data update\n\n- updated: ${results.length}\n- kept from previous runs: ${keptFromPrevious.length}\n- failed: ${failures}\n${newFunds.map((line) => `- ${line}\n`).join('')}${deadlineHit ? '- stopped at the soft deadline, the next run resumes\n' : ''}- counts: ${counts.funds} funds / ${counts.holdings.toLocaleString('en-US')} holdings rows / ${counts.history.toLocaleString('en-US')} history rows\n`,
      'utf8',
    );
  }

  // Every examined fund failed to get any fresh source: surface it as a failed run
  if (passed + failures > 0 && ctx.fresh.size === 0) {
    throw new Error(`every examined fund failed: no fund received fresh data (${passed} kept, ${failures} errors)`);
  }
}

async function yahooSearchForTicker(name: string, config: UpdaterConfig): Promise<string | null> {
  const payload = await fetchJson(yahooSearchUrl(name), `[ticker  ] ${name}`, yahooHeaders(), config);
  return pickSearchTicker(name, payload);
}

function catalogFundFromIndex(ticker: string, row: JsonRecord): CatalogFund {
  const metrics = (row.metrics as JsonRecord) || {};
  // Returns the previous run derived from closes are not official: leave them
  // empty so this run derives them afresh instead of relabelling them official.
  const wasDerived = typeof metrics.returnsBasis === 'string' && /^(derived|adjusted)/.test(metrics.returnsBasis);
  const monthEnd = wasDerived ? {} : ((row.returns as JsonRecord)?.monthEnd as JsonRecord) || {};
  const previousAsOf = typeof metrics.performanceAsOf === 'string' ? metrics.performanceAsOf : null;
  return {
    ticker,
    name: String(row.name ?? ticker),
    category: String(row.category ?? 'ETF'),
    categoryPath: String(row.category ?? 'ETF'),
    inception: null,
    exchange: String(row.exchange ?? ''),
    cusip: String(row.cusip ?? ''),
    isin: String(row.isin ?? ''),
    benchmark: '',
    ter: numberOrNull(row.terValue),
    terGross: numberOrNull(row.terGrossValue),
    nav: numberOrNull(row.navValue),
    close: numberOrNull(row.closePriceValue),
    premiumDiscount: numberOrNull(row.premiumDiscountValue),
    netAssets: numberOrNull(row.aumValue),
    dividendYield: numberOrNull(metrics.dividendYield),
    // older indexes have no code: processFund resolves it from the published meta.json
    dividendYieldBasis: numberOrNull(metrics.dividendYield) === null ? null : isYieldBasis(metrics.dividendYieldBasis) ? metrics.dividendYieldBasis : null,
    secYield: numberOrNull(metrics.secYield),
    distributionRate: null,
    asOfDate: null,
    returnsAsOf: wasDerived ? null : previousAsOf,
    returns: {
      ytd: numberOrNull(monthEnd.ytd),
      yr1: numberOrNull(monthEnd.yr1),
      yr3: numberOrNull(monthEnd.yr3),
      yr5: numberOrNull(monthEnd.yr5),
      yr10: numberOrNull(monthEnd.yr10),
      sinceInception: numberOrNull(monthEnd.sinceInception),
    },
    fundPage: String(row.fundPage ?? invescoProductDetailUrl(ticker)),
    trustCik: null,
    source: 'previous index',
  };
}

/**
 * The index row of a new fund (no published row or meta.json) whose first refresh failed: catalog facts only, dataFile null,
 * no counts and the full metrics key set with nulls, so the hub lists the fund (Overview only) and the next run treats it as unpublished.
 */
export function catalogOnlyRow(fund: CatalogFund, listed: boolean): JsonRecord {
  return {
    ticker: fund.ticker,
    name: fund.name || fund.ticker,
    listed,
    category: fund.category,
    fundPage: fund.fundPage,
    dataFile: null,
    cusip: fund.cusip || null,
    isin: fund.isin || null,
    ter: fund.ter === null ? '—' : `${fund.ter}%`,
    terValue: fund.ter,
    terGross: fund.terGross === null ? '—' : `${fund.terGross}%`,
    terGrossValue: fund.terGross,
    nav: '—',
    navValue: null,
    aum: '—',
    aumValue: null,
    asOfDate: '—',
    inceptionDate: fund.inception ? formatEdgarDate(fund.inception) : '—',
    exchange: normalizeExchange(fund.exchange || ''),
    closePrice: '—',
    closePriceValue: null,
    premiumDiscount: '—',
    premiumDiscountValue: null,
    distributions: { frequency: '—', exDate: '—', dividend: '—' },
    returns: { monthEnd: {}, quarterEnd: null },
    metrics: deriveCatalogMetrics(EMPTY_RETURNS, EMPTY_PRICE_RETURNS, null, null, null, null, null),
    holdings: 0,
    history: 0,
  };
}



// --- TLS trust store (identical in every ETF repo) ---
const SYSTEM_CA_MARKER = 'ETF_UPDATER_SYSTEM_CA';
const CERT_ERROR = /UNABLE_TO_GET_ISSUER_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT|CERT_HAS_EXPIRED|unable to get (?:local )?issuer certificate|self[- ]signed certificate|certificate has expired/i;

export function isCertError(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown; cause?: unknown } | null;
  return CERT_ERROR.test(`${String(e?.code ?? '')} ${String(e?.message ?? '')}`) || (e?.cause ? isCertError(e.cause) : false);
}

export function systemCaActive(env: Record<string, string | undefined> = process.env, execArgv: string[] = process.execArgv): boolean {
  return execArgv.includes('--use-system-ca') || env.NODE_USE_SYSTEM_CA === '1' || env[SYSTEM_CA_MARKER] === '1';
}

export function reexecWithSystemCa(): never {
  const child = Bun.spawnSync([process.execPath, '--use-system-ca', ...process.argv.slice(1)], {
    env: { ...process.env, [SYSTEM_CA_MARKER]: '1' },
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  process.exit(child.exitCode ?? 1);
}

/** mode: auto (restart once on an untrusted-certificate error), true (restart now), false (never). */
export function installSystemCa(mode: string, reexec: () => never = reexecWithSystemCa, active: boolean = systemCaActive()): void {
  if (mode === 'false' || active) return;
  if (mode === 'true') reexec();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    try { return await realFetch(...args); }
    catch (error) {
      if (!isCertError(error)) throw error;
      console.error('[ notice   ] TLS certificate not trusted; restarting once with --use-system-ca');
      return reexec();
    }
  }) as typeof fetch;
}

// ---------------------------------------------------------------------------
// Entry point (kept at the end: main() relies on the let bindings above)
// ---------------------------------------------------------------------------

// File defaults and explicit overrides, one resolver for the CLI and the
// GitHub Actions workflow: allowlisted scalar controls only, so user input is
// never interpolated into bash. Precedence: config file < advanced JSON <
// nonblank inputs < environment (INVESCO_<KEY> wins over <KEY>, then legacy aliases).
export const CONTROL_NAMES = [
  'MAX_FETCHES', 'REQUEST_SLEEP', 'CONCURRENCY', 'AUM', 'TER', 'DIVIDEND_YIELD', 'TICKERS',
  'HOLDINGS_PAGE_SIZE', 'HISTORY_PAGE_SIZE', 'MAX_RETRIES', 'HISTORY_RANGE', 'SITEMAP_URL', 'SEC_UA',
  'SKIP_YAHOO', 'SKIP_INVESCO', 'EDGAR_FALLBACK', 'VERBOSE', 'USE_SYSTEM_CA',
  ...['PERFORMANCE', 'TOTAL_RETURN'].flatMap((prefix) => ['YTD', '1Y', '3Y', '5Y', '10Y'].map((period) => `${prefix}_${period}`)),
] as const;
export type ControlName = (typeof CONTROL_NAMES)[number];
export const CONFIG_FILE_URL = new URL('./update-data.config.json', import.meta.url);
const LEGACY_ENV_ALIASES: Partial<Record<ControlName, string[]>> = {
  MAX_FETCHES: ['INVESCO_LIMIT'],
  HISTORY_PAGE_SIZE: ['HISTORICAL_PAGE_SIZE'],
};

export function resolveControls(
  file: unknown = {},
  advanced: unknown = {},
  inputs: unknown = {},
  env: Record<string, string | undefined> = {},
): Record<string, string> {
  const result: Record<string, string> = {};
  const known = new Set<string>(CONTROL_NAMES);
  const apply = (value: unknown, skipEmpty = false): void => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Configuration must be a JSON object');
    for (const [key, raw] of Object.entries(value)) {
      if (!known.has(key)) throw new Error(`Unknown updater control: ${key}`);
      if (skipEmpty && (raw === '' || raw === undefined || raw === null)) continue;
      if (!['string', 'number', 'boolean'].includes(typeof raw)) throw new Error(`${key}: expected string, number or boolean`);
      const text = String(raw);
      if (/[\r\n\0]/.test(text)) throw new Error(`${key}: multiline/control characters are not allowed`);
      result[key] = text;
    }
  };
  apply(file);
  apply(advanced);
  apply(inputs, true);
  for (const key of CONTROL_NAMES) {
    const value = [`INVESCO_${key}`, key, ...(LEGACY_ENV_ALIASES[key] ?? [])].map((name) => env[name]).find((candidate) => candidate !== undefined);
    if (value !== undefined) apply({ [key]: value });
  }
  for (const key of ['MAX_FETCHES', 'CONCURRENCY', 'HOLDINGS_PAGE_SIZE', 'HISTORY_PAGE_SIZE', 'MAX_RETRIES']) {
    const v = result[key];
    if (v === undefined || v.trim() === '') continue;
    const min = key === 'MAX_FETCHES' ? 0 : 1; // MAX_RETRIES 0 was never honored by the updater (falls back to 2)
    if (!/^\d+$/.test(v.trim()) || !Number.isSafeInteger(Number(v)) || Number(v) < min) throw new Error(`${key}: expected integer >= ${min}`);
  }
  if (result.REQUEST_SLEEP?.trim() && (!Number.isFinite(Number(result.REQUEST_SLEEP)) || Number(result.REQUEST_SLEEP) < 0)) throw new Error('REQUEST_SLEEP: expected nonnegative seconds');
  for (const key of ['SKIP_YAHOO', 'SKIP_INVESCO', 'EDGAR_FALLBACK', 'VERBOSE']) {
    if (result[key]?.trim() && !/^(0|1|true|false|yes|no|y|n|on|off)$/i.test(result[key].trim())) throw new Error(`${key}: expected boolean`);
  }
  for (const key of ['SITEMAP_URL']) {
    if (result[key]?.trim()) {
      let valid = /^https:\/\/\S+$/.test(result[key].trim());
      if (valid) { try { new URL(result[key].trim()); } catch { valid = false; } }
      if (!valid) throw new Error(`${key}: expected an https URL`);
    }
  }
  if (result.HISTORY_RANGE?.trim() && !/^(max|[1-9]\d{0,2}y)$/i.test(result.HISTORY_RANGE.trim())) {
    throw new Error('HISTORY_RANGE: expected max or a whole number of years such as 5y or 10y');
  }
  if (result.USE_SYSTEM_CA !== undefined) {
    const mode = result.USE_SYSTEM_CA.trim().toLowerCase();
    if (!['auto', 'true', 'false'].includes(mode)) throw new Error('USE_SYSTEM_CA: expected auto, true or false');
    result.USE_SYSTEM_CA = mode;
  }
  readConfig(result); // validate every min:max filter before any request or write
  return result;
}

export async function runtimeControls(env: Record<string, string | undefined> = process.env): Promise<Record<string, string>> {
  let file: unknown = {};
  try { file = JSON.parse(await outputReadFile(CONFIG_FILE_URL, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return resolveControls(file, {}, {}, env);
}

export async function main(argv: string[] = process.argv.slice(2), env: Record<string, string | undefined> = process.env): Promise<void> {
  if (argv.includes('-h') || argv.includes('--help')) {
    console.log(USAGE.trim());
    return;
  }
  const controls = await runtimeControls(env);
  if (controls.VERBOSE !== undefined && env === process.env) process.env.VERBOSE = controls.VERBOSE;
  installSystemCa(controls.USE_SYSTEM_CA ?? 'auto');
  await runUpdater(readConfig(controls));
}

if ((import.meta as { main?: boolean }).main) {
  await main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}

// <holdings-guard> shared block of .claude/tools/etfs/etf-std/holdings-guard.block.ts, applied by apply-holdings-guard.ts: never edit it in one repo
/**
 * Sanity check of a fund's new holdings before they replace the published ones. Returns why they must be rejected
 * (the caller then keeps the fund's previous state and reports it as failed), or null when they may be written.
 * An empty sheet passes only when nothing was published before. Otherwise a Name and a weight column (Weight,
 * Weight (%) or Market Weight) are required, >= 80% of the rows carry a numeric weight, the weights add up to
 * 50..150 and the sheet keeps >= 50% of the previously published rows. `relax` switches off the checks a fund
 * legitimately fails: 'numeric' and 'sum' (geared, inverse, futures, look-through, top-N lists) and 'count'. No relax lets
 * a sheet without a single numeric weight replace a published sheet that had numeric weights (`previousWeights`: how many
 * rows of the published sheet carry a numeric weight, see holdingsWeightCount; open-items etfs Q24).
 * Rows are arrays in header order or objects keyed by the header text. A fund in the brand's CLOSED_FUNDS never reaches the guard.
 */
export function holdingsGuard(headers: ReadonlyArray<string>, rows: ReadonlyArray<unknown>, previousRows: number | null | undefined, relax: ReadonlyArray<string> = [], previousWeights: number | null = null): string | null {
  const previous = Number(previousRows) > 0 ? Number(previousRows) : 0;
  if (!rows.length) return previous ? `no holdings rows (${previous} published)` : null;
  const names = headers.map((header) => String(header).trim().toLowerCase());
  const nameAt = names.indexOf('name');
  let weightAt = names.indexOf('weight');
  if (weightAt < 0) weightAt = names.indexOf('weight (%)');
  if (weightAt < 0) weightAt = names.indexOf('market weight');
  if (nameAt < 0 || weightAt < 0) return `no ${nameAt < 0 ? 'Name' : 'weight'} column (headers: ${headers.join(', ') || 'none'})`;
  const weights = holdingsGuardWeights(headers, rows, weightAt);
  const numeric = weights.count;
  const sum = weights.sum;
  if (numeric === 0 && Number(previousWeights) > 0) return `no row has a numeric weight, the published sheet had ${Number(previousWeights)}`;
  if (relax.indexOf('numeric') < 0 && numeric < rows.length * 0.8) return `only ${numeric} of ${rows.length} rows have a numeric weight`;
  if (relax.indexOf('sum') < 0 && (sum < 50 || sum > 150)) return `weights add up to ${sum.toFixed(2)}, outside 50..150`;
  if (relax.indexOf('count') < 0 && previous && rows.length < previous * 0.5) return `${rows.length} rows, less than half of the ${previous} published`;
  return null;
}

/** How many rows carry a numeric weight (Weight, Weight (%) or Market Weight column), 0 without such a column: pass it for the published sheet as holdingsGuard's previousWeights. */
export function holdingsWeightCount(headers: ReadonlyArray<string>, rows: ReadonlyArray<unknown>): number {
  const names = headers.map((header) => String(header).trim().toLowerCase());
  let weightAt = names.indexOf('weight');
  if (weightAt < 0) weightAt = names.indexOf('weight (%)');
  if (weightAt < 0) weightAt = names.indexOf('market weight');
  return weightAt < 0 ? 0 : holdingsGuardWeights(headers, rows, weightAt).count;
}

/** Count and sum of the numeric weights in column weightAt; rows are arrays in header order or objects keyed by the header text. */
function holdingsGuardWeights(headers: ReadonlyArray<string>, rows: ReadonlyArray<unknown>, weightAt: number): { count: number; sum: number } {
  let count = 0;
  let sum = 0;
  for (let i = 0; i < rows.length; i++) {
    const row: any = rows[i];
    const weight = holdingsGuardNumber(Array.isArray(row) ? row[weightAt] : row && typeof row === 'object' ? row[headers[weightAt]] : undefined);
    if (weight !== null) {
      count++;
      sum += weight;
    }
  }
  return { count, sum };
}

/** A weight cell as a number: %, $, commas and spaces are ignored, (x) is negative; null when it is no plain number (a zero-width character inside counts as broken). */
function holdingsGuardNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let text = String(value === null || value === undefined ? '' : value).replace(/[ \t ,%$]/g, '').replace(/−/g, '-');
  const negative = /^\(.*\)$/.test(text);
  if (negative) text = text.slice(1, -1);
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(text)) return null;
  return negative ? -Number(text) : Number(text);
}

/** A fund its issuer closed (liquidated, delisted or merged away), confirmed from an official source: an SEC filing or the issuer's notice. */
export type ClosedFund = { ticker: string; closed: string; source: string };

/**
 * The brand's CLOSED_FUNDS entry for a ticker, or null. A closed fund is never fetched, never guarded and never reported failed: it keeps
 * its last published data and its index row carries `status: 'closed'`, `closedDate` and `closedSource`. A malformed entry throws, so a
 * typo (no ISO date, no https source) never ships.
 */
export function closedFund(list: ReadonlyArray<ClosedFund>, ticker: unknown): ClosedFund | null {
  const wanted = String(ticker === null || ticker === undefined ? '' : ticker).trim().toUpperCase();
  let found: ClosedFund | null = null;
  for (let i = 0; i < list.length; i++) {
    const fund = list[i];
    if (!/^[A-Z0-9][A-Z0-9.-]{0,9}$/.test(fund.ticker) || !/^\d{4}-\d{2}-\d{2}$/.test(fund.closed) || !/^https:\/\/\S+$/.test(fund.source)) throw new Error(`CLOSED_FUNDS: ${fund.ticker} needs an upper-case ticker, an ISO closing date and an https source`);
    if (fund.ticker === wanted) found = fund;
  }
  return found;
}

/** The index rows with every closed fund marked (`status: 'closed'`, `closedDate`, `closedSource`); other rows are returned as they are. */
export function markClosedFunds<T extends object>(rows: ReadonlyArray<T>, list: ReadonlyArray<ClosedFund>): T[] {
  return rows.map((row) => {
    const fund = closedFund(list, (row as { ticker?: unknown }).ticker);
    return fund ? ({ ...row, status: 'closed', closedDate: fund.closed, closedSource: fund.source } as T) : row;
  });
}

/** A run's queue without the closed funds, which are named once in the log: they are neither fetched nor counted as failed. */
export function withoutClosedFunds<T>(queue: ReadonlyArray<T>, tickerOf: (item: T) => string, list: ReadonlyArray<ClosedFund>): T[] {
  const closed: string[] = [];
  const open: T[] = [];
  for (let i = 0; i < queue.length; i++) {
    if (closedFund(list, tickerOf(queue[i]))) closed.push(tickerOf(queue[i]));
    else open.push(queue[i]);
  }
  if (closed.length) console.log(`[ closed   ] ${closed.join(', ')}: closed by the issuer, published data kept`);
  return open;
}
// </holdings-guard>

// <nport-reader> shared block of .claude/tools/etfs/etf-std/nport-reader.block.ts, applied by apply-block.ts: never edit it in one repo
/**
 * SEC EDGAR Form N-PORT-P holdings reader (open-items etfs ETF-H2), one copy for every brand. Pure functions plus one reader
 * that takes the brand's own `getText(url, label)` (its SEC User-Agent, timeout, retries and pacing). Rules it enforces:
 * - identifiers come from the position itself: `<cusip>` text (or a `value` attribute), `<isin value>`, `<ticker value>`,
 *   `<other value>`; a derivative's reference instrument (inside `<derivativeInfo>`) never lends its identifiers to the position
 * - CUSIP `000000000` and `N/A` are missing; a missing weight or value is null (an empty cell), never 0
 * - a ticker only for an equity row (assetCat EC or EP) traded in USD with a U.S. ISIN or none, and never one ticker on two
 *   different securities (`nportTickers`)
 * - identity: the filing must name the fund's own series id, or, with no series id known, the fund's name (`nportIdentity`)
 * - freshness: the report period must be strictly newer than the published holdings (`nportIsFresh`)
 * - filings come newest report period first from the registrant's own archive folder, never from the filer agent's CIK
 *   (the accession number prefix)
 */
export type NportPosition = {
  name: string;
  title: string;
  lei: string;
  cusip: string;
  isin: string;
  ticker: string;
  other: string;
  otherDesc: string;
  balance: number | null;
  units: string;
  currency: string;
  /** valUSD, null when the filing has none */
  value: number | null;
  /** pctVal: percent of net assets (0.5 = 0.5%), null when the filing has none */
  weight: number | null;
  payoff: string;
  assetCat: string;
  issuerCat: string;
  country: string;
  /** derivCat of the position's derivativeInfo (FUT, FWD, SWP, OPT, ...), empty for a security */
  derivative: string;
  /** debtSec annualizedRt and maturityDt (ISO), null and '' for a non-debt row */
  coupon: number | null;
  maturity: string;
};

export type NportFiling = {
  seriesId: string;
  seriesName: string;
  regName: string;
  regCik: string;
  /** report period end (genInfo repPdDate) as ISO, '' when missing */
  repPdDate: string;
  netAssets: number | null;
  totalAssets: number | null;
  positions: NportPosition[];
};

export type NportCandidate = { accession: string; filed: string; period: string; cik: string };
export type NportSeriesRef = { cik: string; seriesId: string; classId: string };

/** XML text: entities decoded, tags dropped, whitespace collapsed. */
function nportText(raw: string): string {
  return String(raw)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_m: string, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m: string, dec: string) => String.fromCharCode(Number(dec)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/[\s ]+/g, ' ')
    .trim();
}

/** Text of the first `<tag>` (any namespace prefix) in `xml`, '' when absent. */
function nportTag(xml: string, tag: string): string {
  const match = new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9_.-]+:)?${tag}>`, 'i').exec(xml);
  return match ? nportText(match[1]) : '';
}

/** The `attribute` of the first `<tag ...>` (any namespace prefix) in `xml`, '' when absent. */
function nportAttr(xml: string, tag: string, attribute: string): string {
  const match = new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${tag}\\s[^>]*?\\b${attribute}\\s*=\\s*"([^"]*)"`, 'i').exec(xml);
  return match ? nportText(match[1]) : '';
}

/** A plain decimal or exponent number, null for an empty, N/A or broken cell. */
function nportNumber(raw: string): number | null {
  const text = String(raw).replace(/[\s,]/g, '');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** An identifier code, '' for N/A, NONE and all zeros (CUSIP 000000000 means "no CUSIP"). */
function nportCode(raw: string): string {
  const text = String(raw).trim().toUpperCase();
  return !text || /^(N\/?A|NONE|-+|0+)$/.test(text) ? '' : text;
}

/** ISO date of an N-PORT date (YYYY-MM-DD, possibly with a time), '' otherwise. */
function nportIso(raw: unknown): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw === null || raw === undefined ? '' : raw).trim());
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

/** One N-PORT-P primary_doc.xml (or the full submission .txt that embeds it) as series facts and positions. */
export function parseNportFiling(xml: string): NportFiling {
  const text = String(xml === null || xml === undefined ? '' : xml);
  const genInfo = /<(?:[A-Za-z0-9_.-]+:)?genInfo\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?genInfo>/i.exec(text);
  const fundInfo = /<(?:[A-Za-z0-9_.-]+:)?fundInfo\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?fundInfo>/i.exec(text);
  const gen = genInfo ? genInfo[1] : '';
  const fund = fundInfo ? fundInfo[1].replace(/<(?:[A-Za-z0-9_.-]+:)?returnInfo\b[\s\S]*?<\/(?:[A-Za-z0-9_.-]+:)?returnInfo>/gi, ' ') : '';
  const positions: NportPosition[] = [];
  const blocks = /<(?:[A-Za-z0-9_.-]+:)?invstOrSec\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?invstOrSec>/gi;
  let block: RegExpExecArray | null;
  while ((block = blocks.exec(text)) !== null) {
    const raw = block[1];
    const derivativeInfo = /<(?:[A-Za-z0-9_.-]+:)?derivativeInfo\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?derivativeInfo>/i.exec(raw);
    // The reference instrument of a derivative (SPY for a SPY option, a bond for a CDS) is another security: drop it first.
    const own = raw.replace(/<(?:[A-Za-z0-9_.-]+:)?derivativeInfo\b[^>]*>[\s\S]*?<\/(?:[A-Za-z0-9_.-]+:)?derivativeInfo>/gi, ' ');
    const identifiers = /<(?:[A-Za-z0-9_.-]+:)?identifiers\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?identifiers>/i.exec(own);
    const ids = identifiers ? identifiers[1] : '';
    const debt = /<(?:[A-Za-z0-9_.-]+:)?debtSec\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?debtSec>/i.exec(own);
    const name = nportTag(own, 'name');
    positions.push({
      name: name && !/^N\/?A$/i.test(name) ? name : nportTag(own, 'title'),
      title: nportTag(own, 'title'),
      lei: nportCode(nportTag(own, 'lei')),
      cusip: nportCode(nportTag(own, 'cusip') || nportAttr(ids, 'cusip', 'value')),
      isin: nportCode(nportAttr(ids, 'isin', 'value')),
      ticker: nportCode(nportAttr(ids, 'ticker', 'value')),
      other: nportCode(nportAttr(ids, 'other', 'value')),
      otherDesc: nportAttr(ids, 'other', 'otherDesc'),
      balance: nportNumber(nportTag(own, 'balance')),
      units: nportTag(own, 'units'),
      currency: (nportTag(own, 'curCd') || nportAttr(own, 'currencyConditional', 'curCd')).toUpperCase(),
      value: nportNumber(nportTag(own, 'valUSD')),
      weight: nportNumber(nportTag(own, 'pctVal')),
      payoff: nportTag(own, 'payoffProfile'),
      assetCat: (nportTag(own, 'assetCat') || nportAttr(own, 'assetConditional', 'assetCat')).toUpperCase(),
      issuerCat: (nportTag(own, 'issuerCat') || nportAttr(own, 'issuerConditional', 'issuerCat')).toUpperCase(),
      country: nportTag(own, 'invCountry').toUpperCase(),
      derivative: derivativeInfo ? (/\bderivCat\s*=\s*"([^"]*)"/i.exec(derivativeInfo[1]) || ['', 'OTHER'])[1].toUpperCase() : '',
      coupon: debt ? nportNumber(nportTag(debt[1], 'annualizedRt')) : null,
      maturity: debt ? nportIso(nportTag(debt[1], 'maturityDt')) : '',
    });
  }
  return {
    seriesId: nportTag(gen, 'seriesId').toUpperCase(),
    seriesName: nportTag(gen, 'seriesName'),
    regName: nportTag(gen, 'regName'),
    regCik: nportTag(gen, 'regCik').replace(/\D/g, ''),
    repPdDate: nportIso(nportTag(gen, 'repPdDate')),
    netAssets: nportNumber(nportTag(fund, 'netAssets')),
    totalAssets: nportNumber(nportTag(fund, 'totAssets')),
    positions,
  };
}

/** A number as sheet text: '' for null, no exponent, at most `digits` decimals (trailing zeros dropped). */
export function nportCell(value: number | null, digits = 8): string {
  if (value === null || !Number.isFinite(value)) return '';
  const text = value.toFixed(digits);
  return text.indexOf('.') < 0 ? text : text.replace(/0+$/, '').replace(/\.$/, '');
}

/** The position's own identifier for a sheet: CUSIP, else ISIN, else the "other" code (a Bloomberg or internal id), else ''. */
export function nportIdentifier(position: NportPosition): string {
  return position.cusip || position.isin || position.other;
}

/**
 * A company name as a lookup key: upper case, punctuation and legal suffixes dropped, `CLASS A` -> `CL A`. Initials are one
 * word whether written with dots, spaces or a slash (`N.V.` = `N V` = `NV`, `C.H. ROBINSON` = `C H ROBINSON`, `A/S` = `A S`,
 * `S.A.B. de C.V.` = `SAB DE CV`), `PUBLIC LIMITED COMPANY` is `plc`, and a leading `US` stays (`U.S. BANCORP` is not
 * `BANCORP, INC.`), so both spellings of one issuer give one key.
 */
export function nportNameKey(value: unknown): string {
  // EDGAR adds a state or qualifier suffix to company titles ("COSTCO WHOLESALE CORP /NEW", "BANK OF AMERICA CORP /DE/", "US BANCORP \DE\"): drop a trailing one
  const raw = String(value === null || value === undefined ? '' : value).replace(/(?:\s*[\/\\]\s*[A-Za-z]{2,3}\s*[\/\\]?)+\s*$/, '');
  let text = nportText(raw).toUpperCase().replace(/['’]/g, '').replace(/&/g, ' AND ').replace(/[^A-Z0-9]+/g, ' ').trim();
  text = text.replace(/\bCLASS\s+([A-Z])\b/g, 'CL $1').replace(/\bCL\s+([A-Z])\b/g, 'CL $1');
  // a run of single letters is one word, never the class letter after CL
  const words: string[] = [];
  let joining = false;
  text.split(' ').forEach((word) => {
    const letter = /^[A-Z]$/.test(word);
    if (letter && joining) words[words.length - 1] += word;
    else words.push(word);
    joining = letter && (joining || words[words.length - 2] !== 'CL');
  });
  text = words.join(' ').replace(/\bPUBLIC (?:(?:LIMITED|LTD)(?: (?:COMP[A-Z]*|CO))?|(?:COMPANY|CO) (?:LIMITED|LTD))\b/g, 'PLC').replace(/\b(?:S DE RL )?DE CV\b/g, ' ');
  const share = /\bCL [A-Z]\b/.exec(text);
  text = text.replace(/\b(THE|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|PLC|SA|SAB|NV|AG|SE|SPA|AS|ASA|ORDINARY|COMMON|STOCK|SHS|SHARES|ADR|DEPOSITARY|RECEIPT|USD|US|REG|REGISTERED)\b/g, (word: string, _name: string, at: number) => (word === 'US' && at === 0 ? word : ' ')).replace(/\s+/g, ' ').trim();
  if (share && !/\bCL [A-Z]\b/.test(text)) text = `${text} ${share[0]}`;
  return text;
}

/** SEC company_tickers.json -> name key -> ticker (the first, largest company wins a shared key; the class-less key is added too). */
export function parseSecCompanyNames(payload: unknown): Map<string, string> {
  const names = new Map<string, string>();
  const rows = payload && typeof payload === 'object' ? Object.keys(payload as object).map((key) => (payload as Record<string, unknown>)[key]) : [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as { ticker?: unknown; title?: unknown } | null;
    if (!row || typeof row !== 'object') continue;
    const ticker = String(row.ticker === null || row.ticker === undefined ? '' : row.ticker).trim().toUpperCase();
    const key = nportNameKey(row.title);
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker) || !key) continue;
    if (!names.has(key)) names.set(key, ticker);
    const core = key.replace(/ CL [A-Z]$/, '');
    if (core && !names.has(core)) names.set(core, ticker);
  }
  return names;
}

/** SEC company_tickers_mf.json -> fund ticker -> registrant CIK (10 digits), series id, class id. */
export function parseSecFundTickers(payload: unknown): Map<string, NportSeriesRef> {
  const map = new Map<string, NportSeriesRef>();
  const record = (payload && typeof payload === 'object' ? payload : {}) as { fields?: unknown; data?: unknown };
  const fields = Array.isArray(record.fields) ? record.fields.map(String) : [];
  const rows = Array.isArray(record.data) ? record.data : [];
  const at = (row: unknown[], field: string): string => (fields.indexOf(field) < 0 ? '' : String(row[fields.indexOf(field)] === null || row[fields.indexOf(field)] === undefined ? '' : row[fields.indexOf(field)]).trim());
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const ticker = at(row, 'symbol').toUpperCase();
    const cik = at(row, 'cik').replace(/\D/g, '');
    const seriesId = at(row, 'seriesId').toUpperCase();
    if (!ticker || !Number(cik) || !/^S\d{9}$/.test(seriesId) || map.has(ticker)) continue;
    map.set(ticker, { cik: `0000000000${Number(cik)}`.slice(-10), seriesId, classId: at(row, 'classId').toUpperCase() });
  }
  return map;
}

/**
 * Exchange tickers for the positions, in their order ('' for none). A ticker is given only to an equity row (assetCat EC or
 * EP) traded in USD (or with no currency) whose ISIN is U.S. or missing: first the filer's own `<ticker value>`, else the
 * SEC issuer-name table (`names`) when the row has a CUSIP or a U.S. ISIN. A ticker that lands on two different securities
 * (Alphabet A and C, an ordinary share and its ADR) is dropped from the name-matched rows; when the filer itself gave it
 * to two securities it is dropped from all of them. Bonds, cash, funds and derivatives stay identifier-keyed.
 */
export function nportTickers(positions: ReadonlyArray<NportPosition>, names: Map<string, string> | null = null): string[] {
  const fromFiler: boolean[] = [];
  const tickers = positions.map((position, index) => {
    fromFiler[index] = false;
    const equity = (position.assetCat === 'EC' || position.assetCat === 'EP') && !position.derivative;
    const usd = !position.currency || position.currency === 'USD';
    if (!equity || !usd || (position.isin && position.isin.slice(0, 2) !== 'US')) return '';
    if (/^[A-Z][A-Z0-9.-]{0,9}$/.test(position.ticker)) {
      fromFiler[index] = true;
      return position.ticker;
    }
    if (!names || !(/^[0-9A-Z]{9}$/.test(position.cusip) || /^US[0-9A-Z]{10}$/.test(position.isin))) return '';
    const key = nportNameKey(position.name);
    return names.get(key) || names.get(key.replace(/ CL [A-Z]$/, '')) || '';
  });
  const securities = new Map<string, { keys: string[]; filer: string[] }>();
  tickers.forEach((ticker, index) => {
    if (!ticker) return;
    const position = positions[index];
    const key = position.cusip || position.isin || position.other || nportNameKey(position.name);
    const seen = securities.get(ticker) || { keys: [], filer: [] };
    if (seen.keys.indexOf(key) < 0) seen.keys.push(key);
    if (fromFiler[index] && seen.filer.indexOf(key) < 0) seen.filer.push(key);
    securities.set(ticker, seen);
  });
  return tickers.map((ticker, index) => {
    const seen = ticker ? securities.get(ticker) : undefined;
    if (!seen || seen.keys.length < 2) return ticker;
    return seen.filer.length === 1 && fromFiler[index] ? ticker : '';
  });
}

/** The browse-edgar Atom feed of one series' NPORT-P filings. */
export function nportSeriesFeedUrl(seriesId: string, count = 10): string {
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(String(seriesId).toUpperCase())}&type=NPORT-P&dateb=&owner=include&count=${count}&output=atom`;
}

/** The registrant's submissions JSON (report periods of its recent filings). */
export function nportSubmissionsUrl(cik: string): string {
  return `https://data.sec.gov/submissions/CIK${`0000000000${Number(String(cik).replace(/\D/g, '')) || 0}`.slice(-10)}.json`;
}

/** primary_doc.xml of a filing in the registrant's own folder. Throws without a registrant CIK: the accession prefix is the filer agent. */
export function nportDocumentUrl(registrantCik: string, accession: string): string {
  const cik = Number(String(registrantCik).replace(/\D/g, ''));
  if (!cik) throw new Error(`N-PORT ${accession}: no registrant CIK (the accession prefix is the filer agent, never used as the folder)`);
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${String(accession).replace(/-/g, '')}/primary_doc.xml`;
}

/** NPORT-P entries of a browse-edgar Atom feed (amendments and other forms skipped), with the registrant CIK of the filing link. */
export function parseNportFeed(atom: string): NportCandidate[] {
  const out: NportCandidate[] = [];
  const entries = /<entry>([\s\S]*?)<\/entry>/gi;
  let entry: RegExpExecArray | null;
  while ((entry = entries.exec(String(atom === null || atom === undefined ? '' : atom))) !== null) {
    const body = entry[1];
    const form = (nportTag(body, 'filing-type') || nportAttr(body, 'category', 'term')).toUpperCase();
    const accession = nportTag(body, 'accession-number');
    if (form !== 'NPORT-P' || !/^\d{10}-\d{2}-\d{6}$/.test(accession)) continue;
    const folder = /\/Archives\/edgar\/data\/(\d+)\//i.exec(nportTag(body, 'filing-href'));
    out.push({ accession, filed: nportIso(nportTag(body, 'filing-date')), period: nportIso(nportTag(body, 'period')), cik: folder ? folder[1] : '' });
  }
  return out;
}

/** NPORT-P filings of a registrant's submissions JSON (`filings.recent`), with report periods; the registrant is the JSON's own CIK. */
export function parseNportSubmissions(payload: unknown): NportCandidate[] {
  const record = (payload && typeof payload === 'object' ? payload : {}) as { cik?: unknown; filings?: { recent?: Record<string, unknown> } };
  const recent = record.filings && record.filings.recent ? record.filings.recent : {};
  const column = (name: string): unknown[] => (Array.isArray(recent[name]) ? (recent[name] as unknown[]) : []);
  const forms = column('form'), accessions = column('accessionNumber'), filed = column('filingDate'), periods = column('reportDate');
  const cik = String(record.cik === null || record.cik === undefined ? '' : record.cik).replace(/\D/g, '');
  const out: NportCandidate[] = [];
  for (let i = 0; i < forms.length; i++) {
    const accession = String(accessions[i] === null || accessions[i] === undefined ? '' : accessions[i]);
    if (String(forms[i]).toUpperCase() !== 'NPORT-P' || !/^\d{10}-\d{2}-\d{6}$/.test(accession)) continue;
    out.push({ accession, filed: nportIso(filed[i]), period: nportIso(periods[i]), cik });
  }
  return out;
}

/**
 * Candidates newest report period first, then newest filing: a late filing for an older period never wins. A missing
 * period is taken from `known` (the registrant's submissions) by accession; candidates still without one go last.
 */
export function nportNewestFirst(candidates: ReadonlyArray<NportCandidate>, known: ReadonlyArray<NportCandidate> = []): NportCandidate[] {
  const periods = new Map<string, string>();
  for (let i = 0; i < known.length; i++) if (known[i].period) periods.set(known[i].accession, known[i].period);
  return candidates
    .map((candidate) => (candidate.period ? candidate : { ...candidate, period: periods.get(candidate.accession) || '' }))
    .sort((a, b) => (a.period && b.period ? b.period.localeCompare(a.period) : a.period ? -1 : b.period ? 1 : 0) || b.filed.localeCompare(a.filed));
}

/**
 * Does the filing belong to the fund? With a series id: only the same series id. Without one: the normalized series name
 * equals the fund name, or (`loose`, reported to the caller) one contains the other. Returns the problem, or null.
 */
export function nportIdentity(filing: Pick<NportFiling, 'seriesId' | 'seriesName'>, fund: { seriesId?: string | null; name?: string | null }): { problem: string | null; loose: boolean } {
  const wantedSeries = String(fund.seriesId || '').trim().toUpperCase();
  if (wantedSeries) return { problem: filing.seriesId === wantedSeries ? null : `names series ${filing.seriesId || 'none'}, not ${wantedSeries}`, loose: false };
  const filed = nportNameKey(filing.seriesName), wanted = nportNameKey(fund.name);
  if (!filed || !wanted) return { problem: 'no series id and no fund name to match', loose: false };
  if (filed === wanted) return { problem: null, loose: false };
  if (filed.indexOf(wanted) >= 0 || wanted.indexOf(filed) >= 0) return { problem: null, loose: true };
  return { problem: `names series "${filing.seriesName}", not "${String(fund.name)}"`, loose: false };
}

/**
 * May a filing replace the published holdings? Nothing published (no rows): any dated or undated report. Otherwise only a
 * report period strictly newer than the published holdings date; both must be ISO dates (convert the brand's display
 * date first), an unknown date on either side keeps the published sheet.
 */
export function nportIsFresh(repPdDate: unknown, publishedAsOf: unknown, publishedRows: unknown): boolean {
  if (!(Number(publishedRows) > 0)) return true;
  const report = nportIso(repPdDate), published = nportIso(publishedAsOf);
  return Boolean(report && published && String(publishedAsOf).trim().length === 10 && report > published);
}

export type NportRead = { filing: NportFiling; candidate: NportCandidate; url: string; loose: boolean } | { problem: string };

/**
 * The newest N-PORT-P filing of one fund, or why there is none. Candidates: the series' Atom feed (when a series id is known;
 * an empty feed means no filing yet) with periods from the registrant's submissions, else (no series id, or the feed failed)
 * the registrant's NPORT-P filings themselves; newest period first.
 * Documents are read until one passes the identity check (at most `maxDocuments`); that newest own filing is returned only
 * when it is fresh against the published holdings (`published.asOf` ISO, `published.rows`). Errors of the optional
 * submissions request are tolerated; others come back as `problem`. `cache` (one Map per run) keeps the submissions and
 * the parsed documents, so funds of one registrant share requests.
 */
export async function readNportHoldings(
  fund: { ticker: string; cik: string; seriesId?: string | null; name?: string | null },
  published: { asOf?: unknown; rows?: unknown },
  getText: (url: string, label: string) => Promise<string>,
  options: { maxDocuments?: number; cache?: Map<string, unknown> } = {},
): Promise<NportRead> {
  const cache = options.cache || new Map<string, unknown>();
  const once = async <T>(key: string, load: () => Promise<T>): Promise<T> => {
    if (!cache.has(key)) cache.set(key, load().catch((error: unknown) => { cache.delete(key); throw error; }));
    return (await cache.get(key)) as T;
  };
  const cik = String(fund.cik || '').replace(/\D/g, '');
  if (!Number(cik)) return { problem: `${fund.ticker}: no registrant CIK` };
  let known: NportCandidate[] = [];
  try {
    known = await once(`submissions:${Number(cik)}`, async () => parseNportSubmissions(JSON.parse(await getText(nportSubmissionsUrl(cik), `${fund.ticker} N-PORT periods`))));
  } catch {
    known = [];
  }
  // null: no series feed (no series id, or the feed failed), so the registrant's own NPORT-P filings are scanned instead
  let candidates: NportCandidate[] | null = null;
  try {
    if (fund.seriesId) candidates = parseNportFeed(await getText(nportSeriesFeedUrl(fund.seriesId), `${fund.ticker} N-PORT filings`));
  } catch (error) {
    if (!known.length) return { problem: `${fund.ticker}: N-PORT filings unavailable (${error instanceof Error ? error.message : String(error)})` };
  }
  const sorted = nportNewestFirst(candidates || known, known);
  if (!sorted.length) return { problem: `${fund.ticker}: no NPORT-P filing yet` };
  const limit = Math.max(1, options.maxDocuments || (candidates ? 3 : 12));
  const misses: string[] = [];
  for (let i = 0; i < sorted.length && i < limit; i++) {
    const candidate = sorted[i];
    const url = nportDocumentUrl(Number(candidate.cik) ? candidate.cik : cik, candidate.accession);
    let filing: NportFiling;
    try {
      filing = await once(`document:${url}`, async () => parseNportFiling(await getText(url, `${fund.ticker} N-PORT ${candidate.accession}`)));
    } catch (error) {
      misses.push(`${candidate.accession} unreadable (${error instanceof Error ? error.message : String(error)})`);
      continue;
    }
    const identity = nportIdentity(filing, fund);
    if (identity.problem) {
      misses.push(`${candidate.accession} ${identity.problem}`);
      continue;
    }
    if (!filing.positions.length) return { problem: `${fund.ticker}: ${candidate.accession} has no positions` };
    if (!nportIsFresh(filing.repPdDate, published.asOf, published.rows)) return { problem: `${fund.ticker}: N-PORT ${filing.repPdDate || 'undated'} is not newer than the published holdings (${String(published.asOf || 'undated')})` };
    return { filing, candidate, url, loose: identity.loose };
  }
  return { problem: `${fund.ticker}: no N-PORT-P filing of its own${misses.length ? `: ${misses.join('; ')}` : ''}` };
}
// </nport-reader>

// <calendar-dates> shared block of .claude/tools/etfs/etf-std/calendar-dates.block.ts, applied by apply-block.ts: never edit it in one repo
/**
 * A calendar date as ISO `YYYY-MM-DD`, or null. Pure text work, never `Date.parse` or local getters, so a run in Tokyo
 * publishes the same day as CI (open-items etfs ETF-H4). Accepts ISO (`2026-10-24`, with a time the date part is kept as
 * written), `2026/10/24`, U.S. `10/24/2026` and `10-24-26` (two-digit years up to 69 are 20xx), month names in either order
 * (`Oct 24, 2026`, `October 24 2026`, `Sept. 30, 2026`, `24 Oct 2026`, `24-Oct-26`), an optional weekday or `as of` in front.
 * A day that does not exist (`02/30/2026`) is null.
 */
export function calendarIso(value: unknown): string | null {
  const text = String(value === null || value === undefined ? '' : value).replace(/[\s ]+/g, ' ').trim()
    .replace(/^as of:? /i, '').replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,? /i, '');
  const year = (raw: string): number => (raw.length === 2 ? (Number(raw) <= 69 ? 2000 : 1900) + Number(raw) : Number(raw));
  const month = (raw: string): number => {
    const word = raw.toLowerCase();
    const names = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    for (let i = 0; i < names.length; i++) if (word.length >= 3 && names[i].indexOf(word) === 0) return i + 1;
    return 0;
  };
  let y = 0, m = 0, d = 0, match: RegExpExecArray | null;
  if ((match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(text)) || (match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(text))) {
    y = Number(match[1]); m = Number(match[2]); d = Number(match[3]);
  } else if ((match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})$/.exec(text))) {
    y = year(match[3]); m = Number(match[1]); d = Number(match[2]);
  } else if ((match = /^([A-Za-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})$/.exec(text))) {
    y = Number(match[3]); m = month(match[1]); d = Number(match[2]);
  } else if ((match = /^(\d{1,2})(?:st|nd|rd|th)?[ -]([A-Za-z]{3,9})\.?,?[ -](\d{4}|\d{2})$/.exec(text))) {
    y = year(match[3]); m = month(match[2]); d = Number(match[1]);
  } else {
    return null;
  }
  const days = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (y < 1900 || y > 2999 || m < 1 || m > 12 || d < 1 || d > days[m - 1]) return null;
  return `${y}-${m < 10 ? '0' : ''}${m}-${d < 10 ? '0' : ''}${d}`;
}

/**
 * Is the fund at least `years` old on `asOf`? Calendar anniversary, inclusive: a fund started 2025-10-24 is one year old on
 * 2026-10-24 (a 29 February start on 1 March). Unknown or unreadable dates answer true, so a value is never dropped for want
 * of a date. The shared "younger than one year" rule: since-inception returns are annualized only from one year on.
 */
export function fundAgeAtLeast(inception: unknown, asOf: unknown, years: number): boolean {
  const start = calendarIso(inception), end = calendarIso(asOf);
  if (!start || !end) return true;
  return end >= `${Number(start.slice(0, 4)) + years}${start.slice(4)}`;
}

/**
 * The returns with every horizon the fund is too young for set to null: `horizons` maps a key of `returns` to the years it
 * needs (`{ yr1: 1, cagr3y: 3, siAnn: 1 }`). Keys that are absent or already null stay as they are; the object is copied.
 */
export function withoutYoungReturns<T extends object>(returns: T, inception: unknown, asOf: unknown, horizons: Record<string, number>): T {
  const out: Record<string, unknown> = { ...(returns as Record<string, unknown>) };
  const keys = Object.keys(horizons);
  for (let i = 0; i < keys.length; i++) {
    if (out[keys[i]] !== undefined && out[keys[i]] !== null && !fundAgeAtLeast(inception, asOf, horizons[keys[i]])) out[keys[i]] = null;
  }
  return out as T;
}
// </calendar-dates>

// <windowed-chart> shared block of .claude/tools/etfs/etf-std/windowed-chart.block.ts, applied by apply-block.ts: never edit it in one repo
export type WindowedChartDay = { date: string; close: number; adjClose: number; volume: number; adjCloseRaw?: number };
export type WindowedChartDividend = { epoch: number; amount: number };

/**
 * A HISTORY_RANGE window (`period1` N years back) never shrinks the published history, and with it the 3y, 5y, 10y and
 * since-inception returns (open-items etfs Q25; was a byte-identical copy in Fidelity, Invesco and JPMorgan). The published
 * rows older than the first fresh day are put in front of the fresh days; their Adj Close is rescaled by the ratio measured on
 * the overlapping days (Yahoo re-adjusts the whole series after each distribution). Published distributions older than the
 * window are kept as well. Returns the chart unchanged when nothing published is older, and null when the window cannot be
 * joined safely (no overlap, Close changed, inconsistent or implausible ratio): the caller then keeps the fund as published.
 * `published` rows carry `Date` (any calendarIso form), `Close`, `Adj Close`, `Volume`; distribution rows are
 * [date, amount, ...] arrays. The chart's days must be sorted by ISO date.
 */
export function mergeWindowedChart<C extends { days: WindowedChartDay[]; dividends: WindowedChartDividend[] }>(chart: C, published: ReadonlyArray<Record<string, unknown>>, publishedDistributions: ReadonlyArray<unknown> = []): C | null {
  if (!chart.days.length || !published.length) return chart;
  const num = (value: unknown): number | null => {
    const text = String(value === null || value === undefined ? '' : value).replace(/[\s,$]/g, '');
    return text && Number.isFinite(Number(text)) ? Number(text) : null;
  };
  const firstFresh = chart.days[0].date;
  const rows: Array<{ date: string; close: number; adjClose: number; volume: number }> = [];
  for (let i = 0; i < published.length; i++) {
    const date = calendarIso(published[i].Date), close = num(published[i].Close), adjClose = num(published[i]['Adj Close']);
    if (date && close !== null && adjClose !== null && adjClose > 0) rows.push({ date, close, adjClose, volume: num(published[i].Volume) || 0 });
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const older = rows.filter((row) => row.date < firstFresh);
  if (!older.length) return chart;
  const byDate = new Map<string, { close: number; adjClose: number }>();
  for (let i = 0; i < rows.length; i++) byDate.set(rows[i].date, rows[i]);
  const adjRatios: number[] = [];
  const closeRatios: number[] = [];
  for (let i = 0; i < chart.days.length; i++) {
    const day = chart.days[i];
    const prior = byDate.get(day.date);
    if (!prior) continue;
    adjRatios.push((day.adjCloseRaw === undefined ? day.adjClose : day.adjCloseRaw) / prior.adjClose);
    if (prior.close > 0) closeRatios.push(day.close / prior.close);
  }
  if (!adjRatios.length) return null;
  const mean = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;
  if (closeRatios.length && Math.abs(mean(closeRatios) - 1) > 1e-3) return null;
  if (Math.max.apply(null, adjRatios) / Math.min.apply(null, adjRatios) - 1 > 5e-3) return null;
  const measured = mean(adjRatios);
  if (measured < 0.5 || measured > 1.001) return null;
  const factor = Math.abs(measured - 1) < 1e-4 ? 1 : measured;
  const days: WindowedChartDay[] = older.map((row) => {
    const raw = row.adjClose * factor;
    return { date: row.date, close: row.close, adjClose: factor === 1 ? row.adjClose : Math.round(raw * 100) / 100, volume: row.volume, adjCloseRaw: raw };
  });
  const firstFreshEpoch = Date.UTC(Number(firstFresh.slice(0, 4)), Number(firstFresh.slice(5, 7)) - 1, Number(firstFresh.slice(8, 10))) / 1000;
  const kept: WindowedChartDividend[] = [];
  for (let i = 0; i < publishedDistributions.length; i++) {
    const cells = publishedDistributions[i];
    const date = Array.isArray(cells) ? calendarIso(cells[0]) : null;
    const amount = Array.isArray(cells) ? num(cells[1]) : null;
    if (!date || amount === null || amount <= 0) continue;
    const epoch = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 1000;
    if (epoch < firstFreshEpoch) kept.push({ epoch, amount });
  }
  kept.sort((a, b) => a.epoch - b.epoch);
  return { ...chart, days: days.concat(chart.days), dividends: kept.concat(chart.dividends.filter((dividend) => dividend.epoch >= firstFreshEpoch)) };
}
// </windowed-chart>

// <fund-selection> shared block of .claude/tools/etfs/etf-std/fund-selection.block.ts, applied by apply-block.ts: never edit it in one repo
/** An index row as far as these helpers read it: the ticker and whether it has published data (`dataFile`, null for a catalog-only row). */
export type FundSelectionRow = { ticker?: unknown; dataFile?: unknown };

function fundSelectionTicker(row: FundSelectionRow): string {
  return String(row.ticker === null || row.ticker === undefined ? '' : row.ticker).trim().toUpperCase();
}

/**
 * The tickers a TICKERS entry may name: the live catalog plus every fund with published data (closed funds included). When
 * the live catalog could not be read (`live` null) every previous index row counts, since nothing tells a real catalog-only
 * row from a stale one. A catalog-only row from an earlier mistyped TICKERS run is therefore not "known" (open-items etfs Q27).
 */
export function knownTickers(live: ReadonlyArray<string> | null, previous: ReadonlyArray<FundSelectionRow>): string[] {
  const out: string[] = [];
  const add = (ticker: string): void => { if (ticker && out.indexOf(ticker) < 0) out.push(ticker); };
  if (live) for (let i = 0; i < live.length; i++) add(String(live[i]).trim().toUpperCase());
  for (let i = 0; i < previous.length; i++) if (!live || previous[i].dataFile) add(fundSelectionTicker(previous[i]));
  return out;
}

/** Throws before any fund request when TICKERS names a fund outside `known` (see knownTickers): a clear error, nothing fetched or written. */
export function assertKnownTickers(selected: ReadonlyArray<string> | null, known: ReadonlyArray<string>, where: string): void {
  const unknown = (selected || []).map((ticker) => String(ticker).trim().toUpperCase()).filter((ticker) => ticker && known.indexOf(ticker) < 0);
  if (unknown.length) throw new Error(`TICKERS: ${unknown.join(', ')} not in ${where}; nothing was fetched or written`);
}

/**
 * The index rows without stale catalog-only rows: a row with no published data whose ticker the live catalog no longer lists
 * (an earlier mistyped TICKERS entry, a fund withdrawn before launch). Rows with data always stay; nothing is dropped when the
 * live catalog could not be read (`live` null).
 */
export function withoutStalePlaceholders<T extends FundSelectionRow>(rows: ReadonlyArray<T>, live: ReadonlyArray<string> | null): T[] {
  if (!live) return rows.slice();
  const listed = live.map((ticker) => String(ticker).trim().toUpperCase());
  return rows.filter((row) => Boolean(row.dataFile) || listed.indexOf(fundSelectionTicker(row)) >= 0);
}

/**
 * New funds of a run (open-items etfs Q28): `published` - first published in this run (the previous index had no row for it,
 * or only a catalog-only one), so a fund whose first read failed is announced when it finally succeeds; `pending` - new in the
 * catalog this run but not published yet. Nothing is reported on a first run (empty previous index).
 */
export function newFundsReport(previous: ReadonlyArray<FundSelectionRow>, next: ReadonlyArray<FundSelectionRow>): { published: string[]; pending: string[] } {
  const report = { published: [] as string[], pending: [] as string[] };
  if (!previous.length) return report;
  const before = new Map<string, boolean>();
  for (let i = 0; i < previous.length; i++) before.set(fundSelectionTicker(previous[i]), Boolean(previous[i].dataFile));
  for (let i = 0; i < next.length; i++) {
    const ticker = fundSelectionTicker(next[i]);
    if (!ticker || before.get(ticker)) continue;
    if (next[i].dataFile) report.published.push(ticker);
    else if (!before.has(ticker)) report.pending.push(ticker);
  }
  report.published.sort();
  report.pending.sort();
  return report;
}

/** The log and step-summary lines of a newFundsReport: `NEW FUNDS: A, B` and `NEW FUNDS (not published yet): C`; none when empty. */
export function newFundsLines(report: { published: ReadonlyArray<string>; pending: ReadonlyArray<string> }): string[] {
  const lines: string[] = [];
  if (report.published.length) lines.push(`NEW FUNDS: ${report.published.join(', ')}`);
  if (report.pending.length) lines.push(`NEW FUNDS (not published yet): ${report.pending.join(', ')}`);
  return lines;
}
// </fund-selection>
