# v7 Intelligence: Detailed Design-Only Workflow

## Status and purpose

v7 Intelligence is the planned replacement for the currently deployed v5 system. This document describes how v7 is intended to work; it is not an implementation record. The application, Render configuration, secrets, database behavior, Telegram delivery, and GitHub repository have not been changed by this explanation.

The defining idea is that v7 has **four independent asset channels**—XAU/USD, BTC/USD, EUR/USD, and GBP/USD—surrounded by shared safety, delivery, tracking, and observability infrastructure. Each channel owns its asset’s trading logic. No channel borrows another asset’s strategy or displacement standard.

## 1. Scanner cycle

At each scanner cycle, the server retrieves the market data required by each channel, timestamps every response, checks freshness, normalizes the data into a common internal shape, and records provider status. The scanner does not send raw provider responses directly to Telegram.

The normalized snapshot contains candles, current price where available, timeframe timestamps, source/provider identity, data age, and any failed dependency reason. A missing or stale mandatory input produces a persisted WAIT reason rather than a guessed value.

The planned primary provider responsibilities are Twelve Data for the major market-data inputs, EODHD for XAG/USD confirmation required by XAU/USD, and the approved economic calendar for the independent XAU/USD, EUR/USD, and GBP/USD news-event path. BTC/USD has no news-data dependency.

Internally, the engine uses UTC for scheduling and timestamps. The configured entry session is 08:00–17:00 UTC for XAU/USD, EUR/USD, GBP/USD, and BTC/USD. Only new entries are subject to the session window; already-delivered trades remain trackable.

## 2. Routing into four independent channels

After the common snapshot is validated, the asset router sends each asset’s data to its own channel. The channels may run in the same scanner cycle, but they do not share directional judgments.

```text
Market-data snapshot
        ↓
Freshness and provider validation
        ↓
Asset router
   ┌────┼────┬────┐
 XAU  BTC  EUR  GBP
   └────┼────┴────┘
        ↓
Asset-specific plan or WAIT
        ↓
Shared Entry Locator and safety layer
        ↓
Persistence → Telegram → tracking → Monitoring
```

A channel first decides whether its own strategy has produced a complete executable plan. Only then does the shared layer evaluate delivery eligibility.

## 3. XAU/USD channel

XAU/USD requires strict Daily/4H context with supporting 1H/15M execution alignment. Its one-minute refinement is disabled by default and cannot create an independent signal.

The channel identifies a confirmed 3-left/3-right pivot. A valid liquidity sweep must travel at least `0.05 × ATR(14)` beyond the protected swing and then close back inside within three candles. A valid XAU displacement requires a candle body at least `1.5 ×` the median body of the prior 20 candles and a total range of at least `1.0 × ATR(14)`.

POIs are prioritized as higher-timeframe supply/demand, an order-block plus fair-value-gap overlap, a fair-value gap, an order block, and then clean structural support/resistance or a displacement origin. The channel waits for the required reaction, displacement, structure consequence, and retracement rather than treating a POI touch as an entry.

The structural stop is placed beyond the relevant 15M structure using the approved XAU buffer of `0.35 × ATR(14)`. The first meaningful opposing obstacle that produces at least 1:2 is preferred. A nearer obstacle cannot be ignored simply to manufacture a higher ratio.

XAG/USD supplies directional confirmation for XAU. An additional matching XAG sweep or structure event is optional confluence. XAG data is a separate dependency and must be represented with its own timestamp and provider state.

## 4. BTC/USD channel

BTC/USD uses the hierarchy **1W → 1D → 4H → 1H → 15M**. The 15M timeframe is the only native signal timeframe. Lower-timeframe information may refine an already-valid plan but cannot independently create a BTC signal.

The channel identifies meaningful dead zones, order blocks, repeated-reaction areas, strong displacement origins, ranges, support/resistance, and liquidity levels. Its intended sequence is:

> **Sweep → displacement → structure shift → displacement-linked POI → retracement → entry.**

A sweep alone is insufficient. BTC retains its own displacement standard: a directionally strong candle based on the prior-10 median body, preferably closing near its extreme, and breaking meaningful opposing structure. The structural buffer is `0.25 × ATR(14)` on the execution timeframe.

BTC is completely outside the news-data path. It receives no crypto-news records, no economic-event warnings, no provisional news directions, and no NEWS-EVENT SIGNALs. BTC decisions are based only on its market-data strategy and shared safety controls.

## 5. EUR/USD channel

EUR/USD uses the common mechanical swing, sweep, POI, and target-obstacle definitions, while retaining its own structural stop buffer of 2 pips beyond the relevant structural high or low. Its channel must produce a valid EUR/USD plan, realistic target, and final RR of at least 1:2.

The ordinary EUR/USD channel is never blocked by news. EUR/USD can qualify through its normal strategy while the separate news-event path independently records an event or observes a post-release move.

After a relevant event, the independent EUR news-event observation period is 60 minutes. A NEWS-EVENT SIGNAL is not an ordinary EUR/USD channel signal; it is a separate post-release opportunity that must pass its own confirmation and universal safety gates.

## 6. GBP/USD channel

GBP/USD uses the common mechanical swing, sweep, POI, and target-obstacle definitions, while retaining its own structural stop buffer of 3 pips beyond the relevant structural high or low. Its channel must produce a valid GBP/USD plan, realistic target, and final RR of at least 1:2.

The ordinary GBP/USD channel is never blocked by news. It continues to evaluate its own strategy whether or not an event is approaching or has recently been released.

After a relevant event, the independent GBP news-event observation period is 60 minutes. A NEWS-EVENT SIGNAL is a separate post-release opportunity and must pass its confirmation and universal safety gates.

## 7. Common target and risk geometry

All ordinary channels use a hard minimum final RR of **1:2**. A target is realistic when it is placed at a meaningful opposing support, resistance, liquidity level, supply/demand zone, swing level, or other structural obstacle that price can reasonably reach.

The engine evaluates nearer meaningful obstacles first. A farther target may be considered only if the nearer level cannot satisfy 1:2 and the market has a credible structural path toward the farther target. It must not choose an arbitrarily distant target merely to create a high RR.

Stops are structural. The channel places the stop beyond the structure that invalidates the trade idea, using the asset’s approved buffer. Account balance and position sizing are not required for paper signals. There is no daily trade-count cap and no daily-loss cap. A channel may emit any number of independently qualifying signals.

## 8. Shared Entry Locator and safety layer

The Entry Locator runs after an asset channel has completed its own strategy plan. It does not replace the channel and does not create a competing directional judgment. It checks that the proposed entry is executable, the levels are complete, the direction is coherent, the RR passes, the data is fresh, and the plan is eligible for delivery.

The shared safety layer also enforces exact duplicate suppression, open-trade and contradiction-chain rules, Telegram idempotency, tracking registration, and outcome recovery. These controls apply to ordinary channel signals and NEWS-EVENT SIGNALs. The only difference is that a NEWS-EVENT SIGNAL may bypass the asset-specific ordinary strategy; it may not bypass universal execution safety.

## 9. Independent news-event path

The news path applies only to XAU/USD, EUR/USD, and GBP/USD. It does not block ordinary channel signals and does not determine their direction.

The scanner retrieves scheduled events from the approved calendar provider, normalizes the event, maps it to the affected asset or assets, and records the event name, currency, scheduled time, impact, forecast, actual, surprise, provider timestamp, and processing status.

One day before the release and again one hour before the release, Telegram receives a clearly labeled `NEWS_WARNING` containing the event, affected asset, date, and time.

Immediately after release, Telegram receives a `NEWS_DIRECTIONAL_WARNING` containing the event, affected asset, event time, forecast, actual result, surprise, and a provisional interpretation such as “Proposed direction: BUY.” The message must explicitly say that the headline interpretation has not yet been confirmed by price action. The warning is for user awareness and discretion, not a confirmed trade signal.

After the warning, the news-event path observes the affected market for:

> **Liquidity sweep → strong displacement → 5M BOS/CHoCH → retracement into a valid POI → entry, structural stop, realistic target, and minimum 1:2 RR.**

If that complete post-release sequence occurs, v7 sends a separately labeled `NEWS_EVENT_SIGNAL`. It may bypass the ordinary asset channel’s broader strategy because the event can create a new move that contradicts the prior market structure. It still must use fresh data, valid levels, structural risk geometry, realistic target logic, minimum 1:2 RR, duplicate prevention, Telegram idempotency, and tracking.

BTC/USD receives none of these news records or messages.

## 10. Telegram delivery

The delivery layer distinguishes the source of every message. `CHANNEL_SIGNAL` means the signal passed the relevant asset channel. `NEWS_WARNING` is a scheduled reminder. `NEWS_DIRECTIONAL_WARNING` is an immediate post-release provisional interpretation. `NEWS_EVENT_SIGNAL` is a confirmed post-release price-action setup.

The message must show the asset, direction, timeframe, entry, stop, target, RR, source path, and relevant confirmation status. A provisional warning must never be formatted as a confirmed trade signal.

Before sending, the system checks for an exact duplicate and applies existing contradiction-thread rules. After sending, the signal is persisted with its source type, delivery identity, and tracking state. A later outcome must be resolved idempotently and must not create duplicate outcome notifications.

## 11. Monitoring and auditability

Monitoring should show each scanner cycle, provider state, data age, channel decision, WAIT reason, signal source, news event status, confirmation stage, duplicate suppression, Telegram delivery, tracking state, and outcome.

It should be possible to answer whether a signal was:

| Question | Example answer |
|---|---|
| Which path produced it? | XAU channel or NEWS_EVENT_SIGNAL |
| Was news involved? | Warning only, confirmed event path, or not involved |
| Why did a channel wait? | Missing data, incomplete structure, poor RR, no POI, or no retracement |
| Was it delivered once? | Delivery ledger and fingerprint |
| Is it being tracked? | Open, resolved, pending reconciliation, or recovered |

## 12. Direct-replacement preflight

Direct replacement does not mean immediate unverified cutover. Before v7 becomes the production decision-maker, Render credentials must be present and protected; Twelve Data must return the required candles and timestamps; EODHD must produce real XAG/USD messages; and the approved calendar provider must return event times, impact, forecast, actual, surprise, and freshness fields.

The implementation must then pass deterministic tests for all four channels, the independent non-BTC news path, duplicate prevention, contradiction chains, Telegram idempotency, tracking, outcome recovery, and Monitoring. A recoverable checkpoint and rollback path must exist before cutover.

After those gates pass and the user explicitly authorizes implementation, v5 can be removed from the active decision path and v7 can become the direct production decision-maker. Until then, v5 remains live and v7 remains a design specification.

## Explicit current status

The v7 workflow is a design explanation only. No application code, Render secrets, provider configuration, database schema, live Telegram behavior, or GitHub repository has been changed for this workflow explanation.
