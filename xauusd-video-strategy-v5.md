# XAU/USD Video-Derived Strategy for the v5 Channel

## Scope

This strategy is derived from the two uploaded XAU/USD videos in `Video.zip`. It is a **design specification only**. The existing app, scanner, v5 code, Entry Locator, database, Telegram workflow, and production configuration have not been changed.

The old XAU/USD strategy should be considered replaced conceptually by this specification only after the user approves the unresolved definitions and the implementation plan.

## Core principle

The XAU/USD channel should not enter because price merely touches a zone. The video-derived sequence is:

> **Session and market context → higher-timeframe bias and range → 1H/15M directional agreement → 15M POI and liquidity → liquidity sweep → reaction/rejection → displacement or market shift → lower-timeframe confirmation → retracement entry → structural stop → nearest logical target → risk and correlation gates.**

The strategy is designed to capture a clean section of a gold move rather than predict or hold every large movement.

## Timeframe and session architecture

| Layer | Video-derived purpose |
|---|---|
| **Daily or 4H** | Establish the major structural bias and identify the most recent major swing high and swing low that define the active range. The second video prefers 4H; Daily is an allowed higher-timeframe alternative. |
| **1H** | Refine the directional bias and identify the current 1H swing range. The first video requires 1H directional agreement with 15M for the main setup. |
| **15M** | Identify inner structure, demand/supply, support/resistance, displacement origins, FVGs, order blocks, swing levels, and the primary point of interest. It also maps internal liquidity. |
| **5M** | Primary execution and confirmation timeframe for the main channel. It confirms sweep reaction, displacement, market shift/BOS, and retracement entry. |
| **1M** | Optional precision refinement only after the higher-timeframe, 15M, and 5M setup is already confirmed. It must not create an independent signal. |
| **XAG/USD** | Correlation confirmation. Silver must support the intended Gold direction before the setup is valid. |

The videos state that only the **London and New York sessions** should be traded. The Asian session is a no-trade period for this strategy. The exact session boundaries must be defined with the broker/chart timezone and daylight-saving rules before implementation.

## Directional bias rules

The primary trend setup uses a single directional bias. If the higher-timeframe structure is bullish, the channel looks for BUYs; if bearish, it looks for SELLs. A clear range or unclear structure returns **WAIT**.

The higher-timeframe map must include:

- Major swing high and swing low defining the active range.
- Major support and resistance.
- Demand and supply zones.
- Strong rejection areas.
- Previous impulsive-move origins.
- FVGs or gaps created by aggressive displacement.
- Valid trendlines only when multiple reactions support them.

For the primary trend channel, the combined video rules should be represented as follows:

| Requirement | BUY | SELL |
|---|---|---|
| Higher-timeframe bias | Bullish | Bearish |
| 1H structure | Bullish or structurally supportive | Bearish or structurally supportive |
| 15M directional structure | Bullish and aligned with 1H | Bearish and aligned with 1H |
| Preferred POI | 15M demand, bullish displacement origin, support, or sell-side liquidity | 15M supply, bearish displacement origin, resistance, or buy-side liquidity |
| Expected liquidity event | Sell-side liquidity sweep | Buy-side liquidity sweep |
| Expected reaction | Rejection and bullish shift | Rejection and bearish shift |

The requirement that **1H and 15M must align** comes directly from the first video. Combining it with the second video’s 4H/Daily bias produces a deliberately strict intersection. This will reduce the number of signals and must be confirmed before implementation.

## Liquidity and POI rules

A valid setup requires price to reach a meaningful point of interest. The channel must not enter while price is travelling through the middle of the range or sitting in an undefined area.

Liquidity candidates include previous highs and lows, equal highs and lows, internal swing highs and lows, session highs and lows, range highs and lows, and obvious stop pools. A POI may be demand, supply, support, resistance, an FVG, an order block, a displacement origin, or a valid trendline/level supported by multiple reactions.

The minimum location rule is:

> **No meaningful POI and no meaningful liquidity context means WAIT.**

## Primary trend-entry sequence

### BUY

1. The market is inside the London or New York trading window.
2. Daily or 4H bias is bullish and the 1H/15M structures are aligned or supportive.
3. Price reaches a valid 15M demand or other bullish POI inside the higher-timeframe range.
4. Price sweeps sell-side liquidity below a meaningful low.
5. Price rejects the sweep and fails to continue lower.
6. A bullish displacement, market shift, or meaningful 5M structure break occurs.
7. The setup enters through an approved confirmation model.
8. Price retraces into the new confirmation area or another approved entry area.
9. The XAG/USD correlation check supports BUY.
10. The stop is placed below the protected sweep low or structural invalidation with the approved buffer.
11. The target is the nearest logical opposing liquidity or structure.
12. The risk/reward and all channel gates pass before emission.

### SELL

1. The market is inside the London or New York trading window.
2. Daily or 4H bias is bearish and the 1H/15M structures are aligned or supportive.
3. Price reaches a valid 15M supply or other bearish POI inside the higher-timeframe range.
4. Price sweeps buy-side liquidity above a meaningful high.
5. Price rejects the sweep and fails to continue higher.
6. A bearish displacement, market shift, or meaningful 5M structure break occurs.
7. The setup enters through an approved confirmation model.
8. Price retraces into the new confirmation area or another approved entry area.
9. The XAG/USD correlation check supports SELL.
10. The stop is placed above the protected sweep high or structural invalidation with the approved buffer.
11. The target is the nearest logical opposing liquidity or structure.
12. The risk/reward and all channel gates pass before emission.

## Approved entry models from the videos

The first video presents three entry models. They should be represented distinctly rather than mixed together:

| Model | Video-derived behavior | Proposed status |
|---|---|---|
| **A: Aggressive sweep rejection** | Enter after the liquidity sweep candle rejects/closes, without waiting for a later market shift. | Optional; should not be enabled as the default until explicitly approved. |
| **B: Conservative market shift** | After the sweep, wait for a lower-timeframe market shift/BOS, then wait for a pullback into the newly created 15M demand/supply zone and enter on mitigation. | Recommended primary model. |
| **C: Candlestick confirmation** | After the sweep, wait for an additional directional candle close to confirm momentum. | Optional confirmation model; exact candle definition unresolved. |

The second video also demonstrates a pullback-phase counter-trend scalp. It explicitly warns that beginners should not use it because it goes against the main trend. Therefore, it must **not** be part of the default primary XAU/USD channel. If retained at all, it should be a separately named, disabled advanced mode and must never mix with the primary trend score.

## Stop-loss rules

The videos consistently require a structural stop rather than an arbitrary fixed-distance stop.

| Direction | Primary stop reference |
|---|---|
| **BUY** | Below the specific candle wick or protected low that swept liquidity, or below the structural invalidation low if that is farther and is the approved rule. |
| **SELL** | Above the specific candle wick or protected high that swept liquidity, or above the structural invalidation high if that is farther and is the approved rule. |

The stop receives a small volatility/spread buffer. The videos do not provide one exact formula. The implementation must not choose ATR, a fixed point distance, or a candle-range multiple without approval.

The stop cannot be moved farther because of fear, cannot be moved closer to manufacture a desired ratio, and cannot be selected from a desired lot size.

## Take-profit rules

The videos prioritize the **nearest logical opposing level** rather than distant mathematical targets. Potential targets include the next 15M internal swing, the 1H swing, opposing supply or demand, a gap/FVG fill, the next key M15 level, or the next meaningful support/resistance.

The safest default interpretation is:

> **Select the first meaningful opposing liquidity or structure that price is likely to encounter; calculate the actual RR from that target; do not force an extreme RR target beyond the next structural obstacle.**

The second video’s live example uses a next key level or gap fill. Account-based risk sizing and daily risk guardrails are not part of the paper-signal strategy. Signal qualification remains governed by the structural stop, target, freshness, spread, correlation, news, and minimum-RR rules.

## Risk, session, news, and correlation gates

| Gate | Video-derived rule |
|---|---|
| **Session** | Trade only London and New York; do not trade Asian session. |
| **News** | The first video’s on-screen software guardrail blocks high-impact news 15 minutes before and 15 minutes after the event. The event source and missing-data behavior are not specified. |
| **Correlation** | Gold BUY requires Silver to support BUY; Gold SELL requires Silver to support SELL. Opposite Silver direction invalidates the setup. |
| **Risk/reward** | The videos show approximately 1:2 or better as the minimum acceptable condition; examples naturally produce around 1:3 but the first logical target takes priority. |
| **Risk sizing** | Paper signals do not require account equity or position-size calculation. The strategy’s stop, target, spread, freshness, and RR rules remain mandatory. |
| **Daily controls** | No daily loss cap, daily profit cap, or maximum trade count is imposed on paper signals. |

## No-trade conditions

The XAU/USD channel must return WAIT or NO TRADE when any of the following applies:

| Condition | Result |
|---|---|
| 1H and 15M directions conflict | WAIT |
| Higher-timeframe bias is unclear or range location is not meaningful | WAIT |
| Price is in the middle of nowhere or the middle of the active range | WAIT |
| Price has not reached a valid POI | WAIT |
| No required liquidity sweep occurred | WAIT |
| Sweep occurred but there is no rejection or directional reaction | WAIT |
| No approved confirmation model has completed | WAIT |
| Price is still in an aggressive momentum leg and no pullback exists | WAIT; do not chase |
| Retracement entry has not occurred | WAIT |
| Gold and Silver disagree | NO TRADE |
| Outside London/New York session | NO TRADE |
| High-impact-news block is active | NO TRADE |
| No clear structural invalidation point | NO TRADE |
| Logical target is too close or RR fails the approved minimum | NO TRADE |
| Required data is stale or unavailable | WAIT; do not infer missing evidence |

## Proposed XAU/USD channel output

Every cycle should produce an auditable channel result even when no signal is emitted:

```text
Asset: XAU/USD
Channel: XAU_VIDEO_STRATEGY
Decision: WAITING | QUALIFIED
Bias: BUY | SELL | NEUTRAL
Session: LONDON | NEW_YORK | OUT_OF_SESSION
HTF structure: ...
1H/15M alignment: PASS | FAIL
POI: ...
Liquidity target: ...
Liquidity sweep: PASS | FAIL
Reaction/rejection: PASS | FAIL
Displacement/market shift: PASS | FAIL
Entry model: A | B | C | NONE
Retracement: PASS | FAIL
XAG correlation: PASS | FAIL | UNKNOWN
Entry: ...
Stop: ...
Target: ...
Actual RR: ...
News gate: PASS | BLOCKED | UNKNOWN
Strategy reasons: ...
Unresolved requirements: ...
```

Only a **QUALIFIED** result with complete executable levels and all mandatory gates passed may proceed to the XAU/USD Entry Locator. The Entry Locator should verify freshness, entry validity, duplicate identity, and emission readiness; it must not add a different XAU strategy or override a channel WAIT.

## Exactness limitations requiring approval

The videos do not mechanically define the following items: the exact swing algorithm, the minimum sweep distance, the precise meaning of strong displacement, the candle definition for Model C, the precise session boundaries, the news source and timing tolerance, the XAG/USD confirmation algorithm, the volatility/spread buffer, the exact minimum RR, the priority among several simultaneous POIs, and whether 1M refinement is enabled. Account-based risk sizing and daily guardrails are intentionally excluded from paper-signal qualification.

The most important architecture decision is whether **all of Daily/4H, 1H, and 15M alignment is mandatory** for the primary trend channel or whether Daily/4H supplies broad context while the explicit 1H/15M alignment rule controls execution. The specification above uses the stricter intersection but labels it for approval because it will materially reduce signal frequency.

## Final status

This is the new proposed XAU/USD strategy for v5 based on the supplied videos. It is intentionally not coded yet. The old strategy should not be removed from production until the unresolved definitions are approved, the mechanical rulebook is implemented, and the channel is validated in shadow mode.


## Locked clarifications supplied after the initial specification

The following values are now locked for the XAU/USD video-derived channel:

| Area | Locked rule |
|---|---|
| Silver confirmation | XAG/USD must have the same directional bias as XAU/USD. A corresponding XAG sweep/structure event within five minutes is optional and adds one confluence point. Opposite, stale, or unavailable XAG data produces WAIT. |
| Target selection | Identify meaningful opposing levels, sort nearest to farthest, determine genuine obstacles, calculate RR to each, and select the first valid target offering at least 1:2. A farther target may be selected only after accounting for nearer obstacles. If no valid target offers 1:2, return WAIT. |
| TP buffer | `max(0.05 × ATR(14), 2 × live spread, 1 tick)`. SELL TP is target minus buffer; BUY TP is target plus buffer. No live spread means WAIT. |
| News source and behavior | Use Trading Economics as the single production source. Normal HIGH events block 15 minutes before through 15 minutes after. FOMC decisions, CPI, NFP, major Fed decisions/speeches, and similarly extreme USD events block 30 minutes before through 30 minutes after. Unavailable or stale news data produces WAIT. |
| Position sizing | No account-based position sizing is used for paper signals. Missing account equity does not block a paper signal and no position size is fabricated. |
| Data freshness | XAU quote preferred ≤5 seconds, hard maximum 15 seconds; XAG quote preferred ≤15 seconds, hard maximum 30 seconds; latest completed 5M OHLC no more than one candle behind; 1M OHLC preferred ≤15 seconds, hard maximum 30 seconds; news preferred ≤30 seconds, hard maximum 60 seconds; live spread is mandatory. Failure of any required limit produces WAIT. |

The remaining implementation dependency is not a strategy choice: the production data path must provide live XAU/XAG quotes, live spread, 1M data, and Trading Economics news timestamps with these freshness guarantees. If the provider path cannot supply them, the channel must remain WAITING rather than downgrade to stale OHLC or synthetic spread data.
