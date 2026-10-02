// Bun's test runner provides these globals at runtime.
// @ts-ignore bun types are intentionally not required for this zero-dependency Bun script.
import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  parseRange,
  parseAumRange,
  normalizeNumberText,
  normalizeInvescoCategory,
  parseNport,
  parseNportAccessions,
  nportUrlFor,
  pickEftsCik,
  parseFundTickerMap,
  parseCompanyTickerMap,
  edgarSeriesFilingsUrl,
  parseEdgarAtomFilings,
  parseChart,
  priceReturns,
  lastCompletedQuarterEnd,
  annualizedToTotal,
  totalToAnnualized,
  indicatedYield,
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
  invescoProductDetailUrl,
  dngUrl,
  parseSitemapFundPages,
  isFundPageUrl,
  parseFundPage,
  parseDngPerformance,
  parseDngPrices,
  parseDngYields,
  parseDngHoldings,
  indexRowFromMeta,
  runUpdater,
  setApiRootForTests,
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
// Range parsers (same contract as daggerok/iShares, daggerok/SPDR, daggerok/Fidelity)
// ---------------------------------------------------------------------------

describe('parseRange', () => {
  test('empty and ":" mean no restriction', () => {
    expect(parseRange('', 'X')).toBeUndefined();
    expect(parseRange(':', 'X')).toBeUndefined();
  });

  test('inclusive bounds', () => {
    expect(parseRange('1:5', 'X')).toEqual({ min: 1, max: 5 });
    expect(parseRange('2:', 'X')).toEqual({ min: 2, max: undefined });
    expect(parseRange(':3', 'X')).toEqual({ min: undefined, max: 3 });
  });

  test('percent signs and $ signs are optional', () => {
    expect(parseRange('0.1%:0.5%', 'X')).toEqual({ min: 0.1, max: 0.5 });
    expect(parseRange('$1:$2', 'X')).toEqual({ min: 1, max: 2 });
  });

  test('colonless values are rejected', () => {
    expect(() => parseRange('15', 'X')).toThrow(/colon is required/);
  });

  test('min greater than max is rejected', () => {
    expect(() => parseRange('5:1', 'X')).toThrow(/must not exceed/);
  });
});

describe('parseAumRange', () => {
  test('empty and ":" mean no restriction', () => {
    expect(parseAumRange('')).toBeUndefined();
    expect(parseAumRange(':')).toBeUndefined();
  });

  test('numeric bounds with K/M/B/T suffixes', () => {
    expect(parseAumRange('10M:2B')).toEqual({ min: 10_000_000, max: 2_000_000_000 });
    expect(parseAumRange('1B:')).toEqual({ min: 1_000_000_000, max: undefined });
  });

  test('preset bounds', () => {
    expect(parseAumRange('nano')).toEqual({ min: 0, max: 10_000_000 });
    expect(parseAumRange('micro')).toEqual({ min: 10_000_000, max: 300_000_000 });
    expect(parseAumRange('small')).toEqual({ min: 300_000_000, max: 2_000_000_000 });
    expect(parseAumRange('mid')).toEqual({ min: 2_000_000_000, max: 10_000_000_000 });
    expect(parseAumRange('large')).toEqual({ min: 10_000_000_000, max: undefined });
  });

  test('colonless values are rejected', () => {
    expect(() => parseAumRange('42')).toThrow(/colon is required/);
  });
});

// ---------------------------------------------------------------------------
// Small numeric helpers
// ---------------------------------------------------------------------------

describe('normalizeNumberText', () => {
  test('expands scientific notation', () => {
    expect(normalizeNumberText('2.97057744E8')).toBe('297057744');
    expect(normalizeNumberText('1.5e-3')).toBe('0.0015');
  });

  test('keeps plain numbers and text untouched', () => {
    expect(normalizeNumberText('1,234.56')).toBe('1234.56');
    expect(normalizeNumberText('Apple Inc')).toBe('Apple Inc');
    expect(normalizeNumberText('')).toBe('');
    expect(normalizeNumberText('-')).toBe('-');
  });
});

describe('numberOrNull', () => {
  test('accepts the invesco.com placeholder styles', () => {
    expect(numberOrNull('--')).toBeNull();
    expect(numberOrNull('—')).toBeNull();
    expect(numberOrNull('N/A')).toBeNull();
    expect(numberOrNull('4.56')).toBe(4.56);
    expect(numberOrNull('$1,234.56')).toBe(1234.56);
    expect(numberOrNull('0.40%')).toBe(0.4);
  });
});

describe('toIsoDate / formatInvescoDate / formatEdgarDate', () => {
  test('US and ISO dates both normalize to ISO', () => {
    expect(toIsoDate('08/21/2026')).toBe('2026-08-21');
    expect(toIsoDate('2026-08-21')).toBe('2026-08-21');
    expect(toIsoDate('2026-8-1')).toBe('2026-08-01');
    expect(toIsoDate('n/a')).toBe('n/a');
  });

  test('Invesco renders MM/DD/YYYY, the feed renders "Mon D YYYY"', () => {
    expect(formatInvescoDate('2026-08-21')).toBe('08/21/2026');
    expect(formatEdgarDate('2026-06-30')).toBe('Jun 30 2026');
  });

  test('epoch days convert to ISO', () => {
    expect(epochToIsoDate(Date.UTC(2026, 0, 15) / 1000)).toBe('2026-01-15');
  });
});

describe('normalizeInvescoCategory', () => {
  test('uses the asset class part of the Invesco grouping', () => {
    expect(normalizeInvescoCategory('Equity, US Equity')).toBe('US Equity');
    expect(normalizeInvescoCategory('Fixed Income, High Yield')).toBe('Fixed Income');
    expect(normalizeInvescoCategory('Alternative, Absolute Return')).toBe('Alternatives');
    expect(normalizeInvescoCategory('Real Assets & Commodities, Agriculture')).toBe('Real Assets');
    expect(normalizeInvescoCategory('Digital Assets,')).toBe('Digital Assets');
    expect(normalizeInvescoCategory('')).toBe('ETF');
  });

  test('title-cases unknown labels instead of dropping them', () => {
    expect(normalizeInvescoCategory('Something New, Detail')).toBe('Something New');
  });
});

describe('nport fixtures', () => {
  test('parses positions, identifiers and the report period', () => {
    const xml = `
      <nportRegDoc><genInfo><regName>INVESCO SERIES TRUST</regName><regCik>0000913760</regCik>
      <seriesName>Invesco QQQ Trust</seriesName><seriesId>S000004816</seriesId>
      <repPdDate>2026-06-30</repPdDate></genInfo>
      <invstOrSec><name>Apple Inc</name><cusip>037833100</cusip><balance>124827810</balance>
      <valUSD>26312454069.90</valUSD><pctVal>8.24</pctVal><assetCat>EC</assetCat></invstOrSec>
      <invstOrSec><title>US TREASURY 4.125% 05/15/2028</title>
      <identifiers><cusip value="912810H80"/></identifiers><balance>5000000</balance>
      <valUSD>5100000</valUSD><pctVal>2.5</pctVal><assetCat>OB</assetCat></invstOrSec>
      </nportRegDoc>`;
    const parsed = parseNport(xml);
    expect(parsed.seriesName).toBe('Invesco QQQ Trust');
    expect(parsed.regCik).toBe('0000913760');
    expect(parsed.repPdDate).toBe('2026-06-30');
    expect(parsed.holdings.length).toBe(2);
    expect(parsed.holdings[0].Identifier).toBe('037833100');
    expect(parsed.holdings[0].Ticker).toBe('-');
    expect(parsed.holdings[1].Identifier).toBe('912810H80');
    expect(parsed.holdings[1].Name).toBe('US TREASURY 4.125% 05/15/2028');
    expect(parsed.totalValue).toBeCloseTo(26317554069.9, 1);
    expect(parsed.netAssets).toBeNull();
  });

  test('reads the reported net assets when the filing carries a fundInfo block', () => {
    const parsed = parseNport(
      '<genInfo><seriesName>Invesco S&amp;P 500 Equal Weight ETF</seriesName><repPdDate>2026-04-30</repPdDate></genInfo>' +
        '<fundInfo><totAssets>88500000000.00</totAssets><netAssets>87850000000.00</netAssets></fundInfo>' +
        '<invstOrSec><name>MGM Resorts International</name><cusip>552953101</cusip><valUSD>180990316.32</valUSD><pctVal>0.2059893365</pctVal></invstOrSec>',
    );
    expect(parsed.netAssets).toBe(87850000000);
    expect(parsed.holdings.length).toBe(1);
  });

  test('falls back to other identifiers when the CUSIP is N/A', () => {
    const parsed = parseNport(
      '<invstOrSec><name>FUND X</name><cusip>N/A</cusip><identifiers><other value="XSCUSIP1"/></identifiers><valUSD>10</valUSD></invstOrSec>',
    );
    expect(parsed.holdings[0].Identifier).toBe('XSCUSIP1');
  });

  test('tolerates empty bodies and missing values', () => {
    expect(() => parseNport('')).not.toThrow();
    const parsed = parseNport('<genInfo><seriesName>Empty</seriesName></genInfo>');
    expect(parsed.holdings).toEqual([]);
    expect(parsed.totalValue).toBe(0);
  });

  test('submissions parser keeps only NPORT-P forms and builds the archive URL', () => {
    const accessions = parseNportAccessions({
      cik: '913760',
      filings: {
        recent: {
          form: ['NPORT-P', '13F-HR', 'NPORT-P'],
          accessionNumber: ['0000913760-26-000111', '0000913760-26-000112', '0000913760-26-000113'],
          filingDate: ['2026-07-21', '2026-08-10', '2026-04-21'],
          reportDate: ['2026-06-30', '2026-06-30', '2026-03-31'],
        },
      },
    });
    expect(accessions.map((entry) => entry.accession)).toEqual(['0000913760-26-000111', '0000913760-26-000113']);
    expect(accessions[0].url).toBe(nportUrlFor('0000913760', '0000913760-26-000111'));
    expect(accessions[0].url).toContain('/Archives/edgar/data/913760/000091376026000111/primary_doc.xml');
  });
});

describe('pickEftsCik', () => {
  const payload = {
    hits: [
      { _source: { display_names: { cik: 12345, names: ['Some Other Trust'] } } },
      { _source: { display_names: { cik: 913760, names: ['Invesco QQQ Trust', 'INVESCO SERIES TRUST'] } } },
    ],
  };
  test('chooses the registrant whose name matches the fund', () => {
    expect(pickEftsCik(payload, 'Invesco QQQ Trust')).toBe('0000913760');
  });

  test('returns null when nothing matches', () => {
    expect(pickEftsCik(payload, 'Unknown Fund')).toBeNull();
  });

  test('reads the real EDGAR full-text search payload shape', () => {
    const real = {
      hits: {
        total: { value: 2, relation: 'eq' },
        hits: [
          { _source: { ciks: ['0001667919'], display_names: ['FIRST TRUST EXCHANGE-TRADED FUND VIII  (CIK 0001667919)'] } },
          { _source: { ciks: ['0001209466'], display_names: ['INVESCO EXCHANGE-TRADED FUND TRUST  (CIK 0001209466)'] } },
        ],
      },
    };
    expect(pickEftsCik(real, 'Invesco Exchange-Traded Fund Trust')).toBe('0001209466');
    expect(pickEftsCik(real, '')).toBe('0001667919');
  });
});

describe('SEC lookup tables', () => {
  const fundTickers = {
    fields: ['cik', 'seriesId', 'classId', 'symbol'],
    data: [
      [1209466, 'S000060812', 'C000197628', 'RSP'],
      [1067839, 'S000101292', 'C000271435', 'QQQ'],
      [1378872, 'S000019246', 'C000053072', 'bab'],
      [0, 'S000000000', 'C000000000', 'ZZZ'],
    ],
  };

  test('maps every ticker to its registrant CIK and series', () => {
    const map = parseFundTickerMap(fundTickers);
    expect(map.get('RSP')).toEqual({ cik: '0001209466', seriesId: 'S000060812', classId: 'C000197628' });
    expect(map.get('QQQ')?.cik).toBe('0001067839');
    expect(map.get('BAB')?.seriesId).toBe('S000019246');
    expect(map.has('ZZZ')).toBe(false);
  });

  test('tolerates an unusable payload', () => {
    expect(parseFundTickerMap({}).size).toBe(0);
    expect(parseFundTickerMap({ fields: ['cik'], data: ['nope'] }).size).toBe(0);
  });

  test('maps issuer names back to exchange tickers', () => {
    const map = parseCompanyTickerMap({
      '0': { cik_str: 1045810, ticker: 'NVDA', title: 'NVIDIA CORP' },
      '1': { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' },
      '2': { cik_str: 1, ticker: '', title: 'No Ticker Inc' },
    });
    expect(map.get(normalizeHoldingName('NVIDIA Corp'))).toBe('NVDA');
    expect(map.get(normalizeHoldingName('Apple Inc.'))).toBe('AAPL');
    expect(map.get(normalizeHoldingName('No Ticker Inc'))).toBeUndefined();
  });
});

describe('EDGAR series filings', () => {
  const atom = `<?xml version="1.0" encoding="ISO-8859-1"?>
    <feed>
      <entry>
        <accession-number>0001209466-26-000952</accession-number>
        <filing-date>2026-06-29</filing-date>
        <filing-href>https://www.sec.gov/Archives/edgar/data/1209466/000120946626000952/0001209466-26-000952-index.htm</filing-href>
        <filing-type>NPORT-P</filing-type>
      </entry>
      <entry>
        <accession-number>0001209466-26-000514</accession-number>
        <filing-date>2026-04-01</filing-date>
        <filing-href>https://www.sec.gov/Archives/edgar/data/1209466/000120946626000514/0001209466-26-000514-index.htm</filing-href>
        <filing-type>NPORT-P</filing-type>
      </entry>
      <entry>
        <accession-number>0001209466-26-000001</accession-number>
        <filing-date>2026-01-05</filing-date>
        <filing-type>N-CEN</filing-type>
      </entry>
    </feed>`;

  test('builds the browse-edgar Atom URL for one series', () => {
    const url = edgarSeriesFilingsUrl('S000060812', 5);
    expect(url).toContain('https://www.sec.gov/cgi-bin/browse-edgar?');
    expect(url).toContain('CIK=S000060812');
    expect(url).toContain('type=NPORT-P');
    expect(url).toContain('output=atom');
    expect(url).toContain('count=5');
  });

  test('keeps N-PORT-P entries newest first and builds the primary document URL', () => {
    const filings = parseEdgarAtomFilings(atom);
    expect(filings.map((entry) => entry.accession)).toEqual(['0001209466-26-000952', '0001209466-26-000514']);
    expect(filings[0].filed).toBe('2026-06-29');
    expect(filings[0].url).toBe('https://www.sec.gov/Archives/edgar/data/1209466/000120946626000952/primary_doc.xml');
  });

  test('tolerates an empty or unrelated feed', () => {
    expect(parseEdgarAtomFilings('')).toEqual([]);
    expect(parseEdgarAtomFilings('<feed><entry><filing-type>10-K</filing-type></entry></feed>')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// History layers (Yahoo chart + the optional invesco.com prices CSV)
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
          meta: {
            fullExchangeName: 'NasdaqGS',
            longName: 'Invesco QQQ Trust',
            navPrice: 706.3,
            regularMarketPrice: 706.32,
            regularMarketTime: Date.UTC(2026, 7, 21, 20, 0) / 1000,
            firstTradeDate: start,
          },
          timestamp: timestamps,
          indicators: { quote: [{ close: closes, volume: timestamps.map(() => 1000) }], adjclose: [{ adjclose: adj }] },
          events: { dividends: options.dividends ?? {} },
        },
      ],
    },
  };
}

describe('chart fixtures', () => {
  test('builds trading days, skips null closes, keeps adjusted closes', () => {
    const chart = parseChart(chartFixture({ closes: [100, null, 110], adj: [90, null, 99] }));
    expect(chart.days.map((day) => day.close)).toEqual([100, 110]);
    expect(chart.days.map((day) => day.adjClose)).toEqual([90, 99]);
    expect(chart.navPrice).toBe(706.3);
    expect(chart.exchangeName).toBe('NasdaqGS');
  });

  test('falls back to raw closes when adjclose is absent', () => {
    const payload = chartFixture({ closes: [100, 101] }) as any;
    delete payload.chart.result[0].indicators.adjclose;
    const chart = parseChart(payload);
    expect(chart.days.map((day) => day.adjClose)).toEqual([100, 101]);
  });

  test('sorts dividends chronologically and drops non-positive amounts', () => {
    const chart = parseChart(
      chartFixture({
        dividends: {
          '2': { date: Date.UTC(2026, 5, 15) / 1000, amount: 0.7 },
          '1': { date: Date.UTC(2026, 2, 15) / 1000, amount: 0.65 },
          '0': { date: Date.UTC(2025, 11, 15) / 1000, amount: -1 },
        },
      }),
    );
    expect(chart.dividends.map((entry) => entry.amount)).toEqual([0.65, 0.7]);
  });

  test('throws on an empty result', () => {
    expect(() => parseChart({ chart: { result: [] } })).toThrow(/empty result/);
  });
});

describe('priceReturns', () => {
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

  test('derives YTD, 1Y, CAGRs and SI anchored to the last close', () => {
    const returns = priceReturns(days, now);
    expect(returns.asOfDate).toBe('2026-08-21');
    // Each anchor is the last trading day at or before the period start, so a
    // thin fixture keeps falling back to the newest day that is early enough.
    expect(returns.ytd).toBeCloseTo(54.21, 2); // 2023-01-03 (the 2026-01-01 anchor)
    expect(returns.yr1).toBeCloseTo(54.21, 2); // 2023-01-03 (nothing between 2025 and 2023)
    expect(returns.cagr3y).toBeCloseTo(15.53, 2); // 2026-01-02 (3y before 2026-08-21)
    expect(returns.mo1).toBeCloseTo(5.77, 2); // 2026-07-01 (the 2026-07-21 anchor)
    expect(returns.siAnn).toBeGreaterThan(0);
  });

  test('young funds produce nulls instead of made-up returns', () => {
    const young = priceReturns([{ date: '2026-08-20', close: 10, adjClose: 10, volume: 1 }], now);
    expect(young.asOfDate).toBe('2026-08-20');
    expect(young.ytd).toBeNull();
    expect(young.cagr3y).toBeNull();
    expect(young.siAnn).toBeNull();
  });

  test('empty history yields an empty returns block', () => {
    expect(priceReturns([], now).asOfDate).toBe('');
  });
});

describe('lastCompletedQuarterEnd', () => {
  test('anchors to the last completed quarter', () => {
    expect(lastCompletedQuarterEnd(new Date(Date.UTC(2026, 7, 21))).toISOString().slice(0, 10)).toBe('2026-06-30');
    expect(lastCompletedQuarterEnd(new Date(Date.UTC(2026, 0, 15))).toISOString().slice(0, 10)).toBe('2025-12-31');
    expect(lastCompletedQuarterEnd(new Date(Date.UTC(2026, 4, 1))).toISOString().slice(0, 10)).toBe('2026-03-31');
    expect(lastCompletedQuarterEnd(new Date(Date.UTC(2026, 10, 1))).toISOString().slice(0, 10)).toBe('2026-09-30');
  });
});

// ---------------------------------------------------------------------------
// Derived metrics
// ---------------------------------------------------------------------------

describe('annualizedToTotal / totalToAnnualized', () => {
  test('annualizedToTotal inverts annualization exactly', () => {
    expect(annualizedToTotal(20.15, 3)).toBeCloseTo(73.45, 2);
    expect(annualizedToTotal(null, 3)).toBeNull();
    expect(annualizedToTotal(10, 0)).toBeNull();
  });

  test('round-trips through totalToAnnualized', () => {
    expect(totalToAnnualized(annualizedToTotal(12.5, 5), 5)).toBeCloseTo(12.5, 1);
  });

  test('guards bad input', () => {
    expect(totalToAnnualized('n/a' as any, 5)).toBeNull();
  });
});

describe('indicatedYield', () => {
  test('computes latest distribution x frequency / price', () => {
    expect(indicatedYield(0.7, 4, 706.32)).toBeCloseTo(0.4, 1);
    expect(indicatedYield(0.65, 12, 41.72)).toBe(18.7);
  });

  test('guards missing pieces', () => {
    expect(indicatedYield(null, 4, 10)).toBeNull();
    expect(indicatedYield(0.5, 0, 10)).toBeNull();
    expect(indicatedYield(0.5, 4, 0)).toBeNull();
  });
});

describe('inferDistributionFrequency', () => {
  test('detects quarterly and monthly cadences', () => {
    const quarterly = [0, 1, 2, 3].map((i) => ({ epoch: Date.UTC(2026, 0 + i * 3, 15) / 1000, amount: 1 }));
    expect(inferDistributionFrequency(quarterly).frequency).toBe('Quarterly');
    const monthly = Array.from({ length: 6 }, (_, i) => ({ epoch: Date.UTC(2026, i, 15) / 1000, amount: 1 }));
    expect(inferDistributionFrequency(monthly)).toEqual({ frequency: 'Monthly', paymentsPerYear: 12 });
  });

  test('no distributions means None (commodity / crypto style funds)', () => {
    expect(inferDistributionFrequency([])).toEqual({ frequency: 'None', paymentsPerYear: null });
  });
});

describe('deriveCatalogMetrics', () => {
  test('official Invesco returns win over the derived ones', () => {
    const metrics = deriveCatalogMetrics(
      { ytd: 15.97, yr1: 18.34, yr3: 20.15, yr5: 17.42, yr10: 16.88, sinceInception: 19.44 },
      { asOfDate: '2026-08-21', ytd: 13.79, yr1: 54.21, cagr3y: 18.99, cagr5y: 12, cagr10y: 11, siAnn: 10, mo1: 1, qtd: 2 },
      0.44,
      null,
      null,
      null,
      706.32,
      'Yahoo chart API',
      '2026-07-31',
    );
    expect(metrics.ytd).toBe(15.97);
    expect(metrics.tr1y).toBe(18.34);
    expect(metrics.cagr3y).toBe(20.15);
    expect(metrics.tr3y).toBe(annualizedToTotal(20.15, 3));
    expect(metrics.dividendYield).toBe(0.44);
    expect(metrics.secYield).toBeNull();
    expect(metrics.returnsBasis).toContain('official Invesco month-end NAV total returns');
    expect(metrics.performanceAsOf).toBe('2026-07-31');
    // returnsBasis then performanceAsOf close the object
    expect(Object.keys(metrics).slice(-2)).toEqual(['returnsBasis', 'performanceAsOf']);
  });

  test('official returns without a published returns date keep performanceAsOf null', () => {
    const metrics = deriveCatalogMetrics(
      { ytd: 1, yr1: null, yr3: null, yr5: null, yr10: null, sinceInception: null },
      { asOfDate: '2026-08-21', ytd: 2, yr1: 3, cagr3y: null, cagr5y: null, cagr10y: null, siAnn: null, mo1: null, qtd: null },
      null, null, null, null, null,
    );
    expect(metrics.performanceAsOf).toBeNull();
    expect(String(metrics.returnsBasis)).toContain('filled from adjusted closes');
  });

  test('falls back to derived returns and the indicated yield', () => {
    const metrics = deriveCatalogMetrics(
      { ytd: null, yr1: null, yr3: null, yr5: null, yr10: null, sinceInception: null },
      { asOfDate: '2026-08-21', ytd: 13.79, yr1: 54.21, cagr3y: 18.99, cagr5y: null, cagr10y: null, siAnn: null, mo1: null, qtd: null },
      null,
      null,
      0.65,
      12,
      41.72,
    );
    expect(metrics.ytd).toBe(13.79);
    expect(metrics.tr1y).toBe(54.21);
    expect(metrics.cagr5y).toBeNull();
    expect(metrics.dividendYield).toBe(18.7);
    expect(metrics.dividendYieldText).toBe('18.70%');
    expect(metrics.returnsBasis).toContain('derived from adjusted market-price closes');
    expect(metrics.returnsBasis).toContain('estimates');
    expect(metrics.performanceAsOf).toBe('2026-08-21');
    expect(Object.keys(metrics).slice(-2)).toEqual(['returnsBasis', 'performanceAsOf']);
  });

  test('basis is never empty or a dash and the date is ISO or null', () => {
    for (const hasOfficial of [true, false]) {
      for (const date of ['2026-08-21', '', null, 'Aug 21 2026']) {
        const { returnsBasis, performanceAsOf } = returnsBasisFields(hasOfficial, date, 'Yahoo chart API', date);
        expect(returnsBasis.trim().length).toBeGreaterThan(1);
        expect(returnsBasis).not.toBe('-');
        expect(performanceAsOf === null || /^\d{4}-\d{2}-\d{2}$/.test(performanceAsOf)).toBe(true);
      }
    }
  });
});

describe('returns as-of date (performanceAsOf source)', () => {
  test('lastHistoryIsoDate takes the newest stored close, label or ISO', () => {
    expect(lastHistoryIsoDate([{ Date: 'Dec 15 2025' }, { Date: 'Feb 23 2026' }])).toBe('2026-02-23');
    expect(lastHistoryIsoDate([{ Date: '2026-07-17' }, { Date: 'Jan 05 2026' }])).toBe('2026-07-17');
    expect(lastHistoryIsoDate([{ Date: '—' }])).toBeNull();
    expect(lastHistoryIsoDate([])).toBeNull();
  });

  test('withReturnsBasis appends basis and date at the end of the returns block', () => {
    const block = withReturnsBasis({ derivedFrom: 'x', returnsBasis: 'old', monthEnd: {} }, { returnsBasis: 'b', performanceAsOf: '2026-07-31' });
    expect(Object.keys(block!)).toEqual(['derivedFrom', 'monthEnd', 'returnsBasis', 'performanceAsOf']);
    expect(withReturnsBasis(null, {})).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Holding name normalization and the ticker seed
// ---------------------------------------------------------------------------

describe('normalizeHoldingName', () => {
  test('strips legal-form suffixes and fillers', () => {
    expect(normalizeHoldingName('Apple Inc.')).toBe('APPLE');
    expect(normalizeHoldingName('Microsoft Corp Common Stock')).toBe('MICROSOFT');
    expect(normalizeHoldingName('THE BOEING CO')).toBe('BOEING');
    // share classes are canonicalized, never dropped: GOOG and GOOGL must not collide
    expect(normalizeHoldingName('Alphabet Inc. Class C Capital Stock')).toBe('ALPHABET CL C');
    expect(normalizeHoldingName('Alphabet Inc. Class A Common Stock')).toBe('ALPHABET CL A');
    expect(normalizeHoldingName('Alphabet Inc Cl C')).toBe('ALPHABET CL C');
  });

  test('core form drops the remaining spaces', () => {
    expect(normalizeHoldingNameCore('Apple Inc.')).toBe('APPLE');
  });

  test('share classes stay distinguishable', () => {
    expect(normalizeHoldingName('Alphabet Inc Cl A')).not.toBe(normalizeHoldingName('Alphabet Inc Cl C'));
  });

  test('a trailing security word is peeled, a lone one is not', () => {
    expect(normalizeHoldingName('Berkshire Hathaway Inc Del')).toBe('BERKSHIRE HATHAWAY');
    // "Cap Stk" is not in the filler/suffix vocabulary (it is only normalized,
    // never dropped): the class marker survives, which is what matters.
    expect(normalizeHoldingName('Berkshire Hathaway Inc Cap Stk Cl A')).toBe('BERKSHIRE HATHAWAY CL A');
    expect(normalizeHoldingName('Berkshire Hathaway Inc Cap Stock Class A')).toBe('BERKSHIRE HATHAWAY CL A');
  });

  test('empty and junk names normalize to empty', () => {
    expect(normalizeHoldingName('')).toBe('');
    expect(normalizeHoldingName('---')).toBe('');
  });
});

describe('cleanHoldingTicker', () => {
  test('keeps class-share markers', () => {
    expect(cleanHoldingTicker('brk-b')).toBe('BRK-B');
    expect(cleanHoldingTicker('SCE^L')).toBe('SCE^L');
    expect(cleanHoldingTicker('BF/A')).toBe('BF/A');
  });

  test('rejects placeholders', () => {
    expect(cleanHoldingTicker('')).toBe('');
    expect(cleanHoldingTicker('N/A')).toBe('');
    expect(cleanHoldingTicker('see file')).toBe('');
  });
});

describe('invesco URL builders', () => {
  test('invescoProductDetailUrl builds product detail URL with audience', () => {
    expect(invescoProductDetailUrl('QQQ')).toBe('https://www.invesco.com/us/financial-products/etfs/product-detail?audienceType=Investor&ticker=QQQ');
    expect(invescoProductDetailUrl('RSP', 'Advisor')).toBe('https://www.invesco.com/us/financial-products/etfs/product-detail?audienceType=Advisor&ticker=RSP');
  });

});

// ---------------------------------------------------------------------------
// Client-side catalog helpers (app.tsx)
//
// app.tsx is compiled in the browser by Babel standalone and calls init() at
// module scope, so it cannot be imported here. The catalog's frequency column
// is nevertheless a pure function of the published data and its coded labels
// are what the column sorts on, so its source is extracted and exercised
// directly instead of being left untested.
// ---------------------------------------------------------------------------

const APP_SOURCE = readFileSync(new URL('../app.tsx', import.meta.url), 'utf8');

function extractClientFunction(name: string): (...args: any[]) => any {
  const match = new RegExp(`function ${name}\\(([^)]*)\\)[^{]*\\{([\\s\\S]*?)\\n    \\}`).exec(APP_SOURCE);
  if (!match) throw new Error(`${name} not found in app.tsx`);
  const parameters = match[1]
    .split(',')
    .map(parameter => parameter.split(':')[0].split('=')[0].trim())
    .filter(Boolean)
    .join(', ');
  return new Function(parameters, match[2]) as (...args: any[]) => any;
}

const formatDistributionFrequency = extractClientFunction('formatDistributionFrequency');

describe('formatDistributionFrequency (catalog Frequency column)', () => {
  test('codes the published cadences with a sortable two-digit prefix', () => {
    expect(formatDistributionFrequency('Monthly')).toBe('01 - Monthly');
    expect(formatDistributionFrequency('Quarterly')).toBe('04 - Quarterly');
    expect(formatDistributionFrequency('Semiannually')).toBe('06 - Semi-annually');
    expect(formatDistributionFrequency('Annually')).toBe('12 - Annually');
    expect(formatDistributionFrequency('None')).toBe('00 - None');
    expect(formatDistributionFrequency('Unknown')).toBe('00 - Unknown');
    expect(formatDistributionFrequency('Irregular')).toBe('99 - Irregular');
  });

  test('accepts the hyphenated spellings and is case-insensitive', () => {
    expect(formatDistributionFrequency('semi-annually')).toBe('06 - Semi-annually');
    expect(formatDistributionFrequency('Semi-Annual')).toBe('06 - Semi-annually');
    expect(formatDistributionFrequency('semiannual')).toBe('06 - Semi-annually');
    expect(formatDistributionFrequency('annual')).toBe('12 - Annually');
    expect(formatDistributionFrequency('monthly')).toBe('01 - Monthly');
  });

  test('treats missing data as "00 - None" instead of dropping the cell', () => {
    expect(formatDistributionFrequency(undefined)).toBe('00 - None');
    expect(formatDistributionFrequency(null)).toBe('00 - None');
    expect(formatDistributionFrequency('')).toBe('00 - None');
    expect(formatDistributionFrequency('  ')).toBe('00 - None');
    expect(formatDistributionFrequency('-')).toBe('00 - None');
    expect(formatDistributionFrequency('—')).toBe('00 - None');
  });

  test('passes an unknown published value through unchanged', () => {
    expect(formatDistributionFrequency('Weekly')).toBe('Weekly');
  });

  test('coded labels sort in descending cadence order without extra comparators', () => {
    const codes = ['Monthly', 'Quarterly', 'Semiannually', 'Annually', 'None', 'Irregular']
      .map(formatDistributionFrequency)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    expect(codes).toEqual(['00 - None', '01 - Monthly', '04 - Quarterly', '06 - Semi-annually', '12 - Annually', '99 - Irregular']);
  });
});


import { test as frequencyLabelTest, expect as frequencyLabelExpect } from 'bun:test';
frequencyLabelTest('Frequency placeholders display None and existing cadence labels stay unchanged', async () => {
  const text = await Bun.file(new URL('../app.tsx', import.meta.url)).text();
  const start = /^([ \t]*)function (formatDividendFrequency|formatDistributionFrequency)\(/m.exec(text);
  frequencyLabelExpect(start).not.toBeNull();
  const tail = text.slice(start!.index);
  const end = new RegExp('^' + start![1] + '\u007d', 'm').exec(tail);
  frequencyLabelExpect(end).not.toBeNull();
  const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(tail.slice(0, end!.index + end![0].length));
  const format = new Function(js + '; return ' + start![2] + ';')();
  for (const value of [null, undefined, '', '  ', '-', '‐', '‑', '‒', '–', '—', ' — ']) {
    frequencyLabelExpect(format(value)).toBe('00 - None');
  }
  for (const [input, expected] of [
    ['None', '00 - None'], ['Unknown', '00 - Unknown'], ['Monthly', '01 - Monthly'],
    ['Quarterly', '04 - Quarterly'], ['Semi-annually', '06 - Semi-annually'],
    ['Annually', '12 - Annually'], ['Irregular', '99 - Irregular'],
  ]) frequencyLabelExpect(format(input)).toBe(expected);
});


import { test as headerTest, expect as headerExpect } from 'bun:test';
async function headerSummaryHarness() {
  const source = await Bun.file(new URL('../app.tsx', import.meta.url)).text();
  const match = /^([ \t]*)function renderHeaderSummary\(/m.exec(source);
  headerExpect(match).not.toBeNull();
  const tail = source.slice(match!.index);
  const end = new RegExp('^' + match![1] + '}', 'm').exec(tail)!;
  const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(tail.slice(0, end.index + end[0].length));
  const makeNode = (text = ''): any => {
    const node: any = { textContent: text, childNodes: [], dataset: {}, listeners: {} };
    node.replaceChildren = (...children: any[]) => { node.childNodes = children; };
    node.append = (...children: any[]) => { node.childNodes.push(...children); };
    node.addEventListener = (name: string, listener: any) => { node.listeners[name] = listener; };
    return node;
  };
  const panel = makeNode(), subtitle = makeNode(), details = makeNode('Data: source link and updated timestamp');
  subtitle.append(details);
  const document = { getElementById: () => panel, createTextNode: makeNode, createElement: () => makeNode() };
  const render = new Function('document', js + '; return renderHeaderSummary;')(document);
  const text = () => subtitle.childNodes.map((n: any) => n.textContent).join('');
  return { render, panel, subtitle, details, makeNode, text };
}
headerTest('header has no visible subtitle without selection; original details nodes are retained', async () => {
  const h = await headerSummaryHarness();
  h.render(h.subtitle, new Set(), null, () => {});
  headerExpect(h.text()).toBe('');
  headerExpect(h.panel.childNodes).toEqual([h.details]);
  headerExpect(h.panel.childNodes[0]).toBe(h.details);
});
headerTest('header shows sorted selected tickers only, preserving click activation and highlight', async () => {
  const h = await headerSummaryHarness(); const activated: string[] = [];
  h.render(h.subtitle, new Set(['ZZZ', 'AAA']), 'AAA', (ticker: string) => activated.push(ticker));
  headerExpect(h.text()).toBe('2 selected: AAA, ZZZ');
  const links = h.subtitle.childNodes.filter((n: any) => n.dataset.headerFund);
  headerExpect(links[0].className).toContain('underline');
  links[1].listeners.click({ preventDefault() {} });
  headerExpect(activated).toEqual(['ZZZ']);
  headerExpect(h.panel.childNodes[0]).toBe(h.details);
});
headerTest('all selected still lists tickers; clear replaces both summary and selection', async () => {
  const h = await headerSummaryHarness();
  h.render(h.subtitle, new Set(['CCC','AAA','BBB']), 'BBB', () => {});
  headerExpect(h.text()).toBe('3 selected: AAA, BBB, CCC');
  const next = h.makeNode('Fresh detail context'); h.subtitle.replaceChildren(next);
  h.render(h.subtitle, new Set(), null, () => {});
  headerExpect(h.text()).toBe(''); headerExpect(h.panel.childNodes).toEqual([next]);
});
headerTest('header markup supplies a focusable counter and hidden rich panel with dismissal', async () => {
  const html = await Bun.file(new URL('../index.html', import.meta.url)).text();
  headerExpect(html).toMatch(/<button[^>]*aria-controls="app-summary"[^>]*id="ticker-count"/);
  headerExpect(html).toContain('id="app-summary" role="region" aria-label="ETF catalog information" hidden');
  headerExpect(html).toContain("event.key !== 'Escape'");
  headerExpect(html).toContain("trigger.addEventListener('focus', show)");
  headerExpect(html).toContain("trigger.addEventListener('pointerenter'");
});

// ---------------------------------------------------------------------------
// Official invesco.com layer. The samples are trimmed from the real responses
// of 2026-10-02 (sitemap, fund page, dng-api.invesco.com), including the HTML
// entity escaping of the JSON embedded in the fund page.
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

const HOLDINGS_SAMPLE = {
  cusip: '46137V357', effectiveDate: '2026-09-30', effectiveBusinessDate: '2026-09-30', totalNumberOfHoldings: 504,
  holdings: [
    { ticker: 'MRNA', issuerName: 'Moderna Inc', units: 1443681, percentageOfTotalNetAssets: 0.292069, securityTypeName: 'Common Stock', sectorName: 'Health Care', coupon: null, maturityDate: null, spMoodysRating: 'NR/NR', marketValueBase: 278009650.17, contractExpiryDate: null, cusip: '60770K107', currency: 'USD', securityTypeCode: 'COM' },
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

describe('invesco.com sitemap and fund page', () => {
  test('the sitemap yields each canonical fund page once and nothing else', () => {
    expect(parseSitemapFundPages(SITEMAP_SAMPLE)).toEqual([
      'https://www.invesco.com/us/en/financial-products/etfs/invesco-sp-500-equal-weight-etf.html',
      'https://www.invesco.com/us/en/financial-products/etfs/invesco-qqq-trust-series-1.html',
    ]);
    expect(parseSitemapFundPages('')).toEqual([]);
  });

  test('only slug pages count as fund pages, the guessed <ticker>.html does not', () => {
    expect(isFundPageUrl('https://www.invesco.com/us/en/financial-products/etfs/invesco-qqq-trust-series-1.html', 'QQQ')).toBe(true);
    expect(isFundPageUrl('https://www.invesco.com/us/en/financial-products/etfs/rsp.html', 'RSP')).toBe(false);
    expect(isFundPageUrl('https://www.invesco.com/us/financial-products/etfs/product-detail?ticker=RSP', 'RSP')).toBe(false);
    expect(isFundPageUrl(undefined)).toBe(false);
  });

  test('fund facts are read from the HTML-escaped page JSON', () => {
    expect(parseFundPage(FUND_PAGE_SAMPLE)).toEqual({
      ticker: 'RSP', cusip: '46137V357', isin: 'US46137V3574', name: 'Invesco S&P 500 Equal Weight ETF', benchmark: 'SPXEWTR',
      exchange: 'NYSE ARCA', inception: '2003-04-24', ter: 0.2, netTer: 0.19, managementFee: 0.2, assetClass: 'Equity', assetSubClass: 'U.S. Equity',
    });
  });

  test('pages without fund facts (country splash, 404, marketing microsite) are not fund pages', () => {
    expect(parseFundPage('<html><head><title>Invesco QQQ ETF</title></head><body>total expense ratio is 0.18%.</body></html>')).toBeNull();
    expect(parseFundPage('<html>&#34;productListFieldValueMap&#34;:{}</html>')).toBeNull();
    expect(parseFundPage(FUND_PAGE_SAMPLE.replace('46137V357', 'bad'))).toBeNull();
    expect(parseFundPage('')).toBeNull();
  });
});

describe('invesco.com fund API (dng-api.invesco.com)', () => {
  test('URLs are addressed by CUSIP', () => {
    const base = 'https://dng-api.invesco.com/cache/v1/accounts/en_US/shareclasses/46137V357';
    expect(dngUrl('46137v357', 'performance')).toBe(`${base}/performance/standard?idType=cusip&productType=ETF&performanceSubType=annualized&performancePeriod=monthly`);
    expect(dngUrl('46137V357', 'prices')).toBe(`${base}/prices?idType=cusip&productType=ETF&variationType=priceListing&productSubType=ETF`);
    expect(dngUrl('46137V357', 'yields')).toBe(`${base}?expand=nav&idType=cusip&productType=ETF&variationType=yieldInformation&managementFeeWaiver=0.0`);
    expect(dngUrl('46137V357', 'holdings')).toBe(`${base}/holdings/fund?idType=cusip&productType=ETF`);
  });

  test('month-end performance takes the fund NAV row and its effective date', () => {
    expect(parseDngPerformance(PERFORMANCE_SAMPLE)).toEqual({
      asOfDate: '2026-08-31',
      returns: { ytd: 15.44, yr1: 18.25, yr3: 15.43, yr5: 8.8, yr10: 12, sinceInception: 11.39 },
    });
  });

  test('periods a young fund does not have stay null, never 0', () => {
    const young = { effectiveDate: '2026-08-31', annualizedPerformance: [{ ytd: 4.5, y1: null, y3: null, y5: null, y10: null, inception: 4.5, label: 'fund' }] };
    expect(parseDngPerformance(young).returns).toEqual({ ytd: 4.5, yr1: null, yr3: null, yr5: null, yr10: null, sinceInception: 4.5 });
  });

  test('unusable performance, prices and yield payloads are rejected', () => {
    expect(() => parseDngPerformance({ effectiveDate: '2026-08-31' })).toThrow();
    expect(() => parseDngPerformance('' as unknown as Record<string, unknown>)).toThrow();
    expect(() => parseDngPrices({ effectiveDate: '2026-10-01' })).toThrow();
    expect(() => parseDngYields('' as unknown as Record<string, unknown>)).toThrow();
  });

  test('prices carry NAV, close, net assets and their date', () => {
    expect(parseDngPrices(PRICES_SAMPLE)).toEqual({ asOfDate: '2026-10-01', nav: 208.981986, close: 209, netAssets: 95423821287.23 });
  });

  test('yields: SEC 30-day, trailing 12-month distribution rate and distribution rate', () => {
    expect(parseDngYields(YIELDS_SAMPLE)).toEqual({ secYield: 1.57, dividendYield: 1.53, distributionRate: 1.53 });
    expect(parseDngYields({ cusip: 'X', secYield30Day: null, twelveMonthDistributionRate: null, distributionYield: null })).toEqual({ secYield: null, dividendYield: null, distributionRate: null });
  });

  test('equity holdings keep percent weights; futures rows are not bonds and carry no bond columns', () => {
    const parsed = parseDngHoldings(HOLDINGS_SAMPLE, 'RSP');
    expect(parsed.asOfDate).toBe('2026-09-30');
    expect(parsed.headers).toEqual(HOLDINGS_HEADERS);
    expect(parsed.rows[0]).toEqual({
      Name: 'Moderna Inc', Ticker: 'MRNA', Identifier: '60770K107', Weight: '0.292069', 'Market Value': '278009650.17', 'Shares Held': '1443681', 'Asset Category': 'Health Care',
    });
    expect(parsed.rows[1].Name).toBe('E-mini S&P 500 Equal Weight Futures');
    expect(parsed.rows[1]['Asset Category']).toBe('Index Future');
    expect(parsed.rows[2].Ticker).toBe('-');
    expect(parsed.rows[2]['Shares Held']).toBe('-1000');
  });

  test('bond holdings add coupon and maturity, and use the CUSIP instead of an internal ticker code', () => {
    const parsed = parseDngHoldings(BOND_HOLDINGS_SAMPLE, 'BAB');
    expect(parsed.headers).toEqual(BOND_SHEET_HEADERS);
    expect(parsed.rows[0]).toEqual({
      Name: 'State of Illinois', Ticker: '-', Identifier: '452151LF8', Weight: '1.691692', 'Market Value': '13880270.01', 'Shares Held': '14197451.0041',
      'Asset Category': 'Municipal / A/A1', Coupon: '5.1', Maturity: 'Jun 01 2033',
    });
  });

  test('a payload without positions is an error, so the SEC fallback can take over', () => {
    expect(() => parseDngHoldings({ effectiveDate: '2026-09-30', holdings: [] }, 'XYZ')).toThrow();
    expect(() => parseDngHoldings({ message: 'Bad Request', status: 'error' }, 'XYZ')).toThrow();
  });
});

describe('indexRowFromMeta', () => {
  test('rebuilds a catalog row (with the metrics contract) from a published meta.json', () => {
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

// ---------------------------------------------------------------------------
// Update pipeline on a mocked fetch, written into a temporary api root
// ---------------------------------------------------------------------------

type MockFund = { ticker: string; cusip: string; slug: string };
const MOCK_FUNDS: MockFund[] = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF'].map((ticker, i) => ({ ticker, cusip: `46137V35${i}`, slug: `invesco-fund-${ticker.toLowerCase()}-etf` }));
const MOCK_PAGE_BASE = 'https://www.invesco.com/us/en/financial-products/etfs/';

function mockFundPage(fund: MockFund): string {
  return FUND_PAGE_SAMPLE.replace('RSP', fund.ticker).replace('46137V357', fund.cusip).replace('US46137V3574', `US${fund.cusip}4`);
}

function mockChart(): Record<string, unknown> {
  const timestamp = [1_790_000_000, 1_790_086_400, 1_790_172_800];
  return {
    chart: { result: [{ meta: { fullExchangeName: 'NYSE Arca', longName: 'Mock Fund', regularMarketPrice: 101, regularMarketTime: 1_790_172_800, firstTradeDate: 1_000_000_000 },
      timestamp, indicators: { quote: [{ close: [100, 100.5, 101], volume: [10, 20, 30] }], adjclose: [{ adjclose: [100, 100.5, 101] }] }, events: {} }] },
  };
}

type MockRequest = { url: string; userAgent: string };

function installMockFetch(options: { listed?: MockFund[]; unlisted?: MockFund[]; delayMs?: number } = {}): { requests: MockRequest[]; peak: () => number } {
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
      const api = /shareclasses\/([0-9A-Z]{9})(\/[a-z/]+)?\?/.exec(url);
      if (api && listed.some((fund) => fund.cusip === api[1])) {
        if (url.includes('/performance/standard')) return json(PERFORMANCE_SAMPLE);
        if (url.includes('/prices?')) return json(PRICES_SAMPLE);
        if (url.includes('/holdings/fund')) return json(HOLDINGS_SAMPLE);
        if (url.includes('variationType=yieldInformation')) return json(YIELDS_SAMPLE);
      }
      if (url.includes('query1.finance.yahoo.com/v8/finance/chart/')) return json(mockChart());
      return new Response('', { status: 404 });
    } finally {
      inFlight -= 1;
    }
  }) as typeof fetch;
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
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const dir = mkdtempSync(join(tmpdir(), 'invesco-feed-'));
  mkdirSync(join(dir, 'funds'), { recursive: true });
  writeFileSync(join(dir, 'index.json'), JSON.stringify({ funds: rows.map((fund) => seedIndexRow(fund)) }));
  for (const ticker of metaOnly) {
    mkdirSync(join(dir, 'funds', ticker), { recursive: true });
    writeFileSync(join(dir, 'funds', ticker, 'meta.json'), JSON.stringify({ ticker, name: `Fund ${ticker}`, category: 'US Equity', source: {}, returns: { monthEnd: {} } }));
  }
  const root = pathToFileURL(`${dir}/`);
  setApiRootForTests(root);
  try {
    return await run(root);
  } finally {
    setApiRootForTests(new URL('../api/invesco/', import.meta.url));
    (await import('node:fs')).rmSync(dir, { recursive: true, force: true });
  }
}

const pipelineControls = (extra: Record<string, string> = {}) =>
  readConfig({ REQUEST_SLEEP: '0', MAX_RETRIES: '1', EDGAR_FALLBACK: 'false', CONCURRENCY: '1', ...extra });

async function readIndex(root: URL): Promise<{ funds: Record<string, any>[]; counts: Record<string, number> }> {
  return JSON.parse(await Bun.file(new URL('index.json', root)).text());
}

describe('update pipeline (mocked fetch, temporary api root)', () => {
  const realFetch = globalThis.fetch;
  const realLog = console.log;
  afterEach(() => { globalThis.fetch = realFetch; console.log = realLog; });
  const quiet = () => { console.log = () => {}; };

  test('a one-ticker run refreshes that fund from the official sources and keeps every published row', async () => {
    quiet();
    const mock = installMockFetch();
    await withTempFeed(MOCK_FUNDS.slice(0, 3), async (root) => {
      await runUpdater(pipelineControls({ TICKERS: 'AAA' }));
      const index = await readIndex(root);
      expect(index.funds.map((fund) => fund.ticker)).toEqual(['AAA', 'BBB', 'CCC']);
      const [aaa, bbb] = index.funds;
      expect(aaa.cusip).toBe('46137V350');
      expect(aaa.terValue).toBe(0.2);
      expect(aaa.navValue).toBe(208.981986);
      expect(aaa.aumValue).toBe(95423821287.23);
      expect(aaa.metrics.ytd).toBe(15.44);
      expect(aaa.metrics.secYield).toBe(1.57);
      expect(aaa.metrics.returnsBasis).toBe(OFFICIAL_RETURNS_BASIS);
      expect(aaa.metrics.performanceAsOf).toBe('2026-08-31');
      expect(aaa.returns.monthEnd.asOfDate).toBe('Aug 31 2026');
      expect(aaa.holdings).toBe(3);
      expect(bbb.metrics.ytd).toBe(1.5);
      const meta = JSON.parse(await Bun.file(new URL('funds/AAA/meta.json', root)).text());
      expect(meta.holdings.source).toContain('invesco.com fund holdings API');
      expect(meta.returns.performanceAsOf).toBe('2026-08-31');
      expect(meta.identifiers.indexTicker).toBe('SPXEWTR');
    });
    // the unselected funds cost no request, and every invesco.com request identifies itself honestly
    expect(mock.requests.some((request) => request.url.includes('46137V351') || request.url.includes('fund-bbb'))).toBe(false);
    const invesco = mock.requests.filter((request) => /invesco\.com/.test(request.url));
    expect(invesco.length).toBeGreaterThan(4);
    expect(invesco.every((request) => /^daggerok-etf-feed\//.test(request.userAgent) && !/mozilla/i.test(request.userAgent))).toBe(true);
  });

  test('a fund missing from the sitemap keeps its published returns, labelled as not refreshed, and is never zero-filled', async () => {
    quiet();
    const mock = installMockFetch({ listed: MOCK_FUNDS.slice(0, 2) });
    await withTempFeed(MOCK_FUNDS.slice(0, 3), async (root) => {
      await runUpdater(pipelineControls({ SKIP_YAHOO: 'true' }));
      const index = await readIndex(root);
      expect(index.funds.map((fund) => fund.ticker)).toEqual(['AAA', 'BBB', 'CCC']);
      const ccc = index.funds[2];
      expect(ccc.metrics.ytd).toBe(1.5);
      expect(ccc.metrics.returnsBasis).toBe(STALE_OFFICIAL_RETURNS_BASIS);
      expect(ccc.metrics.performanceAsOf).toBe('2026-08-31');
      expect(ccc.terValue).toBeNull();
      expect(ccc.navValue).toBeNull();
      expect(index.funds[0].metrics.returnsBasis).toBe(OFFICIAL_RETURNS_BASIS);
    });
    expect(mock.requests.some((request) => request.url.includes('fund-ccc'))).toBe(false);
  });

  test('funds with a meta.json but no index row stay in the index, new sitemap funds are discovered', async () => {
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
      expect(created.terValue).toBe(0.2);
      expect(created.metrics.returnsBasis).toBe(OFFICIAL_RETURNS_BASIS);
      expect(index.counts.funds).toBe(3);
    }, ['ZZZ']);
  });

  test('a one-fund run makes exactly four fund API requests (returns, prices, yields, holdings)', async () => {
    quiet();
    const mock = installMockFetch();
    await withTempFeed(MOCK_FUNDS.slice(0, 1), async () => {
      await runUpdater(pipelineControls({ TICKERS: 'AAA', SKIP_YAHOO: 'true' }));
    });
    expect(mock.requests.filter((request) => /dng-api\.invesco\.com/.test(request.url)).length).toBe(4);
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

// --- config, README and workflow parity (merged from the former config-docs test) ---

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const file = JSON.parse(read('scripts/update-data.config.json')) as Record<string, string>;

test('precedence: file < advanced < nonblank input < environment', () => {
  const c = resolveControls({ CONCURRENCY: 2, TICKERS: 'QQQ' }, { CONCURRENCY: 3, TICKERS: 'RSP' }, { CONCURRENCY: '4', TICKERS: '' }, { INVESCO_CONCURRENCY: '5', CONCURRENCY: '6' });
  expect(c.CONCURRENCY).toBe('5');
  expect(c.TICKERS).toBe('RSP');
  expect(resolveControls({ CONCURRENCY: 2 }, { CONCURRENCY: 3 }, { CONCURRENCY: '4' }).CONCURRENCY).toBe('4');
  expect(resolveControls({ CONCURRENCY: 2 }, { CONCURRENCY: 3 }).CONCURRENCY).toBe('3');
  expect(resolveControls({ SKIP_YAHOO: true }, {}, {}, { SKIP_YAHOO: 'false' }).SKIP_YAHOO).toBe('false');
  // an explicitly set empty env var wins and clears the control
  expect(resolveControls({ TICKERS: 'QQQ' }, {}, {}, { TICKERS: '' }).TICKERS).toBe('');
  expect(resolveControls({ MAX_FETCHES: 5 }, {}, {}, { INVESCO_LIMIT: '7' }).MAX_FETCHES).toBe('7');
  expect(resolveControls({ HISTORY_PAGE_SIZE: 5 }, {}, {}, { HISTORICAL_PAGE_SIZE: '9' }).HISTORY_PAGE_SIZE).toBe('9');
  expect(resolveControls({ SKIP_YAHOO: 'false' }, {}, {}, { INVESCO_SKIP_YAHOO: 'true' }).SKIP_YAHOO).toBe('true');
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
  expect(config.edgarFallback).toBe(true);
  expect(config.skipYahoo).toBe(false);
  expect(config.skipInvesco).toBe(false);
  expect(config.aumRange).toBeUndefined();
  expect(config.terRange).toBeUndefined();
  expect(config.dividendYieldRange).toBeUndefined();
  expect(config.performanceRanges).toEqual({});
  expect(config.totalReturnRanges).toEqual({});
  expect(config.sitemapUrl).toBe('https://www.invesco.com/us/en/sitemap.xml');
  expect(config.secUa).toBe('daggerok ETF feed daggerok@gmail.com');
  expect(file.SEC_UA).toBe('daggerok ETF feed daggerok@gmail.com');
});

test('the protected variable SEC_UA wins over file, advanced and inputs', () => {
  const c = resolveControls(file, { SEC_UA: 'adv' }, { SEC_UA: 'input' }, { SEC_UA: 'protected-ua' });
  expect(c.SEC_UA).toBe('protected-ua');
  expect(readConfig(c).secUa).toBe('protected-ua');
});

test('controls of the retired CSV downloads are gone: the resolver rejects them instead of ignoring them', () => {
  for (const key of ['PRODUCT_LIST_URL', 'CATALOG_HTML_URL', 'STORE_RAW_DOWNLOADS', 'PRICES_HISTORY', 'AUDIENCE_TYPE']) {
    expect(() => resolveControls({ [key]: 'x' })).toThrow('Unknown updater control');
  }
});

test('resolver rejects unknown, invalid and environment-file injection values', () => {
  for (const value of [{ UNKNOWN: 1 }, { OUTPUT_DIR: 'x' }, { SEC_UA: 'x\nEVIL=yes' }, { CONCURRENCY: 0 }, { MAX_RETRIES: 0 }, { MAX_RETRIES: '0' }, { MAX_FETCHES: 1.5 }, { MAX_FETCHES: -1 },
    { HOLDINGS_PAGE_SIZE: 'abc' }, { REQUEST_SLEEP: '-1' }, { VERBOSE: 'maybe' }, { SKIP_YAHOO: 'perhaps' }, { AUM: 'huge' }, { AUM: '5:1' }, { TER: '1' },
    { PERFORMANCE_1Y: '15' }, { SITEMAP_URL: 'http://example.com/x' }, { TICKERS: ['QQQ'] }, { TICKERS: { a: 1 } }, null, [], 'text']) {
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
  expect(JSON.stringify(file).match(/[\w.]+@[\w.]+/g)).toEqual(['daggerok@gmail.com']);
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
  expect(names).not.toContain('sec_ua');
  expect(text).toContain('vars.SEC_UA');
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
  expect(text).toContain('timeout-minutes: 30');
  expect(text).toContain('persist-credentials: false');
});

// --- TLS trust store ---
describe('USE_SYSTEM_CA', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });
  const certError = () => Object.assign(new Error('unable to get local issuer certificate'), { code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' });
  const makeReexec = () => { const calls = { n: 0 }; const fn = (() => { calls.n++; return undefined as never; }) as () => never; return { calls, fn }; };

  test('resolver accepts auto/true/false case-insensitively, rejects others, defaults to auto', () => {
    expect(resolveControls(file).USE_SYSTEM_CA).toBe('auto');
    expect(resolveControls(file, {}, {}, { USE_SYSTEM_CA: 'TRUE' }).USE_SYSTEM_CA).toBe('true');
    expect(resolveControls(file, { USE_SYSTEM_CA: 'False' }).USE_SYSTEM_CA).toBe('false');
    expect(() => resolveControls(file, { USE_SYSTEM_CA: 'maybe' })).toThrow();
  });

  test('isCertError detects certificate failures, also through cause', () => {
    expect(isCertError({ code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' })).toBe(true);
    expect(isCertError(new Error('unable to get local issuer certificate'))).toBe(true);
    expect(isCertError(new Error('fetch failed', { cause: certError() }))).toBe(true);
    expect(isCertError({ code: 'ECONNRESET', message: 'socket hang up' })).toBe(false);
    expect(isCertError(new Error('HTTP 403 Forbidden'))).toBe(false);
  });

  test('mode false and an already active store leave fetch unchanged', () => {
    const { calls, fn } = makeReexec();
    installSystemCa('false', fn, false);
    expect(globalThis.fetch).toBe(realFetch);
    installSystemCa('auto', fn, true);
    expect(globalThis.fetch).toBe(realFetch);
    installSystemCa('true', fn, true);
    expect(globalThis.fetch).toBe(realFetch);
    expect(calls.n).toBe(0);
  });

  test('mode true restarts immediately', () => {
    const { calls, fn } = makeReexec();
    installSystemCa('true', fn, false);
    expect(calls.n).toBe(1);
  });

  test('mode auto wraps fetch: cert error restarts once, other errors rethrow, success passes through', async () => {
    const { calls, fn } = makeReexec();
    const errors = console.error;
    console.error = () => {};
    try {
      globalThis.fetch = (async () => new Response('ok')) as unknown as typeof fetch;
      installSystemCa('auto', fn, false);
      expect(await (await fetch('https://example.test')).text()).toBe('ok');
      globalThis.fetch = (async () => { throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }); }) as unknown as typeof fetch;
      installSystemCa('auto', fn, false);
      await expect(fetch('https://example.test')).rejects.toThrow('socket hang up');
      expect(calls.n).toBe(0);
      globalThis.fetch = (async () => { throw certError(); }) as unknown as typeof fetch;
      installSystemCa('auto', fn, false);
      await fetch('https://example.test');
      expect(calls.n).toBe(1);
    } finally { console.error = errors; }
  });
});
