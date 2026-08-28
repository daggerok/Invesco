// Bun's test runner provides these globals at runtime.
// @ts-ignore bun types are intentionally not required for this zero-dependency Bun script.
import { describe, expect, test } from 'bun:test';
import {
  parseRange,
  parseAumRange,
  normalizeNumberText,
  parseCsv,
  findHeaderRowIndex,
  csvRecords,
  pickColumn,
  normalizeInvescoCategory,
  readReturn,
  parseProductList,
  parseCatalogFundPages,
  parseInvescoHoldings,
  weightsSum,
  parseNport,
  parseNportAccessions,
  nportUrlFor,
  pickEftsCik,
  parseFundTickerMap,
  parseCompanyTickerMap,
  edgarSeriesFilingsUrl,
  parseEdgarAtomFilings,
  parseChart,
  parsePricesCsv,
  priceReturns,
  lastCompletedQuarterEnd,
  annualizedToTotal,
  totalToAnnualized,
  indicatedYield,
  inferDistributionFrequency,
  deriveCatalogMetrics,
  formatEdgarDate,
  formatInvescoDate,
  toIsoDate,
  epochToIsoDate,
  numberOrNull,
  normalizeHoldingName,
  normalizeHoldingNameCore,
  cleanHoldingTicker,
  invescoFundPageUrl,
  invescoProductDetailUrl,
  invescoHoldingsDownloadUrl,
  invescoPricesDownloadUrl,
  invescoProductListUrl,
  HOLDINGS_HEADERS,
  BOND_SHEET_HEADERS,
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

// ---------------------------------------------------------------------------
// CSV layer
// ---------------------------------------------------------------------------

const PRODUCT_LIST_FIXTURE = [
  'Invesco Ltd.',
  'Exchange-Traded Funds (ETFs) - Performance and Prices',
  'Prices as of 08/21/2026 Close. Returns as of 07/31/2026.',
  'Please note: past performance is not a guide to future performance.',
  '',
  'Fund Name,Ticker,Inception_Date,Index_Ticker,CUSIP,ISIN,Exchange,Fund Type,As_Of_Date,Gross Expense Ratio,NAV,Close Price,Premium/Discount,Fund Assets ($m),Trailing 12m Dividend Rate (%),SEC 30 Day (%),YTD,12 M,3 Yr Ann,5 Yr Ann,10 Yr Ann,Since Inception Ann',
  'Invesco QQQ Trust,QQQ,03/10/1999,NASDAQ105,460906109,US4609061099,NasdaqGM,"Equity, US Equity",08/21/2026,0.20%,706.3000,706.3200,0.00%,"452,800.00",0.44%,--,15.97,18.34,20.15,17.42,16.88,19.44',
  'Invesco NASDAQ 100 ETF,QQQM,10/13/2020,NASDAQ105,460906409,US4609064096,NasdaqGM,"Equity, US Equity",08/21/2026,0.15%,220.1500,220.1300,-0.01%,"48,900.00",0.43%,--,15.99,18.30,20.11,17.38,--,13.02',
  'Invesco Preferred ETF,PGX,01/31/2008,P0P2,46138E511,US46138E5116,NYSEArca,"Fixed Income, Preferred",08/21/2026,0.61%,41.7400,41.7200,-0.05%,"1,240.00",6.28%,5.94%,-2.10,4.11,1.10,0.42,0.55,2.21',
  'Invesco Senior Loan ETF,BKLN,07/06/2011,L0L1,46137M720,US46137M7202,NYSEArca,"Fixed Income, Bank Loans",08/21/2026,0.67%,50.6600,50.6500,-0.02%,--,0.00%,--,-1.20,3.71,6.88,5.09,4.27,3.74',
].join('\n');

describe('parseCsv / header detection', () => {
  test('handles quotes, embedded commas and CRLF', () => {
    const rows = parseCsv('a,b\r\n"x, y","say ""hi"""\r\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
    ]);
  });

  test('drops blank lines and strips a BOM', () => {
    const rows = parseCsv('\uFEFFTicker,Name\r\n\r\nQQQ,Invesco QQQ Trust\r\n');
    expect(rows).toEqual([
      ['Ticker', 'Name'],
      ['QQQ', 'Invesco QQQ Trust'],
    ]);
  });

  test('finds the header row after legal preamble lines', () => {
    const rows = parseCsv(PRODUCT_LIST_FIXTURE);
    expect(findHeaderRowIndex(rows, ['Ticker'])).toBe(4); // the blank preamble line is dropped
    expect(findHeaderRowIndex(rows, ['Nope'])).toBe(-1);
  });

  test('csvRecords keeps the first of two identically named columns', () => {
    const rows = parseCsv('Fund Ticker,Ticker,Name\nQQQ,QQQ,Apple Inc');
    const records = csvRecords(rows, 0);
    expect(pickColumn(records[0], ['Ticker'])).toBe('QQQ');
    expect(pickColumn(records[0], ['Name'])).toBe('Apple Inc');
    expect(pickColumn(records[0], ['Missing'])).toBe('');
  });

  test('csvRecords skips empty rows and trims cells', () => {
    const rows = parseCsv('Ticker,Name\n QQQ , Invesco QQQ Trust \n,,\n');
    expect(csvRecords(rows, 0)).toEqual([{ Ticker: 'QQQ', Name: 'Invesco QQQ Trust' }]);
  });
});

// ---------------------------------------------------------------------------
// Catalog: the invesco.com product-list download
// ---------------------------------------------------------------------------

describe('parseProductList', () => {
  const funds = parseProductList(PRODUCT_LIST_FIXTURE);

  test('reads the fund rows, alphabetized, and drops the preamble', () => {
    expect(funds.map((fund) => fund.ticker)).toEqual(['BKLN', 'PGX', 'QQQ', 'QQQM']);
    expect(funds[1].name).toBe('Invesco Preferred ETF');
  });

  test('converts "Fund Assets ($m)" into dollars', () => {
    const qqq = funds.find((fund) => fund.ticker === 'QQQ')!;
    expect(qqq.netAssets).toBe(452800000000);
    // A tiny fund expressed as 452,800.00 must not be read as $452tn.
    expect(qqq.netAssets).toBeGreaterThan(4e11);
  });

  test('keeps missing assets and yields as null', () => {
    const bklN = funds.find((fund) => fund.ticker === 'BKLN')!;
    expect(bklN.netAssets).toBeNull();
    expect(bklN.secYield).toBeNull();
    expect(bklN.dividendYield).toBe(0);
  });

  test('parses identifiers, exchange, category and as-of date', () => {
    const qqm = funds.find((fund) => fund.ticker === 'QQQM')!;
    expect(qqm.cusip).toBe('460906409');
    expect(qqm.isin).toBe('US4609064096');
    expect(qqm.exchange).toBe('NasdaqGM');
    expect(qqm.category).toBe('US Equity');
    expect(qqm.categoryPath).toBe('Equity, US Equity');
    expect(qqm.asOfDate).toBe('2026-08-21');
    expect(qqm.inception).toBe('2020-10-13');
  });

  test('reads NAV/close/premium-discount/TER as numbers', () => {
    const pgx = funds.find((fund) => fund.ticker === 'PGX')!;
    expect(pgx.nav).toBe(41.74);
    expect(pgx.close).toBe(41.72);
    expect(pgx.premiumDiscount).toBe(-0.05);
    expect(pgx.ter).toBe(0.61);
    expect(pgx.secYield).toBe(5.94);
  });

  test('derives premium/discount when the file leaves it out', () => {
    const fundsWithout = parseProductList(
      'Ticker,Fund Name,NAV,Close Price\nABC,Test ETF,10.00,10.20',
    );
    expect(fundsWithout[0].premiumDiscount).toBe(2);
  });

  test('12M/YTD stay cumulative, 3Y/5Y/10Y annualized figures stay annualized', () => {
    const qqq = funds.find((fund) => fund.ticker === 'QQQ')!;
    expect(qqq.returns.ytd).toBe(15.97);
    expect(qqq.returns.yr1).toBe(18.34);
    // 3Y/5Y/10Y are published annualized; the feed stores the cumulative
    // total return (the UI's TR columns) and the annualized figure (CAGR).
    expect(qqq.returns.yr3).toBe(73.45);
    expect(qqq.returns.yr10).toBe(375.78);
    expect(qqq.returns.yr5).toBe(123.21);
    expect(qqq.returns.sinceInception).toBe(19.44);
  });

  test('rejects a file without a Ticker header or without rows', () => {
    expect(() => parseProductList('a,b\n1,2')).toThrow(/no header row/);
    expect(() => parseProductList('Ticker,Name,Extra\n')).toThrow(/no fund rows/);
  });

  test('the fallback fund page keeps the documented ?ticker= pattern', () => {
    const qqq = funds.find((fund) => fund.ticker === 'QQQ')!;
    expect(qqq.fundPage).toBe(
      'https://www.invesco.com/us/financial-products/etfs/product-detail?audienceType=Investor&ticker=QQQ',
    );
  });
});

describe('readReturn', () => {
  test('announces cumulative and annualized flavors separately', () => {
    const record = { '3 Yr Ann': '10.00', YTD: '4.50' };
    expect(readReturn(record, ['YTD'])).toBe(4.5);
    expect(readReturn(record, ['3 Yr Ann'], 3)).toBe(33.1);
    expect(readReturn(record, ['Missing'], 5)).toBeNull();
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

describe('parseCatalogFundPages', () => {
  test('picks the canonical fund URLs out of the catalog HTML', () => {
    const html = `
      <a href="/us/en/financial-products/etfs/invesco-nasdaq-100-etf.html"><span>QQQM</span></a>
      <a href="https://www.invesco.com/us/en/financial-products/etfs/invesco-preferred-etf.html" class="x">PGX</a>
      <a href="/us/en/financial-products/etfs/some-article.html">Read more</a>
    `;
    const pages = parseCatalogFundPages(html);
    expect(pages.get('QQQM')).toBe('https://www.invesco.com/us/en/financial-products/etfs/invesco-nasdaq-100-etf.html');
    expect(pages.get('PGX')).toBe('https://www.invesco.com/us/en/financial-products/etfs/invesco-preferred-etf.html');
    expect(pages.has('READMORE')).toBe(false);
    expect(pages.size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Holdings: equity, bond and futures CSV flavours
// ---------------------------------------------------------------------------

const EQUITY_HOLDINGS_FIXTURE = [
  'Invesco Ltd.',
  'Portfolio Holdings as of 08/21/2026',
  '',
  'Fund Ticker,Ticker,Security Identifier,Holding Ticker,Name,Shares/Par Value,Market Value,Weight,Sector,Date',
  'QQQ,QQQ,037833100,AAPL,"Apple Inc, Common Stock","124,827,810","26,312,454,069.90",8.24,"Information Technology",08/21/2026',
  'QQQ,QQQ,594918104,MSFT,"Microsoft Corp, Common Stock","61,773,595","27,752,405,289.70",8.69,"Information Technology",08/21/2026',
  'QQQ,QQQ,US46090E1038,--,Cash and Cash Equivalents,"1,200,000","1,200,000.00",0.04,"Cash",08/21/2026',
].join('\n');

describe('parseInvescoHoldings (equity flavour)', () => {
  const parsed = parseInvescoHoldings(EQUITY_HOLDINGS_FIXTURE, 'QQQ');

  test('normalizes to the shared sheet headers', () => {
    expect(parsed.headers).toEqual(HOLDINGS_HEADERS);
    expect(parsed.rows.length).toBe(3);
    expect(parsed.rows[1]).toEqual({
      Name: 'Microsoft Corp, Common Stock',
      Ticker: 'MSFT',
      Identifier: '594918104',
      Weight: '8.69',
      'Market Value': '27752405289.7',
      'Shares Held': '61773595',
      'Asset Category': 'Information Technology',
    });
  });

  test('exposes the as-of date used by the Holdings As Of column', () => {
    expect(parsed.asOfDate).toBe('2026-08-21');
  });

  test('rows without an exchange ticker keep "-" (Watchlist keys them by Identifier)', () => {
    expect(parsed.rows[2].Ticker).toBe('-');
    expect(parsed.rows[2].Identifier).toBe('US46090E1038');
    expect(weightsSum(parsed.rows)).toBeCloseTo(16.97, 2);
  });

  test('drops rows belonging to another fund (misrouted download guard)', () => {
    const csv = [
      'Fund Ticker,Security Identifier,Holding Ticker,Name,Weight,Date',
      'SPY,123,SPY,Wrong Fund,50.00,08/21/2026',
      'QQQ,456,AAPL,Right Fund,50.00,08/21/2026',
    ].join('\n');
    const parsed2 = parseInvescoHoldings(csv, 'QQQ');
    expect(parsed2.rows.length).toBe(1);
    expect(parsed2.rows[0].Name).toBe('Right Fund');
  });

  test('rejects a file with no recognizable header row', () => {
    expect(() => parseInvescoHoldings('a,b,c\n1,2,3', 'QQQ')).toThrow(/no recognizable header row/);
  });
});

const BOND_HOLDINGS_FIXTURE = [
  'Fund Ticker,Security Identifier,Holding Ticker,Name,PercentageOfFund,Shares/Par Value,Market Value,CouponRate,MaturityDate,Rating,PositionDate',
  'PGX,912810H80,--,US TREASURY NTS,2.50,"5,000,000","5,100,000",4.125,05/15/2028,AAA,08/21/2026',
  'PGX,00206RAF5,--,ALLSTATE CORP,1.10,"1,000,000","1,050,000",5.20,03/15/2033,A,08/21/2026',
].join('\n');

describe('parseInvescoHoldings (bond flavour)', () => {
  const parsed = parseInvescoHoldings(BOND_HOLDINGS_FIXTURE, 'PGX');

  test('keeps the bond columns in the sheet', () => {
    expect(parsed.headers).toEqual(BOND_SHEET_HEADERS);
    expect(parsed.rows[0]).toEqual({
      Name: 'US TREASURY NTS',
      Ticker: '-',
      Identifier: '912810H80',
      Weight: '2.5',
      'Market Value': '5100000',
      'Shares Held': '5000000',
      'Asset Category': 'AAA',
      Coupon: '4.125',
      Maturity: 'May 15 2028',
    });
  });

  test('has no exchange tickers at all', () => {
    expect(parsed.rows.every((row) => row.Ticker === '-')).toBe(true);
    expect(parsed.asOfDate).toBe('2026-08-21');
  });
});

describe('weightsSum', () => {
  test('is zero for an unreadable weight column', () => {
    expect(weightsSum([{ Weight: '' }, { Weight: 'N/A' }])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// SEC EDGAR fallback layer
// ---------------------------------------------------------------------------

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

describe('parsePricesCsv', () => {
  test('reads the daily NAV/close rows of the prices & yields download', () => {
    const csv = [
      'Invesco prices & yields',
      'Date,NAV,Close Price,Premium/Discount,Volume',
      '08/20/2026,41.70,41.68,-0.05%,"1,200,000"',
      '08/21/2026,41.74,41.72,-0.05%,900000',
    ].join('\n');
    const parsed = parsePricesCsv(csv, 'PGX');
    expect(parsed.days.map((day) => day.date)).toEqual(['2026-08-20', '2026-08-21']);
    expect(parsed.days[1].close).toBe(41.72);
    expect(parsed.navByDate.get('2026-08-21')).toBe(41.74);
    expect(parsed.asOfDate).toBe('2026-08-21');
  });

  test('rejects a file without a Date header', () => {
    expect(() => parsePricesCsv('a,b\n1,2', 'PGX')).toThrow(/no recognizable header row/);
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
    );
    expect(metrics.ytd).toBe(15.97);
    expect(metrics.tr1y).toBe(18.34);
    expect(metrics.cagr3y).toBe(20.15);
    expect(metrics.tr3y).toBe(annualizedToTotal(20.15, 3));
    expect(metrics.dividendYield).toBe(0.44);
    expect(metrics.secYield).toBeNull();
    expect(metrics.returnsBasis).toContain('official Invesco returns');
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
    expect(metrics.returnsBasis).toContain('adjusted market-price closes');
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
  test('invescoFundPageUrl builds canonical product URL', () => {
    expect(invescoFundPageUrl('QQQ')).toBe('https://www.invesco.com/us/en/financial-products/etfs/qqq.html');
  });

  test('invescoProductDetailUrl builds product detail URL with audience', () => {
    expect(invescoProductDetailUrl('QQQ')).toBe('https://www.invesco.com/us/financial-products/etfs/product-detail?audienceType=Investor&ticker=QQQ');
    expect(invescoProductDetailUrl('RSP', 'Advisor')).toBe('https://www.invesco.com/us/financial-products/etfs/product-detail?audienceType=Advisor&ticker=RSP');
  });

  test('invescoHoldingsDownloadUrl builds holdings CSV download URL', () => {
    expect(invescoHoldingsDownloadUrl('QQQ')).toBe('https://www.invesco.com/us/financial-products/etfs/holdings/main/holdings/0?audienceType=Investor&action=download&ticker=QQQ');
  });

  test('invescoPricesDownloadUrl builds prices & yields CSV URL', () => {
    expect(invescoPricesDownloadUrl('QQQ')).toBe('https://www.invesco.com/us/financial-products/etfs/pricing/main/prices/0?audienceType=Investor&action=download&ticker=QQQ');
  });

  test('invescoProductListUrl builds catalog download URL', () => {
    expect(invescoProductListUrl()).toBe('https://www.invesco.com/us/financial-products/etfs/performance/prices/main/performance/0?audienceType=Advisor&action=download');
    expect(invescoProductListUrl('Investor')).toBe('https://www.invesco.com/us/financial-products/etfs/performance/prices/main/performance/0?audienceType=Investor&action=download');
  });
});
