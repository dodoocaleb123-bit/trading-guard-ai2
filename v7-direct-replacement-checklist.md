# v7 Intelligence Direct-Replacement Checklist

## Status

This document is the implementation checklist for replacing v5 with v7 Intelligence. It is a design and preflight record only. No application code, secrets, configuration, database behavior, or live Telegram behavior has been changed.

## Governing decisions

The rollout method is **direct replacement**: v7 becomes the production decision-maker and v5 is removed from the active signal-generation path after preflight validation. The user will provide provider credentials through Render. Telegram event behavior and the universal safety boundaries are confirmed.

The four ordinary channels are independent. BTC/USD, EUR/USD, GBP/USD, and XAU/USD each apply their own strategy and displacement standard. Ordinary channel signals are **never blocked by news**. News is an independent additive path for XAU/USD, EUR/USD, and GBP/USD. BTC/USD is completely excluded from news-data processing and news-event signals.

## Session windows

| Asset | Entry session |
|---|---|
| XAU/USD | 08:00–17:00 UTC, with the XAU strategy’s London/New York context and strict Daily/4H plus 1H/15M alignment |
| EUR/USD | 08:00–17:00 UTC |
| GBP/USD | 08:00–17:00 UTC |
| BTC/USD | 08:00–17:00 UTC |

The engine should use UTC internally. Only new entries are restricted by the session window; already-delivered trades remain trackable unless a later explicit risk policy says otherwise.

## Channel contracts

### XAU/USD

XAU/USD requires strict Daily/4H context with supporting 1H/15M execution alignment. Its structural stop uses `0.35 × ATR(14)` on the 15-minute timeframe beyond the structural swing. One-minute refinement is disabled by default and cannot create an independent signal.

The XAU mechanical definitions are a 3-left/3-right confirmed pivot, a liquidity sweep of at least `0.05 × ATR(14)` beyond the protected swing followed by a close back inside within three candles, and displacement with body at least `1.5 ×` the prior-20 median body **and** total range at least `1.0 × ATR(14)`. POI priority is higher-timeframe supply/demand, OB-plus-FVG overlap, FVG, OB, then clean structural support/resistance or displacement origin. The first opposing obstacle that produces at least 1:2 is preferred; nearer obstacles may never be ignored.

XAG/USD confirmation is part of XAU’s separate data dependency. XAG must support the direction, but an additional corresponding XAG sweep/structure event is optional confluence. Missing or stale XAG data must be recorded explicitly and handled according to the final XAU dependency policy.

### BTC/USD

BTC/USD uses 1W → 1D → 4H → 1H → 15M context and produces native signals on 15M. BTC uses the confirmed 0.25 × ATR(14) execution-timeframe structural buffer. BTC has no news-data dependency, no crypto-news warning path, and no news-event signal path.

BTC uses the common swing, sweep, POI, and target-obstacle definitions. Its own displacement standard is retained: a directionally strong candle based on the prior-10 median body, preferably closing near its extreme, and breaking meaningful opposing structure. A sweep alone never creates a signal. The intended sequence is sweep → displacement → structure shift → displacement-linked POI → retracement → entry.

### EUR/USD

EUR/USD uses the common mechanical swing, sweep, POI, and target-obstacle definitions, with a structural stop of 2 pips beyond the relevant structural high or low. Its native signal must pass the EUR/USD strategy, minimum 1:2 structural RR, Entry Locator, and universal safety gates.

EUR/USD participates in the independent news-event path. Its ordinary channel signals are not blocked by news. After an event, the separate observation period is 60 minutes; a NEWS-EVENT SIGNAL must still pass the independent post-release confirmation and universal safety gates.

### GBP/USD

GBP/USD uses the common mechanical swing, sweep, POI, and target-obstacle definitions, with a structural stop of 3 pips beyond the relevant structural high or low. Its native signal must pass the GBP/USD strategy, minimum 1:2 structural RR, Entry Locator, and universal safety gates.

GBP/USD participates in the independent news-event path. Its ordinary channel signals are not blocked by news. After an event, the separate observation period is 60 minutes; a NEWS-EVENT SIGNAL must still pass the independent post-release confirmation and universal safety gates.

## Shared signal qualification

Every ordinary channel must complete its asset-specific workflow before the shared layer is reached. The shared layer verifies that the entry, structural stop, opposing target, and final RR are present; the final target is at least 1:2 and structurally realistic; no nearer obstacle is silently ignored; market data is fresh; and the setup is not an exact duplicate.

Entry Locator remains a post-plan eligibility gate and does not replace or compete with the four asset strategies. Duplicate suppression, contradiction-chain rules, open-trade state, Telegram idempotency, tracking, outcome recovery, and Monitoring remain active.

Account-based position sizing is not required for paper signals. Daily trade-count and daily-loss caps are not part of qualification. A channel may send any number of independently qualifying signals.

## Independent news-event path

The news path applies only to XAU/USD, EUR/USD, and GBP/USD. It retrieves scheduled events from the approved production calendar, sends a `NEWS_WARNING` one day before and one hour before release, and sends a `NEWS_DIRECTIONAL_WARNING` immediately after release with the event, affected asset, scheduled time, actual, forecast, surprise, and provisional direction. The warning must state that the headline interpretation is not yet confirmed by price action.

The post-release path then observes the market for the asset-specific confirmation sequence: liquidity sweep, displacement, 5M BOS/CHoCH, retracement into a POI, structural stop, realistic target, and final RR of at least 1:2. A successful result is sent as a separately labeled `NEWS_EVENT_SIGNAL`. It may bypass the asset-specific ordinary strategy only; it may not bypass fresh data, valid levels, structural risk geometry, minimum RR, duplicate suppression, idempotent Telegram delivery, or tracking.

BTC/USD receives none of these news records or messages.

## Direct-replacement preflight

Before switching production ownership from v5 to v7, the implementation must complete the following gates:

1. Verify Render contains the required Twelve Data, EODHD, Trading Economics, Telegram, and database credentials without exposing them in code or logs.
2. Probe Twelve Data for every required asset and timeframe and verify actual data, timestamps, and quota behavior.
3. Probe EODHD for real XAG/USD messages and confirm the XAU/XAG dependency contract.
4. Probe the approved calendar provider for XAU/USD, EUR/USD, and GBP/USD events and verify event time, impact, forecast, actual, surprise, and freshness fields.
5. Verify UTC session-window handling and direct-replacement ownership in a controlled environment.
6. Run deterministic tests for all four channels, the independent news path, duplicate suppression, contradiction chains, tracking, outcome recovery, and Telegram idempotency.
7. Validate Monitoring shows channel decisions, WAIT reasons, provider states, news warnings, news-event signals, and ordinary channel signals separately.
8. Take a recoverable checkpoint before the cutover and define a rollback to the last stable v5 release.
9. Perform the v7 cutover only after the user explicitly authorizes implementation and the preflight gates pass.

Until these gates are authorized and completed, v5 remains the live production system and v7 remains a design specification.

## Remaining implementation decisions

The main strategy decisions are now confirmed. The remaining work is implementation-level: provider endpoint and entitlement verification, exact calendar credential setup, data freshness measurements, schema migration design, and safe direct-replacement rollout mechanics. These are not to be inferred from the retired documents; they must be verified during preflight.

## Explicit current boundary

No application code, secrets, Render configuration, database schema, Telegram behavior, or live deployment has been changed as part of this checklist.
