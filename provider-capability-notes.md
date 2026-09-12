# Provider capability notes for XAU/USD dependency-readiness design

## Twelve Data
Source: https://twelvedata.com/docs

The Twelve Data documentation states that the time_series endpoint supports `1min`, `5min`, `15min`, `30min`, `45min`, `1h`, `2h`, `4h`, `8h`, `1day`, `1week`, and `1month` intervals. It describes time series as OHLCV data and states that time_series API credits cost 1 per symbol. The documentation also describes real-time price access through a price/quote-style endpoint and notes that API plans, rate limits, permissions, and provider availability must be handled explicitly. It recommends secure key storage, null handling, retries for transient errors, and caching to reduce calls.

The current application code still only declares 5min, 15min, 1h, and 4h series, watches EUR/USD, XAU/USD, GBP/USD, and BTC/USD, and does not currently include XAG/USD, 1M, live spread, or a dedicated quote freshness contract in the v5 scanner.

## Trading Economics
Sources:
- https://tradingeconomics.com/api/calendar.aspx
- https://docs.tradingeconomics.com/economic_calendar/snapshot/
- https://docs.tradingeconomics.com/economic_calendar/point-in-time/

Trading Economics documents a near-real-time economic calendar and calendar endpoints that can return event date, country, category/event, importance, actual, previous, forecast, and update fields. The snapshot documentation shows a calendar endpoint authenticated with a credential parameter and supports country/date filtering. The point-in-time documentation describes historical calendar retrieval for auditing and backtesting.

The current application does not use Trading Economics. Its existing macro module uses FRED, ECB, BOE, and a Forex Factory weekly calendar. Therefore, a Trading Economics integration would require a separate credential, provider client, event normalization, impact mapping, freshness validation, and explicit missing-data behavior.

## Design implication

The locked XAU/USD strategy can be implemented only after the application can retrieve and validate XAU/USD and XAG/USD quotes, spread, 1M and 5M OHLC, and Trading Economics news data within the user-defined freshness limits. If any mandatory input is unavailable or stale, the safe result is WAIT; no fallback may fabricate spread, correlation, news clearance, or precision data.

## EODHD comparison
Sources:
- https://eodhd.com/financial-apis/intraday-historical-data-api
- https://eodhd.com/financial-apis/new-real-time-data-api-websockets
- https://eodhd.com/financial-apis/economic-events-data-api
- https://eodhd.com/pricing

EODHD documents an intraday API with 1-minute, 5-minute, and 1-hour intervals for forex and cryptocurrencies, while noting that intraday data is delayed/finalized rather than a live tick feed. Its real-time WebSocket documentation describes a FOREX feed with bid, ask, daily change, and timestamp fields, and a crypto feed; it lists forex symbols in compact form such as EURUSD. Symbol availability and plan access still require account-level verification, and the docs warn that unknown symbols can remain silent without streaming data.

EODHD also documents an economic-events endpoint with date, country, event type, actual, previous, estimate, and timestamp fields. It can provide a calendar source, but event importance/severity mapping and the exact high-impact classification required by the XAU/USD strategy must be implemented and tested by the application.

Design implication: EODHD could potentially supply XAG/USD and XAU/USD live bid/ask via its FOREX WebSocket, 1M/5M/1H historical bars via its intraday endpoint, and economic events via its calendar endpoint. It is not automatically a complete drop-in replacement: symbol coverage for XAUUSD/XAGUSD, plan entitlement, latency, reconnect behavior, quote timestamp semantics, and the absence/presence of a direct spread field must be verified with the user’s account and a live probe before selecting it for production. Its documented intraday endpoint should not be treated as a substitute for live quotes.


## User-approved split-provider go/no-go gates

The user approved the following progression for the XAU/XAG design:

`Provider probe → data validation → synchronization test → shadow mode → paper signals → Telegram delivery`.

Trading Economics remains independent initially. EODHD is evaluated for XAG/USD market data only; it must not be coupled to the news system at this stage.

EODHD XAG/USD is usable only when all five states are true: CONNECTED, SUBSCRIBED, RECEIVING DATA, DATA FRESH, and TIMESTAMP SYNCHRONIZED. A successful HTTP response or WebSocket subscription with zero messages is not a valid feed.

Twelve Data XAU/USD is usable only after a quote is received, its timestamp is valid, bid is present, ask is present, spread is calculated, and freshness is within the locked limit. Any failed mandatory component produces WAIT; stale or fabricated substitutions are forbidden.

Telegram is the final stage and must remain disabled during provider probes, data validation, synchronization tests, and shadow mode. The requirements are not considered verified until direct live probes record actual XAGUSD stream messages, XAU bid/ask observations, timestamps, and synchronization/freshness measurements.
