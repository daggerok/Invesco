/// <reference types="bun" />
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { CONTROL_NAMES, main, readConfig, resolveControls, runtimeControls } from './update-data';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const file = JSON.parse(read('scripts/update-data.config.json')) as Record<string, string>;

test('precedence: file < advanced < nonblank input < environment', () => {
  const c = resolveControls({ CONCURRENCY: 2, TICKERS: 'QQQ' }, { CONCURRENCY: 3, TICKERS: 'RSP' }, { CONCURRENCY: '4', TICKERS: '' }, { INVESCO_CONCURRENCY: '5', CONCURRENCY: '6' });
  expect(c.CONCURRENCY).toBe('5');
  expect(c.TICKERS).toBe('RSP');
  expect(resolveControls({ CONCURRENCY: 2 }, { CONCURRENCY: 3 }, { CONCURRENCY: '4' }).CONCURRENCY).toBe('4');
  expect(resolveControls({ CONCURRENCY: 2 }, { CONCURRENCY: 3 }).CONCURRENCY).toBe('3');
  expect(resolveControls({ SKIP_YAHOO: true }, {}, {}, { SKIP_YAHOO: 'false' }).SKIP_YAHOO).toBe('false');
  expect(resolveControls({ MAX_FETCHES: 5 }, {}, {}, { INVESCO_LIMIT: '7' }).MAX_FETCHES).toBe('7');
  expect(resolveControls({ HISTORY_PAGE_SIZE: 5 }, {}, {}, { HISTORICAL_PAGE_SIZE: '9' }).HISTORY_PAGE_SIZE).toBe('9');
  expect(resolveControls({ STORE_RAW_DOWNLOADS: 'false' }, {}, {}, { INVESCO_STORE_RAW_DOWNLOADS: 'true' }).STORE_RAW_DOWNLOADS).toBe('true');
});

test('blank input inherits the file value, advanced may deliberately blank a key', () => {
  expect(resolveControls({ TICKERS: 'QQQ' }, {}, { TICKERS: '' }).TICKERS).toBe('QQQ');
  expect(resolveControls({ CONCURRENCY: 2 }, {}, { CONCURRENCY: '' }).CONCURRENCY).toBe('2');
  expect(resolveControls({ TICKERS: 'QQQ' }, { TICKERS: '' }, { TICKERS: '' }).TICKERS).toBe('');
});

test('scheduled path (empty inputs and advanced) equals the config defaults', () => {
  expect(resolveControls(file, {}, {})).toEqual(file);
  const config = readConfig(resolveControls(file, {}, {}));
  expect(config.tickers).toEqual([]);
  expect(config.maxFetches).toBe(0);
  expect(config.requestSleep).toBe(1);
  expect(config.concurrency).toBe(2);
  expect(config.holdingsPageSize).toBe(250);
  expect(config.historyPageSize).toBe(1000);
  expect(config.maxRetries).toBe(2);
  expect(config.historyRange).toBe('max');
  expect(config.audienceType).toBe('Investor');
  expect(config.storeRawDownloads).toBe(false);
  expect(config.pricesHistory).toBe(true);
  expect(config.edgarFallback).toBe(true);
  expect(config.skipYahoo).toBe(false);
  expect(config.skipInvesco).toBe(false);
  expect(config.aumRange).toBeUndefined();
  expect(config.terRange).toBeUndefined();
  expect(config.dividendYieldRange).toBeUndefined();
  expect(config.performanceRanges).toEqual({});
  expect(config.totalReturnRanges).toEqual({});
  expect(config.productListUrl).toContain('invesco.com');
  expect(config.catalogHtmlUrl).toContain('invesco.com');
  expect(config.secUa).toContain('Invesco');
});

test('protected variables (SEC_UA, AUDIENCE_TYPE, STORE_RAW_DOWNLOADS) win over file, advanced and inputs', () => {
  const c = resolveControls(file, { AUDIENCE_TYPE: 'Advisor', SEC_UA: 'adv' }, { STORE_RAW_DOWNLOADS: 'false' }, { SEC_UA: 'protected-ua', AUDIENCE_TYPE: 'Advisor', STORE_RAW_DOWNLOADS: 'true' });
  expect(c.SEC_UA).toBe('protected-ua');
  const config = readConfig(c);
  expect(config.audienceType).toBe('Advisor');
  expect(config.storeRawDownloads).toBe(true);
  expect(config.secUa).toBe('protected-ua');
});

test('resolver rejects unknown, invalid and environment-file injection values', () => {
  for (const value of [{ UNKNOWN: 1 }, { OUTPUT_DIR: 'x' }, { SEC_UA: 'x\nEVIL=yes' }, { CONCURRENCY: 0 }, { MAX_RETRIES: 0 }, { MAX_FETCHES: 1.5 }, { MAX_FETCHES: -1 },
    { HOLDINGS_PAGE_SIZE: 'abc' }, { REQUEST_SLEEP: '-1' }, { VERBOSE: 'maybe' }, { SKIP_YAHOO: 'perhaps' }, { AUM: 'huge' }, { AUM: '5:1' }, { TER: '1' },
    { PERFORMANCE_1Y: '15' }, { PRODUCT_LIST_URL: 'http://example.com/x' }, { TICKERS: ['QQQ'] }, { TICKERS: { a: 1 } }, null, [], 'text']) {
    expect(() => resolveControls(value)).toThrow();
  }
  expect(() => resolveControls({}, '{}')).toThrow();
  expect(() => resolveControls({}, { SEC_UA: 'x\rfoo' })).toThrow();
  expect(() => resolveControls({}, {}, { TICKERS: 'a\nb' })).toThrow();
  expect(() => resolveControls({}, {}, {}, { INVESCO_SEC_UA: 'x\0bad' })).toThrow();
  expect(() => JSON.parse('{bad')).toThrow();
});

test('runtimeControls reads the config file and honors explicit env overrides', async () => {
  expect(await runtimeControls({})).toEqual(file);
  expect((await runtimeControls({ TICKERS: 'QQQ RSP', MAX_FETCHES: '3' })).TICKERS).toBe('QQQ RSP');
});

test('config keys == CONTROL_NAMES == README rows == --help entries', async () => {
  expect(Object.keys(file).sort()).toEqual([...CONTROL_NAMES].sort());
  for (const value of Object.values(file)) expect(typeof value).toBe('string');
  expect(JSON.stringify(file)).not.toMatch(/@(?!daggerok\.example\.com)/);
  const doc = read('README.md');
  // README lists the five tenors of PERFORMANCE_* / TOTAL_RETURN_* on one row: `PREFIX_YTD` / `_1Y` / ...
  for (const name of CONTROL_NAMES) {
    const tenor = name.match(/^(PERFORMANCE|TOTAL_RETURN)_(1Y|3Y|5Y|10Y)$/);
    expect(doc).toContain(tenor ? '`_' + tenor[2] + '`' : '`' + name + '`');
    if (tenor) expect(doc).toContain('`' + tenor[1] + '_YTD`');
  }
  expect(doc).toContain('scripts/update-data.config.json');
  const logs: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => { logs.push(args.join(' ')); };
  try { await main(['--help'], {}); } finally { console.log = original; }
  const help = logs.join('\n');
  for (const name of CONTROL_NAMES) {
    const tenor = name.match(/^(PERFORMANCE|TOTAL_RETURN)_(1Y|3Y|5Y|10Y)$/);
    if (tenor) continue; // help lists the tenors on the `<PREFIX>_YTD` row ("also 1Y, 3Y, 5Y, 10Y")
    expect(help).toMatch(new RegExp(`^  ${name}\\s`, 'm'));
  }
});

test('workflow: input limit, advanced, schedule, fixed output dir, no direct input interpolation', () => {
  const text = read('.github/workflows/update-data.yml');
  const workflow = (Bun as unknown as { YAML: { parse(text: string): any } }).YAML.parse(text);
  const inputs = workflow.on.workflow_dispatch.inputs as Record<string, { default?: string; type: string }>;
  const names = Object.keys(inputs);
  expect(names.length).toBeLessThanOrEqual(25);
  expect(inputs.advanced.default).toBe('{}');
  expect(inputs.advanced.type).toBe('string');
  for (const name of names.filter((n) => n !== 'advanced')) {
    expect(CONTROL_NAMES).toContain(name.toUpperCase() as (typeof CONTROL_NAMES)[number]);
    expect(inputs[name].default).toBe('');
  }
  // vars-backed controls stay out of the dispatch inputs and are applied as protected overrides
  for (const hidden of ['sec_ua', 'audience_type', 'store_raw_downloads']) expect(names).not.toContain(hidden);
  expect(text).toContain('vars.SEC_UA');
  expect(text).toContain('vars.INVESCO_AUDIENCE_TYPE');
  expect(text).toContain('vars.STORE_RAW_DOWNLOADS');
  expect(workflow.on.schedule.some((s: { cron: string }) => s.cron === '0 0 * * 0')).toBe(true);
  expect(text).toContain('toJSON(inputs)');
  expect(text).toContain('resolveControls');
  expect(text).not.toMatch(/\$\{\{\s*(inputs|github\.event\.inputs)\./);
  expect(text).not.toMatch(/OUTPUT_DIR|OUT_DIR/);
  expect(names.some((n) => /out(put)?_?dir/i.test(n))).toBe(false);
  expect(text).toContain('git add api/invesco\n          if git diff --cached --quiet -- api/invesco');
  expect([...text.matchAll(/git add (\S+)/g)].map((m) => m[1])).toEqual(['api/invesco']);
  expect(text).toContain('if: ${{ !cancelled() }}');
  expect(text).not.toContain('bunx tsc');
});
