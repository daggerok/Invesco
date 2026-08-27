// Invesco holding name -> exchange ticker (GENERATED FILE: do not edit by hand).
//
// investco.com already labels exchange-listed holdings with their ticker; this
// seed only fills the rows its downloads leave blank (bonds, futures, cash and
// a few foreign lines). Seeded from the same public directories as
// daggerok/Fidelity: SEC EDGAR company_tickers.json plus the Nasdaq / NYSE /
// NYSE American symbol directories, and extended live by the Yahoo Finance
// symbol search (strict name match only). Positions that genuinely have no
// exchange ticker keep Ticker "-" and are keyed by their CUSIP/ISIN Identifier,
// exactly like the SPDR and Fidelity bond rows.

export const HELD_TICKERS: Record<string, string> = {};
