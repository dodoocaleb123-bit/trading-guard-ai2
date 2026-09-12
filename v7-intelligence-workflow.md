# v7 Intelligence: Complete End-to-End Workflow

## Status and governing principle

This document is the design workflow for the proposed **v7 Intelligence** architecture. It is not an implementation record. No application code, scanner behavior, database schema, provider configuration, secrets, or Telegram behavior has been changed.

The governing principle is that v7 has **one shared orchestration and safety framework**, but four independent asset-strategy channels. Each channel owns its asset-specific trading judgment. Shared infrastructure may validate, persist, deduplicate, deliver, track, and observe a result, but it must not invent a strategy or override a channel’s mandatory WAIT decision.

The latest news-event decision supersedes older provisional strategy wording that treated news as an ordinary entry-blocking gate. In v7, news does **not** block a qualified ordinary channel signal. News is processed by a separate event-awareness path for XAU/USD, GBP/USD, and EUR/USD. BTC/USD is explicitly excluded from all news-data processing.

## 1. Scanner cycle and data collection

The scanner runs on its configured cadence and begins by creating a cycle identifier and UTC timestamp. It retrieves the market data required by each asset channel, validates the provider response, normalizes symbols and timestamps, and records the age and source of every observation.

The scanner must fail closed for missing market evidence: it may return a documented WAIT result, but it must never fabricate a candle, quote, zone, spread, correlation value, news state, or confidence score. Each cycle should preserve a complete evidence payload even when no signal is produced.

The data layer supplies:

| Channel | Required strategy data |
|---|---|
| BTC/USD | 1W, 1D, 4H, 1H, 15M candles; optional 5M refinement; price and any required spread/quote fields. BTC news is not queried. |
| EUR/USD | 1W, 1D, 4H, 1H, 15M context and execution data; optional indicator and pattern inputs. |
| GBP/USD | 1W, 1D, 4H, 1H, 15M setup data and 5M market-shift/BOS execution data; spread and ATR are required for its post-news volatility logic if that path is implemented. |
| XAU/USD | Daily/4H, 1H, 15M, 5M, optional 1M refinement, live XAU quote and spread; XAG/USD directional confirmation; Trading Economics event context for the separate news path. |

The scanner then routes each normalized asset snapshot to exactly one strategy channel. Data from one asset must not silently become another asset’s evidence.

## 2. Shared channel evaluation contract

Each channel returns an auditable result such as `WAITING`, `QUALIFIED`, `REJECTED`, or `DATA_UNAVAILABLE`. The result includes asset, channel version, cycle ID, timestamps, timeframe coverage, bias, POIs, liquidity observations, confirmation states, entry, stop, target, actual RR, optional confluence, exact reasons, and unresolved dependencies.

The shared sequence is:

> **Retrieve → validate → map context → identify POIs and liquidity → evaluate the asset strategy → construct executable levels → apply universal safety gates → persist decision → apply duplicate/contradiction rules → deliver or WAIT → track and monitor.**

A POI is a meaningful reaction area such as validated supply/demand, support/resistance, an order block, fair-value gap or imbalance origin, displacement origin, swing/liquidity level, or structurally supported range boundary. A POI alone never creates a signal.

## 3. BTC/USD channel

BTC/USD is the only native **15M signal channel**. The hierarchy is:

> **1W → 1D → 4H → 1H activation → 15M break and retracement.**

The 1W defines dominant macro structure, the 1D confirms the major environment and levels, the 4H maps dead zones/order blocks/ranges and repeated-reaction areas, and the 1H defines the active setup and activation level. Until the 1H activation condition occurs, the channel remains WAITING.

A valid BTC location may be a dead zone or order block with two or three meaningful reactions, one exceptionally strong displacement origin, a meaningful range boundary, repeated support/resistance, or an active range’s preferred discount/premium area. BUYs prefer the 0–25% discount zone; SELLs prefer the 75–100% premium zone. The 50% level, trendlines, triangles, and five-touch patterns are optional confluence only.

For a BUY, the 1W/1D/4H context must be bullish or show an approved reversal. Price must reach a meaningful location, the 1H setup must activate, and the 15M chart must form a meaningful bullish structure break, preferably after a downside liquidity event or support rejection. The initial breakout cannot be chased. Price must pull back or retest, preserve the protected structure, and produce a structural stop and meaningful opposing target with final RR at least 1:2.

For a SELL, the same sequence is reversed: bearish higher-timeframe context, meaningful supply/dead-zone/premium location, 1H activation, 15M bearish structure break, pullback/retest, structural invalidation, realistic opposing target, and final RR at least 1:2.

A 5M observation may refine an already valid 15M entry but can never create or override a BTC signal. The 1:1 level may be recorded as an internal TP1/management milestone; it is not a valid final signal target. Break-even may occur only after TP1/1R and 15M continuation confirmation.

BTC has no account-based sizing, no daily loss cap, and no daily signal-count cap. It may emit any number of independently qualified signals. BTC receives no crypto-news feed, event reminder, directional warning, or NEWS-EVENT SIGNAL.

## 4. EUR/USD channel

EUR/USD uses:

> **1W → 1D → 4H → 1H → 15M.**

Structure controls bias. The channel maps higher-timeframe supply/demand, support/resistance, prior-day and prior-week levels, liquidity pools, displacement origins, daily floor pivots, and premium/discount location. Pivots, the 200 MA, 20/50 MA behavior, engulfing candles, Stochastic RSI, harmonic patterns, and Wyckoff patterns are optional confluence and cannot independently create a signal.

The mandatory EUR engine is:

> **Meaningful location → liquidity sweep or false break → premium/discount confirmation → 15M CHoCH/BOS with candle close → retracement → confirmation entry.**

For a BUY, structure must be bullish or a confirmed reversal must be underway. Price must reach demand/support/liquidity/discount, sweep sell-side liquidity, confirm a bullish 15M CHoCH/BOS by candle close, and retrace without invalidating the protected swing. For a SELL, the sequence is reversed using supply/resistance/premium, a buy-side sweep, bearish 15M CHoCH/BOS, and a protected retracement.

The default entry is confirmation-only. Blind limit entries at the original location and scaling-in are disabled. Stops sit beyond structural invalidation with a buffer. The nearest meaningful opposing level is evaluated first; a farther target is allowed only when structurally credible and the nearer obstacle is respected. Final RR must be at least 1:2.

EUR/USD has no account-based sizing, no daily loss cap, and no daily signal-count cap. Any number of independently qualified EUR/USD signals may be produced. EUR/USD’s ordinary channel is not blocked by news under the v7 event-path decision; news is handled separately as event context and possible news-event flow.

## 5. GBP/USD channel

GBP/USD uses Daily/4H/1H for actionable direction, with 1W as broad context, 15M for the primary setup, and 5M for the mandatory lower-timeframe market shift/BOS confirmation.

The mandatory sequence is:

> **Daily/4H bias → valid higher-timeframe POI → meaningful liquidity sweep → 5M body-close market shift/BOS → new 5M imbalance or order-block zone → deep corrective retracement → entry.**

Liquidity may come from Asia High/Low, London High/Low, previous-day High/Low, equal highs/lows, consolidation extremes, or higher-timeframe swing liquidity. London High/Low is preferred during London but is not mandatory. DXY inverse correlation, the 89-day MA, currency strength, and 1W context are optional confluence.

For a BUY, GBP/USD needs bullish Daily/4H/1H context or a confirmed reversal, a demand/support POI, a sell-side sweep, a 5M candle-body close beyond meaningful bearish structure, creation of a new imbalance/order block, and a deep valid retracement. For a SELL, the sequence is reversed.

A wick alone is not BOS. The channel must not enter directly after an impulse, use a blind limit at the original POI, or chase a breakout. The stop is structural, not a fixed 10-pip distance. The nearest meaningful opposing liquidity/level is evaluated first. A 1:3 target is preferred only when genuine structure supports it; the hard minimum final RR is 1:2.

GBP/USD uses set-and-forget management: no automatic break-even and no partial profit-taking in the default channel. Scaling, pyramiding, and adding to losers are disabled. There is no account-based sizing, daily loss cap, or daily trade-count cap.

## 6. XAU/USD channel

XAU/USD uses a strict primary trend workflow:

> **London/New York session → Daily or 4H bias → 1H/15M alignment → 15M POI and liquidity → sweep → rejection → displacement/market shift → 5M confirmation → retracement → XAG confirmation → structural stop → realistic target.**

The Asian session is outside the video-derived primary trading window. Daily/4H identifies the major swing range and bias, 1H refines direction, and 15M maps supply/demand, support/resistance, FVGs, order blocks, displacement origins, swings, and liquidity. 5M is the primary confirmation/execution timeframe. 1M is optional refinement only after the full setup exists and can never create a signal.

For a BUY, the higher-timeframe bias must be bullish, 1H and 15M must be aligned or structurally supportive, price must reach a 15M demand/bullish POI, sell-side liquidity must be swept, the sweep must reject, bullish displacement or a meaningful 5M shift must occur, and price must retrace into a valid confirmation area. XAG/USD must support the BUY direction. SELL is the exact reverse.

The conservative market-shift/retracement model is the recommended primary entry. Aggressive sweep-only entry and counter-trend scalp modes are not part of the default channel. Candlestick confirmation is optional unless separately enabled.

The XAU stop is beyond the protected sweep wick or structural invalidation with the approved buffer. Targets are ordered nearest to farthest, obstacles are considered, and the first valid opposing target offering at least 1:2 is selected. The locked TP buffer is `max(0.05 × ATR(14), 2 × live spread, 1 tick)`. Live spread is mandatory. XAG/USD must have the same directional bias; a corresponding XAG structure event within five minutes is optional confluence, while opposite, stale, or unavailable XAG data produces WAIT.

XAU uses the Twelve Data XAU source, EODHD XAG source, and Trading Economics only for the separate event path. The required quote, spread, OHLC, XAG, and freshness checks must pass before a normal XAU plan is eligible. XAU has no account-based sizing, daily loss cap, or daily trade-count cap.

## 7. Independent non-BTC news-event path

The news path does not control or replace any ordinary asset channel. It applies to XAU/USD, GBP/USD, and EUR/USD only. BTC/USD is excluded completely.

The scanner retrieves upcoming and recently released events from the selected central economic-calendar source, maps currencies to assets, and records event name, impact, scheduled time, actual, forecast, surprise, provider timestamp, source, and status.

It sends:

1. `NEWS_WARNING` one day before and one hour before the event, showing the event, affected asset, date, time, and countdown.
2. `NEWS_DIRECTIONAL_WARNING` after release, showing actual, forecast, surprise, event time, and a provisional interpretation. It must state that the headline has not confirmed a trade direction.
3. `NEWS_EVENT_SIGNAL` only after price confirms the event-associated move through the separate sequence.

The news-event confirmation sequence is:

> **Release → record actual/forecast/surprise → observe reaction → liquidity sweep → strong displacement → 5M BOS/CHoCH → retracement into a valid POI → entry/structural stop/realistic target → RR ≥ 1:2 → universal safety gates → NEWS_EVENT_SIGNAL.**

A NEWS_EVENT_SIGNAL may bypass the asset-specific video strategy because its purpose is to capture a post-news move that may contradict existing structure. It may not bypass universal safety: fresh non-fabricated data, valid entry, structural stop, realistic target, minimum 1:2 RR, duplicate suppression, Telegram idempotency, persistence, tracking, and outcome recovery.

A news warning, directional warning, or news-event signal must not add confluence to, suppress, alter, or block an ordinary channel signal. Telegram labels must make the origin unmistakable: `CHANNEL_SIGNAL`, `NEWS_WARNING`, `NEWS_DIRECTIONAL_WARNING`, or `NEWS_EVENT_SIGNAL`.

## 8. Shared universal safety and Entry Locator layer

Only a channel result marked QUALIFIED, or a separately confirmed NEWS_EVENT_SIGNAL, proceeds to shared execution checks. The shared layer verifies complete directional geometry, executable entry/stop/target, realistic target placement, final RR, data freshness, duplicate identity, and signal eligibility.

Entry Locator is not a fifth strategy. It cannot invent a setup, replace a channel’s levels, turn WAIT into QUALIFIED, or override an asset-specific mandatory rule. It verifies whether an already formed plan is eligible for emission.

Shared safety also checks:

- No duplicate setup fingerprint across concurrent workers or shared Telegram destinations.
- No invalid replacement or contradiction chain.
- Correct parent/resolution rules for threaded replacements.
- Paper-only labeling where applicable.
- Complete decision evidence and signal identity.
- No stale or fabricated provider values.

## 9. Persistence, Telegram, and tracking

The system persists the channel decision before delivery using an atomic identity and delivery ledger. If another worker has already persisted the same setup, the duplicate is suppressed and recorded rather than sent twice.

A delivered `CHANNEL_SIGNAL` or `NEWS_EVENT_SIGNAL` is sent to its configured Telegram destination with its source class, asset, timeframe, entry, stop, target, RR, evidence summary, and paper/validation status. Warnings are sent as warnings, not disguised as trade signals.

Tracking records the signal’s lifecycle, open state, replacements, contradiction relationships, outcome, outcome source, and outcome notification. Resolution and outcome recovery remain idempotent. A closed signal must not continue blocking a new eligible setup except where an explicit active-state rule requires it.

## 10. Monitoring and observability

Monitoring should show, per scanner cycle and per asset:

- Provider status, timestamps, data age, and missing fields.
- Timeframe coverage and v7 channel decision.
- Bias, POI, liquidity, confirmation, entry, stop, target, and RR evidence.
- Exact WAIT or rejection reason.
- Ordinary channel versus news-event source.
- Event reminders, release processing, actual/forecast/surprise, provisional direction, and confirmation stage.
- XAU/XAG synchronization and spread status.
- Duplicate suppression, contradiction chains, replacement links, and delivery outcomes.
- Tracking state and outcome-notification status.

A healthy Monitoring view must distinguish **strategy WAIT** from **provider unavailable**, **news-event observation**, **duplicate suppression**, **open-trade state**, and **Telegram delivery failure**.

## 11. Complete decision outcomes

Each asset cycle ends in one of these meaningful states:

| Outcome | Meaning |
|---|---|
| `WAITING_STRATEGY` | Required strategy sequence has not completed. |
| `WAITING_DATA` | Required market data is stale, missing, or invalid. |
| `WAITING_EVENT_OBSERVATION` | A news event is being observed for the separate non-BTC event path. |
| `QUALIFIED_CHANNEL` | The asset-specific strategy passed and the plan can enter shared safety checks. |
| `QUALIFIED_NEWS_EVENT` | The separate post-news confirmation passed and universal safety checks can run. |
| `SUPPRESSED_DUPLICATE` | An identical setup was already persisted or delivered. |
| `SUPPRESSED_STATE` | Open-trade or contradiction-chain rules prevent a new delivery. |
| `DELIVERED` | The signal passed all required gates and was sent to Telegram. |

## 12. What v7 does not do

v7 does not let a headline directly choose BUY or SELL. It does not set a stop merely from a desired RR, force a distant target, use a zone touch as an entry, treat optional indicators as mandatory, fabricate missing news or market data, or allow BTC news into the decision path.

The four ordinary channels remain independent. The news-event path is additive and separately labeled. The latest design is ready for a later shadow-mode implementation, but **the live app is not yet v7** and no code has been changed.
