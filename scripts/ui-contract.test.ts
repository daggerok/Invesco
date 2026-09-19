/**
 * UI-contract acceptance tests for the Invesco Watchlist application.
 *
 * These tests boot the REAL app.tsx (the same file index.html loads through
 * Babel standalone) inside happy-dom, serve the REAL generated feed from
 * api/invesco/** through a fetch stub, and drive the application through DOM
 * events exactly like a user would. Expected Watchlist values are computed
 * independently from the feed files, never copied from the app.
 *
 * Run: bun test scripts/ui-contract.test.ts
 */
import { describe, test, expect } from 'bun:test';
import { Window } from 'happy-dom';
import { readFileSync, existsSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';

const REPO_ROOT = dirname(dirname(import.meta.path));
const API_ROOT = join(REPO_ROOT, 'api', 'invesco');
const WATCHLIST_PAGE_SIZE = 500;

// ===========================================================================
// Feed helpers (independent expected-value computation)
// ===========================================================================

type IndexFund = {
  ticker: string;
  name: string;
  category: string;
  holdings: number;
  history: number;
  returns?: { monthEnd?: Record<string, unknown> };
};

const indexJson = JSON.parse(readFileSync(join(API_ROOT, 'index.json'), 'utf8')) as { funds: IndexFund[]; counts: { funds: number; holdings: number; history: number } };
const allFunds: IndexFund[] = indexJson.funds;

function fundByTicker(ticker: string): IndexFund {
  const found = allFunds.find(fund => fund.ticker === ticker);
  if (!found) throw new Error(`unknown ticker ${ticker}`);
  return found;
}

function fundsWithHoldings(): string[] {
  return allFunds.filter(fund => fund.holdings > 0).map(fund => fund.ticker);
}

/** A page row as published: object keyed by the literal headers. */
type FeedRow = Record<string, string>;

const fundRowsCache = new Map<string, { headers: string[]; rows: FeedRow[] }>();

function fundHoldingsRows(ticker: string): { headers: string[]; rows: FeedRow[] } {
  const cached = fundRowsCache.get(ticker);
  if (cached) return cached;
  const meta = JSON.parse(readFileSync(join(API_ROOT, 'funds', ticker, 'meta.json'), 'utf8'));
  const pages: string[] = (meta.holdings && meta.holdings.pages) || [];
  const rows: FeedRow[] = [];
  let headers: string[] = [];
  for (const pagePath of pages) {
    const page = JSON.parse(readFileSync(join(API_ROOT, 'funds', ticker, pagePath), 'utf8'));
    if (!headers.length && Array.isArray(page.headers)) headers = page.headers;
    for (const row of page.rows) rows.push(row);
  }
  const value = { headers, rows };
  fundRowsCache.set(ticker, value);
  return value;
}

/** Mirrors the UI contract's "usable value" rule (blank, -, —, N/A … = missing). */
function usable(value: unknown): string {
  const clean = String(value ?? '').trim();
  return ['', '-', '—', 'n/a', 'na', 'null'].includes(clean.toLowerCase()) ? '' : clean;
}

type ExpectedPosition = { fund: string; symbol: string; name: string; identifier: string; weight: number; marketValue: number };

function fundPositions(ticker: string): ExpectedPosition[] {
  return fundHoldingsRows(ticker).rows.map(row => {
    const publishedTicker = usable(row['Ticker']);
    const identifier = usable(row['Identifier']);
    const name = usable(row['Name']);
    const weightRaw = usable(row['Weight']);
    const marketRaw = usable(row['Market Value']);
    return {
      fund: ticker,
      symbol: publishedTicker || identifier || name,
      name,
      identifier,
      weight: weightRaw === '' ? 0 : Number(weightRaw),
      marketValue: marketRaw === '' ? 0 : Number(marketRaw),
    };
  }).filter(position => usable(position.symbol) !== '');
}

type ExpectedWatchRow = { symbol: string; name: string; funds: string[]; fundCount: number; weightSum: number; maxWeight: number; marketValue: number; identifiers: string[] };

/**
 * Independent aggregation of the feed with the contract's fallback order
 * (Ticker → Identifier → published Name), deduplicated case-insensitively.
 */
function expectedWatchlist(tickers: string[]): Map<string, ExpectedWatchRow> {
  const map = new Map<string, ExpectedWatchRow>();
  for (const ticker of tickers) {
    for (const position of fundPositions(ticker)) {
      const key = position.symbol.toUpperCase();
      let row = map.get(key);
      if (!row) {
        row = { symbol: position.symbol, name: position.name, funds: [], fundCount: 0, weightSum: 0, maxWeight: 0, marketValue: 0, identifiers: [] };
        map.set(key, row);
      }
      if (!row.funds.includes(position.fund)) row.funds.push(position.fund);
      row.weightSum += position.weight;
      row.maxWeight = Math.max(row.maxWeight, position.weight);
      row.marketValue += position.marketValue;
      if (position.identifier && !row.identifiers.includes(position.identifier)) row.identifiers.push(position.identifier);
      if (position.name) row.name = position.name;
    }
  }
  map.forEach(row => { row.fundCount = row.funds.length; row.funds.sort(); });
  return map;
}

// ===========================================================================
// happy-dom harness booting the real app.tsx against the real feed
// ===========================================================================

type Harness = {
  window: any;
  document: any;
  localStorage: { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };
  fetchLog: string[];
};

const harnesses: Harness[] = [];
let bootCounter = 0;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs = 15000, what = 'condition'): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${what}`);
    await sleep(25);
  }
}

/** Waits until no harness has fetched anything new for 250ms (all loads settled). */
async function waitForAllFetchIdle(timeoutMs = 30000): Promise<void> {
  const started = Date.now();
  for (;;) {
    const counts = harnesses.map(h => h.fetchLog.length);
    await sleep(250);
    const after = harnesses.map(h => h.fetchLog.length);
    if (counts.every((count, i) => count === after[i])) return;
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for all fetches to settle');
  }
}

function createHarness(options: { localStorage?: any; shareStorageOf?: Harness; latencyMs?: number; failUrls?: string[] } = {}): Harness {
  bootCounter += 1;
  const window = new Window({ url: 'http://localhost:8080/index.html' });
  const html = readFileSync(join(REPO_ROOT, 'index.html'), 'utf8');
  const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)![1];
  window.document.body.innerHTML = body;

  // A reload shares the very same localStorage instance; a fresh boot can
  // also be seeded with literal key/values.
  const seedFrom = options.shareStorageOf ? options.shareStorageOf.localStorage : null;
  const store = seedFrom ? null : new Map<string, string>();
  const localStorage = seedFrom || {
    getItem: (k: string) => (store!.has(k) ? store!.get(k)! : null),
    setItem: (k: string, v: string) => void store!.set(k, String(v)),
    removeItem: (k: string) => void store!.delete(k),
    clear: () => store!.clear(),
    key: (i: number) => [...store!.keys()][i] ?? null,
    get length() { return store!.size; },
  };
  if (options.localStorage) {
    for (const [key, value] of Object.entries(options.localStorage)) localStorage.setItem(key, String(value));
  }

  const fetchLog: string[] = [];
  const latency = options.latencyMs || 0;
  const failUrls = new Set(options.failUrls || []);
  const fetchImpl = async (input: unknown) => {
    const raw = String(input);
    const url = raw.replace(/^https?:\/\/localhost:8080\//, '').replace(/^\.\//, '');
    if (latency) await sleep(latency);
    fetchLog.push(url);
    const notFound = failUrls.has(url) || url.includes('META-404');
    const filePath = join(REPO_ROOT, url.split('?')[0]);
    if (notFound || !existsSync(filePath)) {
      return { ok: false, status: 404, statusText: 'Not Found', json: async () => { throw new Error(`404 ${url}`); } };
    }
    const data = JSON.parse(readFileSync(filePath, 'utf8'));
    return { ok: true, status: 200, statusText: 'OK', json: async () => data };
  };

  const g = globalThis as any;
  g.window = window;
  g.document = window.document;
  g.localStorage = localStorage;
  g.fetch = fetchImpl;
  g.navigator = { clipboard: { writeText: async () => {} } };
  if (!g.URL.createObjectURL) g.URL.createObjectURL = () => 'blob:fake';
  if (!g.URL.revokeObjectURL) g.URL.revokeObjectURL = () => {};

  const harness: Harness = { window, document: window.document, localStorage, fetchLog };
  harnesses.push(harness);
  return harness;
}

/** Imports a fresh copy of the real app.tsx (module state resets per boot). */
async function bootApp(): Promise<void> {
  const dir = join('/tmp', `invesco-ui-boot-${bootCounter}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'app.tsx'), readFileSync(join(REPO_ROOT, 'app.tsx'), 'utf8'));
  await import(join(dir, 'app.tsx'));
}

async function bootAndWait(options: { localStorage?: any; shareStorageOf?: Harness; latencyMs?: number; failUrls?: string[] } = {}): Promise<Harness> {
  const harness = createHarness(options);
  await bootApp();
  await waitFor(() => harness.document.querySelectorAll('#tabs-bar button[data-tab]').length > 0, 20000, 'catalog tabs to render');
  return harness;
}

// ===========================================================================
// DOM driving helpers
// ===========================================================================

function tabButton(harness: Harness, tabId: string): any {
  return [...harness.document.querySelectorAll('button[data-tab]')].find((button: any) => button.dataset.tab === tabId);
}

function clickTab(harness: Harness, tabId: string): void {
  const button = tabButton(harness, tabId);
  if (!button) throw new Error(`tab button not found: ${tabId}`);
  button.click();
}

function search(harness: Harness, query: string): void {
  const input = harness.document.getElementById('search-input');
  input.value = query;
  input.dispatchEvent(new harness.window.Event('input', { bubbles: true }));
}

function clickRowCheckbox(harness: Harness, ticker: string): void {
  const box = harness.document.querySelector(`input[data-checkbox="${ticker}"]`);
  if (!box) throw new Error(`row checkbox not found: ${ticker}`);
  box.click();
}

function rowCheckboxes(harness: Harness): any[] {
  return [...harness.document.querySelectorAll('#table-body input[data-checkbox]')];
}

function visibleRowTickers(harness: Harness): string[] {
  return [...harness.document.querySelectorAll('#table-body tr[data-ticker]')].map((row: any) => row.dataset.ticker);
}

function clickSortHeader(harness: Harness, key: string): void {
  const button = harness.document.querySelector(`#table-head button[data-sort="${key}"]`);
  if (!button) throw new Error(`sort header not found: ${key}`);
  button.click();
}

function sortHeaderArrow(harness: Harness, key: string): string {
  const button = harness.document.querySelector(`#table-head button[data-sort="${key}"]`);
  return button ? button.textContent.trim() : '';
}

function watchlistTabLabel(harness: Harness): string {
  const button = tabButton(harness, 'watchlist');
  return button ? button.textContent.trim() : '';
}

/** Extracts the count shown in the Watchlist tab label; null while loading. */
function watchlistTabCount(harness: Harness): number | null {
  const label = watchlistTabLabel(harness);
  const match = /\(([\d,]+)\)$/.exec(label);
  return match ? Number(match[1].replace(/,/g, '')) : null;
}

function selectedTickersInStorage(harness: Harness): string[] {
  return JSON.parse(harness.localStorage.getItem('invesco-selected-etfs') || '[]');
}

function subtitleBadges(harness: Harness): string[] {
  return [...harness.document.querySelectorAll('#selected-etf-summary button[data-selected-fund]')].map((button: any) => button.dataset.selectedFund);
}

function tableBodyText(harness: Harness): string {
  return harness.document.getElementById('table-body').textContent;
}

function findWatchlistRow(harness: Harness, symbol: string): any | null {
  return [...harness.document.querySelectorAll('#table-body tr')].find((row: any) => {
    const cells = row.querySelectorAll('td');
    return cells.length > 1 && cells[1].textContent.trim() === symbol;
  }) || null;
}

function watchlistRowCells(row: any): string[] {
  return [...row.querySelectorAll('td')].map((cell: any) => cell.textContent.trim());
}

function parsePercentCell(cell: string): number {
  return Number(cell.replace('%', ''));
}

const TOTAL_FUNDS = allFunds.length;
const NON_BLACKLISTED_COUNT = TOTAL_FUNDS; // no blacklist seeded in these flows

// ===========================================================================
// 15. Feed consistency (index.json ↔ meta.json ↔ pages)
// ===========================================================================

describe('feed consistency: index/meta/page counts agree', () => {
  test('every fund manifest agrees with index.json and every page exists', () => {
    let holdingsRows = 0;
    let historyRows = 0;
    for (const fund of allFunds) {
      const metaPath = join(API_ROOT, 'funds', fund.ticker, 'meta.json');
      expect(existsSync(metaPath)).toBe(true);
      const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
      for (const sheet of ['holdings', 'history'] as const) {
        const manifest = meta[sheet] || {};
        const pages: string[] = manifest.pages || [];
        let sheetRows = 0;
        for (const pagePath of pages) {
          const pageFile = join(API_ROOT, 'funds', fund.ticker, pagePath);
          expect(existsSync(pageFile)).toBe(true);
          const page = JSON.parse(readFileSync(pageFile, 'utf8'));
          expect(Array.isArray(page.headers)).toBe(true);
          expect(Array.isArray(page.rows)).toBe(true);
          expect(page.rows.length).toBeGreaterThan(0);
          sheetRows += page.rows.length;
        }
        expect(sheetRows).toBe(manifest.totalRows);
        const catalogCount = sheet === 'holdings' ? fund.holdings : fund.history;
        expect(catalogCount).toBe(manifest.totalRows);
      }
      holdingsRows += fund.holdings;
      historyRows += fund.history;
    }
    expect(holdingsRows).toBe(indexJson.counts.holdings);
    expect(historyRows).toBe(indexJson.counts.history);
    expect(fundsWithHoldings().length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// 1. Per-tab sort persistence through every button, Clear and reload
// ===========================================================================

describe('acceptance 1: per-tab sort survives every control and reload', () => {
  test('sort by a non-default column round-trips through tabs, buttons, Clear and reload', async () => {
    const maxYtdFund = allFunds.reduce((best, fund) => {
      const ytd = Number((fund.returns && fund.returns.monthEnd && fund.returns.monthEnd.ytd) ?? NaN);
      const bestYtd = Number((best.returns && best.returns.monthEnd && best.returns.monthEnd.ytd) ?? NaN);
      return Number.isFinite(ytd) && ytd > bestYtd ? fund : best;
    }, allFunds[0]);

    const harness = await bootAndWait();
    clickSortHeader(harness, 'ytd');
    expect(sortHeaderArrow(harness, 'ytd')).toBe('YTD Return ↓');
    expect(visibleRowTickers(harness)[0]).toBe(maxYtdFund.ticker);
    expect(JSON.parse(harness.localStorage.getItem('invesco-tab-sorts') || '{}')).toEqual({ All: { key: 'ytd', dir: 'desc' } });

    // Round-trip through detail + Watchlist tabs and back to All ETFs.
    clickRowCheckbox(harness, 'QQQ');
    clickTab(harness, 'detail:overview');
    clickTab(harness, 'watchlist');
    clickTab(harness, 'All');
    expect(sortHeaderArrow(harness, 'ytd')).toBe('YTD Return ↓');
    expect(visibleRowTickers(harness)[0]).toBe(maxYtdFund.ticker);

    // Round-trip through a category tab.
    clickTab(harness, fundByTicker('BAB').category);
    expect(harness.document.querySelector('button[data-tab="All"]')).toBeTruthy();
    clickTab(harness, 'All');
    expect(sortHeaderArrow(harness, 'ytd')).toBe('YTD Return ↓');

    // Row Use checkbox + header select-all + All ETFs pill checkbox.
    clickRowCheckbox(harness, 'QQQM');
    clickRowCheckbox(harness, 'QQQM');
    harness.document.querySelector('#select-all-checkbox').click();
    harness.document.querySelector('#select-all-checkbox').click();
    harness.document.querySelector('#select-all-toggle').click();
    harness.document.querySelector('#select-all-toggle').click();
    expect(sortHeaderArrow(harness, 'ytd')).toBe('YTD Return ↓');

    // Search, Copy Tickers, CSV/TXT export, theme toggle.
    search(harness, 'qqq');
    expect(sortHeaderArrow(harness, 'ytd')).toBe('YTD Return ↓');
    search(harness, '');
    harness.document.getElementById('copy-btn').click();
    harness.document.getElementById('export-csv-btn').click();
    harness.document.getElementById('export-txt-btn').click();
    harness.document.getElementById('theme-toggle').click();
    expect(sortHeaderArrow(harness, 'ytd')).toBe('YTD Return ↓');

    // Blacklist add + restore.
    harness.document.getElementById('blacklist-btn').click();
    const input = harness.document.getElementById('blacklist-input');
    input.value = 'QQQ';
    harness.document.getElementById('blacklist-add-btn').click();
    expect(selectedTickersInStorage(harness)).not.toContain('QQQ');
    const chip = harness.document.querySelector('button[data-unblacklist="QQQ"]');
    chip.click();
    expect(sortHeaderArrow(harness, 'ytd')).toBe('YTD Return ↓');

    // Clear resets only selection + searches — never the remembered sort.
    harness.document.getElementById('reset-btn').click();
    expect(sortHeaderArrow(harness, 'ytd')).toBe('YTD Return ↓');
    expect(visibleRowTickers(harness)[0]).toBe(maxYtdFund.ticker);
    expect(selectedTickersInStorage(harness)).toEqual([]);
    expect(JSON.parse(harness.localStorage.getItem('invesco-tab-sorts') || '{}')).toEqual({ All: { key: 'ytd', dir: 'desc' } });
    expect(harness.document.getElementById('search-input').value).toBe('');

    // Full reload: the remembered sort comes back from localStorage.
    const reloaded = await bootAndWait({ shareStorageOf: harness });
    await waitFor(() => visibleRowTickers(reloaded).length > 0, 10000, 'reloaded catalog rows');
    expect(sortHeaderArrow(reloaded, 'ytd')).toBe('YTD Return ↓');
    expect(visibleRowTickers(reloaded)[0]).toBe(maxYtdFund.ticker);
  }, 60000);
});

// ===========================================================================
// 2 + 3. Header Use select-all operates on the visible (filtered) rows only
// ===========================================================================

describe('acceptance 2+3: filtered header select-all scope', () => {
  test('checking header Use with a filter selects exactly the visible tickers', async () => {
    const harness = await bootAndWait();
    search(harness, 'nasdaq 100 etf');
    await waitFor(() => visibleRowTickers(harness).length === 2, 5000, 'filtered rows');
    expect(visibleRowTickers(harness).sort()).toEqual(['QQMG', 'QQQM']);

    harness.document.querySelector('#select-all-checkbox').click();
    expect(selectedTickersInStorage(harness).sort()).toEqual(['QQMG', 'QQQM']);
    expect(harness.document.querySelector('#select-all-checkbox').checked).toBe(true);
  }, 30000);

  test('unchecking header Use removes only the visible tickers; hidden selections survive', async () => {
    const harness = await bootAndWait();
    // Select the whole catalog first (no filter → whole-catalog pill scope).
    harness.document.querySelector('#select-all-toggle').click();
    expect(selectedTickersInStorage(harness).length).toBe(NON_BLACKLISTED_COUNT);

    search(harness, 'nasdaq 100 etf');
    await waitFor(() => visibleRowTickers(harness).length === 2, 5000, 'filtered rows');
    harness.document.querySelector('#select-all-checkbox').click();
    const selected = selectedTickersInStorage(harness);
    expect(selected).not.toContain('QQMG');
    expect(selected).not.toContain('QQQM');
    expect(selected).toContain('QQQ');
    expect(selected.length).toBe(NON_BLACKLISTED_COUNT - 2);
    expect(harness.document.querySelector('#select-all-checkbox').checked).toBe(false);
  }, 30000);
});

// ===========================================================================
// 4. All ETFs pill checkbox always selects the whole non-blacklisted catalog
// ===========================================================================

describe('acceptance 4: All ETFs pill checkbox is whole-catalog scoped', () => {
  test('pill checkbox on a category tab selects every non-blacklisted ETF without changing the tab', async () => {
    const harness = await bootAndWait();
    const category = fundByTicker('BAB').category; // Fixed Income
    clickTab(harness, category);
    expect(visibleRowTickers(harness).length).toBe(allFunds.filter(fund => fund.category === category).length);

    harness.document.querySelector('#select-all-toggle').click();
    expect(selectedTickersInStorage(harness).length).toBe(NON_BLACKLISTED_COUNT);
    // The checkbox toggles selection only — it must not navigate away.
    expect(harness.document.querySelector(`button[data-tab="${category}"]`).classList.contains('bg-blue-600')).toBe(true);

    harness.document.querySelector('#select-all-toggle').click();
    expect(selectedTickersInStorage(harness)).toEqual([]);
  }, 30000);

  test('pill checkbox works from the Watchlist tab with an active search filter', async () => {
    const harness = await bootAndWait();
    clickRowCheckbox(harness, 'QQQ');
    clickTab(harness, 'watchlist');
    search(harness, 'apple');
    harness.document.querySelector('#select-all-toggle').click();
    expect(selectedTickersInStorage(harness).length).toBe(NON_BLACKLISTED_COUNT);
    expect(tabButton(harness, 'watchlist').classList.contains('bg-blue-600')).toBe(true);
  }, 30000);
});

// ===========================================================================
// 5. Watchlist shows Loading… then the exact deduplicated count
// ===========================================================================

describe('acceptance 5: Watchlist transitions from Loading… to the exact count', () => {
  test('selecting one ETF shows a loading state, then the exact count without further user action', async () => {
    const harness = await bootAndWait({ latencyMs: 40 });
    const expectedCount = expectedWatchlist(['QQQ']).size;

    clickRowCheckbox(harness, 'QQQ');
    // Immediately after the click the count is not yet known: the tab must
    // not display a misleading exact "Watchlist (0)".
    expect(watchlistTabLabel(harness)).not.toMatch(/\(0\)/);
    expect(watchlistTabLabel(harness)).toMatch(/Loading…|\d+\+/);

    await waitForAllFetchIdle();
    await waitFor(() => watchlistTabCount(harness) === expectedCount, 15000, `exact Watchlist count ${expectedCount}`);
    expect(watchlistTabLabel(harness)).toBe(`Watchlist (${expectedCount.toLocaleString('en-US')})`);
  }, 60000);
});

// ===========================================================================
// 6. Rapid overlapping selections with latency: no duplicate/skipped pages
// ===========================================================================

describe('acceptance 6: rapid overlapping selections stay race-free', () => {
  test('two overlapping ETFs + deselect/reselect load every page exactly once', async () => {
    const harness = await bootAndWait({ latencyMs: 25 });
    const expected = expectedWatchlist(['RSP', 'SPLV']);
    const sharedTicker = 'FE'; // present in both RSP and SPLV sheets
    const expectedShared = expected.get(sharedTicker)!;
    expect(expectedShared.fundCount).toBe(2);

    // Select both funds as fast as the user can click.
    clickRowCheckbox(harness, 'RSP');
    clickRowCheckbox(harness, 'SPLV');
    // Rapid deselect/reselect while pages are still in flight.
    await sleep(60);
    clickRowCheckbox(harness, 'RSP');
    await sleep(20);
    clickRowCheckbox(harness, 'RSP');

    await waitForAllFetchIdle();
    await waitFor(() => watchlistTabCount(harness) === expected.size, 15000, `exact Watchlist count ${expected.size}`);

    // Every holdings page (and meta.json) was fetched exactly once per ticker.
    const counts = new Map<string, number>();
    for (const url of harness.fetchLog) counts.set(url, (counts.get(url) || 0) + 1);
    const duplicated = [...counts.entries()].filter(([url, count]) => count > 1 && url.includes('/funds/'));
    expect(duplicated).toEqual([]);

    for (const ticker of ['RSP', 'SPLV']) {
      const meta = JSON.parse(readFileSync(join(API_ROOT, 'funds', ticker, 'meta.json'), 'utf8'));
      for (const page of meta.holdings.pages) {
        const url = `api/invesco/funds/${ticker}/${page}`;
        expect(counts.get(url)).toBe(1);
      }
      expect(counts.get(`api/invesco/funds/${ticker}/meta.json`)).toBe(1);
    }

    // The overlapping security aggregates exactly across both funds.
    clickTab(harness, 'watchlist');
    await waitFor(() => findWatchlistRow(harness, sharedTicker) !== null, 10000, `Watchlist row ${sharedTicker}`);
    const cells = watchlistRowCells(findWatchlistRow(harness, sharedTicker)!);
    expect(Number(cells[4])).toBe(expectedShared.fundCount);
    expect(Math.abs(parsePercentCell(cells[5]) - expectedShared.weightSum)).toBeLessThan(0.0011);
    expect(Math.abs(parsePercentCell(cells[6]) - expectedShared.maxWeight)).toBeLessThan(0.0011);
    const badgeTickers = [...findWatchlistRow(harness, sharedTicker)!.querySelectorAll('button[data-watchlist-fund]')].map((button: any) => button.dataset.watchlistFund);
    expect(badgeTickers.sort()).toEqual(['RSP', 'SPLV']);
  }, 60000);
});

// ===========================================================================
// 7. Deselecting an ETF updates every selection surface immediately
// ===========================================================================

describe('acceptance 7: deselection updates subtitle, badges, tabs and Watchlist', () => {
  test('deselecting one of two ETFs recomputes all selection surfaces immediately', async () => {
    const harness = await bootAndWait();
    clickRowCheckbox(harness, 'QQQ');
    clickRowCheckbox(harness, 'QQQM');
    await waitForAllFetchIdle();
    const expectedBoth = expectedWatchlist(['QQQ', 'QQQM']).size;
    await waitFor(() => watchlistTabCount(harness) === expectedBoth, 15000, 'Watchlist count for both ETFs');

    expect(subtitleBadges(harness)).toEqual(['QQQ', 'QQQM']);
    expect(tabButton(harness, 'detail:overview').textContent).toContain('QQQM');
    expect(harness.localStorage.getItem('invesco-active-fund')).toBe('QQQM');

    const expectedOne = expectedWatchlist(['QQQ']).size;
    clickRowCheckbox(harness, 'QQQM'); // deselect — render is synchronous
    expect(subtitleBadges(harness)).toEqual(['QQQ']);
    expect(selectedTickersInStorage(harness)).toEqual(['QQQ']);
    expect(tabButton(harness, 'detail:overview').textContent).toContain('QQQ Overview');
    expect(harness.localStorage.getItem('invesco-active-fund')).toBe('QQQ');
    await waitFor(() => watchlistTabCount(harness) === expectedOne, 15000, 'Watchlist count for QQQ only');

    clickTab(harness, 'watchlist');
    const rows = harness.document.querySelectorAll('#table-body tr').length;
    expect(rows).toBe(expectedOne); // every remaining row renders for this selection

    // A search that matches no Watchlist rows gets a search-specific empty state.
    search(harness, 'zzzz-no-such-holding');
    expect(tableBodyText(harness)).toContain('No Watchlist holdings match your search.');
    search(harness, '');
  }, 60000);
});

// ===========================================================================
// 8. Select-all: exact aggregate count, bounded DOM rendering
// ===========================================================================

describe('acceptance 8: whole-catalog Watchlist is exact and chunked', () => {
  test('selecting every ETF aggregates the whole feed exactly and renders in chunks', async () => {
    const harness = await bootAndWait();
    const tickers = fundsWithHoldings();
    const expectedCount = expectedWatchlist(tickers).size;

    harness.document.querySelector('#select-all-toggle').click();
    // Wait until loading finished: the tab shows the exact count (no +, no Loading).
    await waitFor(() => {
      const label = watchlistTabLabel(harness);
      return /\(\d[\d,]*\)$/.test(label) && watchlistTabCount(harness) === expectedCount;
    }, 60000, `exact whole-catalog Watchlist count ${expectedCount}`);

    clickTab(harness, 'watchlist');
    let rendered = harness.document.querySelectorAll('#table-body tr').length;
    expect(rendered).toBeGreaterThan(0);
    // DOM rendering stays bounded: a chunked window, never the whole catalog.
    expect(rendered).toBeLessThanOrEqual(2 * WATCHLIST_PAGE_SIZE);
    expect(rendered).toBeLessThan(expectedCount);
    // The exact total (not the rendered chunk) drives the count badge.
    expect(harness.document.getElementById('ticker-count').textContent).toBe(`${expectedCount.toLocaleString('en-US')} holdings`);

    // Growing one more chunk through the sentinel stays bounded too.
    const sentinel = harness.document.getElementById('static-load-sentinel');
    if (!sentinel.classList.contains('hidden')) {
      sentinel.click();
      const grown = harness.document.querySelectorAll('#table-body tr').length;
      expect(grown).toBeGreaterThan(0);
      expect(grown).toBeLessThanOrEqual(3 * WATCHLIST_PAGE_SIZE);
    }
  }, 120000);
});

// ===========================================================================
// 9. Reload with persisted selection and active fund
// ===========================================================================

describe('acceptance 9: reload restores selection, active fund and background loading', () => {
  test('a fresh boot recovers selection, active ticker, detail tabs and the Watchlist', async () => {
    const first = await bootAndWait();
    clickRowCheckbox(first, 'QQQ');
    clickRowCheckbox(first, 'QQQM');
    // Clicking the catalog ticker opens that fund's details and makes it active.
    first.document.querySelector('button[data-open-fund="QQQM"]').click();
    await waitForAllFetchIdle();
    expect(first.localStorage.getItem('invesco-active-fund')).toBe('QQQM');

    const expectedCount = expectedWatchlist(['QQQ', 'QQQM']).size;
    const reloaded = await bootAndWait({ shareStorageOf: first });
    expect(selectedTickersInStorage(reloaded).sort()).toEqual(['QQQ', 'QQQM']);
    expect(subtitleBadges(reloaded)).toEqual(['QQQ', 'QQQM']);
    // Active fund restored (still selected) → detail tabs recover for it.
    expect(tabButton(reloaded, 'detail:overview').textContent).toContain('QQQM');
    // Background holdings loading rebuilds the Watchlist without any checkbox click.
    await waitFor(() => watchlistTabCount(reloaded) === expectedCount, 30000, `restored Watchlist count ${expectedCount}`);
    clickTab(reloaded, 'watchlist');
    expect(reloaded.document.querySelectorAll('#table-body tr').length).toBeGreaterThan(0);
  }, 60000);
});

// ===========================================================================
// 10. Detail tabs render real rows for a data-rich fund
// ===========================================================================

describe('acceptance 10: detail tabs load real data and later pages', () => {
  test('BAB overview/holdings/history/distributions render real rows and page in', async () => {
    const harness = await bootAndWait();
    harness.document.querySelector('button[data-open-fund="BAB"]').click();
    expect(harness.document.querySelector('#selected-tabs-panel').classList.contains('is-visible')).toBe(true);

    // Overview: real provider return data (Invesco month-end series).
    clickTab(harness, 'detail:overview');
    const overviewText = tableBodyText(harness);
    const babReturns = fundByTicker('BAB').returns;
    const monthEnd: Record<string, unknown> = (babReturns && babReturns.monthEnd) || {};
    expect(overviewText).toContain('YTD (ME)');
    expect(overviewText).toContain(`${Number(monthEnd.ytd).toFixed(2)}%`);

    // Holdings: rows render with the feed's literal headers, and the unified
    // holdings cache (selection preload + detail view) loads every page.
    clickTab(harness, 'detail:holdings');
    await waitFor(() => harness.document.querySelectorAll('#table-body tr').length > 100, 20000, 'BAB holdings rows');
    const holdingsHeaders = [...harness.document.querySelectorAll('#table-head th')].map((th: any) => th.textContent.trim());
    expect(holdingsHeaders.slice(1)).toEqual(fundHoldingsRows('BAB').headers);
    // BAB publishes 1,867 rows over 8 pages — all of them load.
    const babMeta = JSON.parse(readFileSync(join(API_ROOT, 'funds', 'BAB', 'meta.json'), 'utf8'));
    expect(babMeta.holdings.totalRows).toBe(fundByTicker('BAB').holdings);
    expect(babMeta.holdings.pages.length).toBeGreaterThan(1);
    await waitFor(
      () => harness.document.getElementById('app-subtitle').textContent.includes(`${babMeta.holdings.totalRows.toLocaleString('en-US')} rows loaded`),
      20000,
      'all BAB holdings pages',
    );

    // History: real rows from the Yahoo NAV history pages; history is not
    // preloaded, so later pages stream in through the sentinel (lazy paging).
    clickTab(harness, 'detail:history');
    await waitFor(() => harness.document.querySelectorAll('#table-body tr').length >= 1000, 20000, 'BAB history first page');
    expect(harness.document.getElementById('app-subtitle').textContent).toContain('NAV History');
    const historyFirst = harness.document.querySelectorAll('#table-body tr').length;
    expect(historyFirst).toBeLessThan(babMeta.history.totalRows);
    harness.document.getElementById('static-load-sentinel').click();
    await waitFor(() => harness.document.querySelectorAll('#table-body tr').length > historyFirst, 20000, 'next history page via sentinel');

    // Distributions: real ex-date/amount rows from meta.json.
    clickTab(harness, 'detail:distributions');
    await waitFor(() => harness.document.querySelectorAll('#table-body tr').length > 5, 20000, 'BAB distributions rows');
    const distHeaders = [...harness.document.querySelectorAll('#table-head th')].map((th: any) => th.textContent.trim());
    expect(distHeaders).toContain('Ex-Date');
    expect(distHeaders).toContain('Amount');
  }, 60000);
});

// ===========================================================================
// 11. Fund without a workbook shows an explanatory state
// ===========================================================================

describe('acceptance 11: fund without holdings workbook', () => {
  test('opening a holdings-less fund replaces the previous table with an explanation', async () => {
    const harness = await bootAndWait();
    const noHoldingsFund = allFunds.find(fund => fund.holdings === 0)!;
    expect(noHoldingsFund).toBeTruthy();

    // First show a fund WITH a holdings table…
    harness.document.querySelector('button[data-open-fund="BAB"]').click();
    clickTab(harness, 'detail:holdings');
    await waitFor(() => harness.document.querySelectorAll('#table-body tr').length > 100, 20000, 'BAB holdings rows');

    // …then switch to the workbook-less fund: the old table must be gone.
    clickTab(harness, 'All');
    harness.document.querySelector('button[data-open-fund="' + noHoldingsFund.ticker + '"]').click();
    clickTab(harness, 'detail:holdings');
    let bodyText = tableBodyText(harness);
    expect(bodyText).toContain(noHoldingsFund.ticker);
    expect(bodyText).toMatch(/publishes no holdings workbook|no published holdings/i);
    expect(harness.document.querySelectorAll('#table-body tr').length).toBe(1);

    // Only the holdings-less fund selected → the Watchlist explains that no
    // holdings data is available (never "no search matches").
    clickTab(harness, 'All');
    clickRowCheckbox(harness, 'BAB'); // deselect BAB, keep the holdings-less fund
    clickTab(harness, 'watchlist');
    await waitFor(() => tableBodyText(harness).includes('Holdings data is not available yet'), 10000, 'not-available Watchlist state');
  }, 60000);

  test('fetch failures produce a failure state, not a "no matches" message', async () => {
    const harness = await bootAndWait({ failUrls: ['api/invesco/funds/BAB/meta.json'] });
    clickRowCheckbox(harness, 'BAB');
    clickTab(harness, 'detail:holdings');
    await waitFor(() => tableBodyText(harness).includes('Holdings data is not available yet for BAB'), 10000, 'fetch-failure detail state');
    expect(tableBodyText(harness)).toContain('Run the data refresh workflow');
    // The Watchlist reports the load failure explicitly.
    clickTab(harness, 'watchlist');
    await waitFor(() => tableBodyText(harness).includes('could not be loaded'), 10000, 'fetch-failure Watchlist state');
  }, 60000);
});

// ===========================================================================
// 12. Identifier fallbacks: bond rows and name-only rows are kept
// ===========================================================================

describe('acceptance 12: identifier and name fallbacks keep valid rows', () => {
  test('bond rows without ticker are keyed by identifier; loan/cash rows by name', async () => {
    const harness = await bootAndWait();

    // BAB: municipal bonds with Ticker "-" keyed by CUSIP/ISIN identifier.
    const babRows = fundHoldingsRows('BAB').rows;
    const bondRow = babRows.find(row => usable(row['Ticker']) === '' && usable(row['Identifier']) !== '')!;
    expect(bondRow).toBeTruthy();

    // BKLN: loan rows with neither ticker nor identifier — the published
    // name is the final fallback and the row must not be discarded.
    const bklnRows = fundHoldingsRows('BKLN').rows;
    const nameOnlyRow = bklnRows.find(row => usable(row['Ticker']) === '' && usable(row['Identifier']) === '' && usable(row['Name']) !== '')!;
    expect(nameOnlyRow).toBeTruthy();

    clickRowCheckbox(harness, 'BAB');
    clickRowCheckbox(harness, 'BKLN');
    const expected = expectedWatchlist(['BAB', 'BKLN']);
    await waitFor(() => watchlistTabCount(harness) === expected.size, 30000, `fallback Watchlist count ${expected.size}`);

    clickTab(harness, 'watchlist');
    // Bond row appears with its identifier as the security key.
    await waitFor(() => findWatchlistRow(harness, bondRow['Identifier'].trim()) !== null, 10000, 'identifier-keyed bond row');
    const bondCells = watchlistRowCells(findWatchlistRow(harness, bondRow['Identifier'].trim())!);
    expect(bondCells[2]).toBe(bondRow['Name'].trim());
    // Name-only loan row appears too (nothing else identifies it).
    await waitFor(() => findWatchlistRow(harness, nameOnlyRow['Name'].trim()) !== null, 10000, 'name-keyed loan row');
    expect(expected.get(nameOnlyRow['Name'].trim().toUpperCase())).toBeTruthy();
  }, 60000);
});

// ===========================================================================
// 13. Sticky columns
// ===========================================================================

describe('acceptance 13: sticky Use/Ticker columns', () => {
  test('catalog Use/Ticker th+td cells and Watchlist Ticker cells are sticky', async () => {
    const harness = await bootAndWait();

    const headerCells = [...harness.document.querySelectorAll('#table-head th')];
    expect(headerCells[1].className).toContain('catalog-sticky-use');
    expect(headerCells[1].className).toContain('catalog-sticky-col');
    expect(headerCells[2].className).toContain('catalog-sticky-ticker');
    expect(headerCells[2].className).toContain('catalog-sticky-col');
    expect(headerCells[0].className).not.toContain('catalog-sticky');

    const bodyRow = harness.document.querySelector('#table-body tr');
    const bodyCells = [...bodyRow.querySelectorAll('td')];
    expect(bodyCells[1].className).toContain('catalog-sticky-use');
    expect(bodyCells[2].className).toContain('catalog-sticky-ticker');

    // The stylesheet owns the sticky geometry + opaque backgrounds.
    const html = readFileSync(join(REPO_ROOT, 'index.html'), 'utf8');
    expect(html).toContain('#table-scroll .catalog-sticky-use{left:0');
    expect(html).toContain('#table-scroll .catalog-sticky-ticker{left:5rem');
    expect(html).toContain('border-collapse:separate');
    expect(html).not.toContain('class="w-full text-left border-collapse');

    // Watchlist Ticker is pinned at the left edge (th and td directly).
    clickRowCheckbox(harness, 'QQQ');
    clickTab(harness, 'watchlist');
    await waitFor(() => harness.document.querySelector('#table-body td.watchlist-sticky-ticker') !== null, 20000, 'watchlist data rows');
    const watchHeaderCells = [...harness.document.querySelectorAll('#table-head th')];
    expect(watchHeaderCells[1].className).toContain('watchlist-sticky-ticker');
    const watchRow = harness.document.querySelector('#table-body tr');
    expect([...watchRow.querySelectorAll('td')][1].className).toContain('watchlist-sticky-ticker');
    expect(html).toContain('#table-scroll .watchlist-sticky-ticker{position:sticky;left:0');
  }, 60000);
});

// ===========================================================================
// 14. Malformed localStorage cannot crash boot
// ===========================================================================

describe('acceptance 14: malformed localStorage never crashes boot', () => {
  test('garbage in every persisted key still boots, and valid sorts still apply', async () => {
    const garbage = {
      'invesco-selected-etfs': '{oops',
      'invesco-blacklisted-etfs': '[[[',
      'invesco-searches': 'nope',
      'invesco-active-fund': 'QQQ',
      'invesco-theme': 'dark',
      'invesco-tab-sorts': JSON.stringify({
        All: { key: 'ytd', dir: 'desc' },        // valid
        watchlist: { key: 5, dir: 'sideways' },  // malformed entry
        'detail:holdings': { key: '', dir: 'asc' }, // empty key
        junk: 'not-an-object',
      }),
    };
    const harness = await bootAndWait({ localStorage: garbage });
    expect(harness.document.getElementById('ticker-count').textContent).toBe(`${TOTAL_FUNDS} ETFs`);
    // The valid remembered sort still applies; malformed entries are ignored.
    expect(sortHeaderArrow(harness, 'ytd')).toBe('YTD Return ↓');
    // Restored selection falls back to a clean state instead of crashing.
    expect(subtitleBadges(harness)).toEqual([]);
  }, 30000);
});
