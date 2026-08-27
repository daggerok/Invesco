# План: статические данные Invesco ETF по отдельным JSON-файлам

Сестринский план к `daggerok/iShares/docs/ishares-static-data-plan.ru.md` и
`daggerok/Fidelity/docs/fidelity-static-data-plan.ru.md`.

## Цель

Получать воспроизводимые данные всех ETF Invesco (США, ~245 фондов) из публичных
источников и публиковать их как статический API `api/invesco/**` без пустых
коммитов — в той же структуре файлов, что и `api/ishares/**`, `api/spdr/**` и
`api/fidelity/**`. Данные одного фонда живут в отдельном JSON-файле: изменение
PGX не должно переписывать QQQ и весь каталог.

## Проблема источника

Invesco не публикует документированного bulk-API, но отдаёт CSV-выгрузки прямо со
страниц продуктов (кнопки «Excel Product List Download» и «Download Holdings»):

- **каталог + официальные доходности**:
  `www.invesco.com/us/financial-products/etfs/performance/prices/main/performance/0?audienceType=Advisor&action=download`
  — CSV с юридическими строками в начале (первые 4–5 строк), колонки
  `Fund Name, Ticker, Inception_Date, CUSIP, ISIN, Exchange, Fund Type, As_Of_Date,
  Gross Expense Ratio, NAV, Close Price, Premium/Discount, Fund Assets ($m),
  Trailing 12m Dividend Rate (%), SEC 30 Day (%), YTD, 12 M, 3 Yr Ann, 5 Yr Ann, 10 Yr Ann, Since Inception Ann`;
  у того же эндпоинта есть варианты `asOfDate=MM/DD/YYYY&showNav=true&monthly=true`
  (переключаются через `PRODUCT_LIST_URL`);
- **holdings (только последний срез)**:
  `www.invesco.com/us/financial-products/etfs/holdings/main/holdings/0?audienceType=Investor&action=download&ticker={TICKER}`
  — три разносоставных «вкуса» колонок: акционные (`Holding Ticker`, `Weight`,
  `Shares/Par Value`, `Date`), облигационные (`Security Identifier`,
  `PercentageOfFund`, `CouponRate`, `MaturityDate`, `PositionDate`, биржевого
  тикера нет) и фьючерсные/сырьевые (контракты, но не акции);
- `dng-api.invesco.com/cache/v1/accounts/en_GB/shareclasses/{ISIN}/holdings/fund`
  — публичный, но только для европейских share classes и без `shares`/`market value`
  (только `name, isin, weight, currency`) — не подходит как основной источник;
- полные ежемесячные реестры коллективных трастов закрыты логином;
- история цен по каждому фонду на сайте отдаётся только постранично
  (`/closed-end/performance/historic-prices`), bulk-выгрузки нет.

Дополнительно: `www.invesco.com` недоступен из песочницы агентов (исходящий трафик
заблокирован), поэтому лента генерируется **только в GitHub Actions**
(workflow `Update Invesco ETF data`); в репозитории лежит пустой
`api/invesco/index.json` как стартовое состояние, которое приложение честно
показывает как «0 ETFs» до первого прогона.

Из этих источников собираются три независимых слоя:

1. **investco.com** — каталог, официальные доходности (YTD/1Y/3Y/5Y/10Y/SI),
   TER, NAV, close, premium/discount, `Fund Assets`, trailing-12M дивидендная
   доходность и SEC 30-Day доходность (публикуется не для всех фондов), holdings;
2. **Yahoo Finance chart API** (`/v8/finance/chart/…?events=div`) — ежедневная
   история (close, adjclose), дистрибуции, дата листинга, имя и биржа;
   авторизация не нужна;
3. **SEC EDGAR (форма N-PORT-P)** — только как fallback для фондов, у которых
   выгрузка holdings пуста (например товарные/фьючерсные трасты); CIK
   регистранта находится через `efts.sec.gov` full-text search и кэшируется
   на время прогона. SEC требует объявленный User-Agent (`SEC_UA`) и допускает
   максимум 10 запросов/сек.

## Целевая структура

```text
api/invesco/
  index.json
  update-state.json
  raw/{TICKER}/holdings-YYYY-MM-DD.csv   (STORE_RAW_DOWNLOADS=1)
  funds/{TICKER}/
    meta.json
    holdings/001.json …
    history/001.json …
```

- `index.json` — манифест каталога (тот же набор полей, что у SPDR/Fidelity:
  ter/nav/aum/asOf/inception/exchange/close/premium-discount, distributions,
  returns.monthEnd/quarterEnd, metrics, holdings/history) + `cusip`/`isin`;
- `funds/{TICKER}/meta.json` — метаданные фонда, `identifiers`, `yields`
  (включая базу расчёта доходности), ссылки на выгрузки Invesco/Yahoo и
  `source.holdingsSource`/`historySource` для прозрачности происхождения числа;
- страницы holdings (250 строк) и history (1000 строк) — детерминированные,
  переписываются только при изменении содержимого; лишние страницы удаляются.

## Сид `scripts/invesco-funds.ts`

В отличие от Fidelity, каталог Invesco целиком выгружается одним CSV, поэтому сид
не обязан перечислять фонды: он содержит только построители URL и опциональные
записи вида `{ ticker, name, category, inceptionDate, ter, cusip, isin, exchange,
benchmark, audienceType, fundPage, trustCik }` — «предпочтительный floor»,
который добавляет фонды, не попавшие в выгрузку, и пиннит CIK траста, чтобы не
дергать EDGAR search. `scripts/held-tickers.ts` — генерируемый словарь
`имя позиции → биржевой тикер`.

## Честные ограничения (печатаются в README)

- holdings — только последний опубликованный срез Invesco (исторических срезов в
  публичной выгрузке нет), как у SPDR;
- `3Y/5Y/10Y` в выгрузке — среднегодовые (annualized); колонки `TR 3Y/5Y/10Y`
  выводятся как `(1 + CAGR nY)^n − 1`, колонки `CAGR *` — как опубликовано;
- SEC Yield публикуется Invesco не для всех фондов — для остальных `—`;
- `YTD`/`1Y` из выгрузки — официальные NAV-доходности; если их нет, берутся
  производные значения по adjusted close (Yahoo), и `returnsBasis` это честно
  подписывает;
- позиции облигационных/фьючерсных выгрузок не содержат биржевых тикеров —
  апдейтер заполняет колонку `Ticker` по словарю `scripts/held-tickers.ts` и по
  строгому совпадению названий в Yahoo Finance symbol search (новые маппинги
  дописываются в словарь и коммитятся вместе с данными); позиции без тикера
  остаются `"-"` с CUSIP/ISIN (как у облигаций SPDR и Fidelity);
- `Fund Assets` в выгрузке указан в миллионах (`($m)`) — значение меньше 5·10^6
  умножается на 10^6, иначе трактуется как уже переведённое в доллары.

## Тесты

`bun test scripts/update-data.test.ts`: строгие парсеры диапазонов (`parseRange`,
`parseAumRange` с пресетами), CSV-слой (кавычки, BOM, поиск строки заголовка,
коллизии одноимённых колонок), парсер выгрузки продукта (пересчёт `$m`,
percent/`--`, дедупликация тикеров, сортировка), все три «вкуса» holdings,
NPORT-фикстуры (CUSIP/N-A fallback, пустое тело, accession-фильтр), фикстуры
chart (пропуски close, adjclose, сортировка дивидендов), `parsePricesCsv`,
`priceReturns` (включая null для молодых фондов), якорь квартала,
`annualizedToTotal`/`totalToAnnualized`, `indicatedYield`,
`inferDistributionFrequency`, `deriveCatalogMetrics`, нормализация имён позиций
(share-классы не сливаются: GOOG != GOOGL), `TickerResolver` (один поиск на имя,
деградация в `-`) и формат сида.
