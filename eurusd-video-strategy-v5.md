# EUR/USD Video-Derived v5 Strategy

## Status

This document consolidates the three uploaded EUR/USD strategy videos and the user-approved decisions. It is a strategy specification only. No application code, scanner behavior, database schema, provider configuration, or Telegram workflow has been changed.

The attached decision table proposed a two-loss daily stop and a maximum of three qualified trades per day. The user subsequently gave a direct instruction that EUR/USD, like BTC/USD, must have **no daily trade-count limit and no daily loss cap**. That direct instruction is the governing rule for this specification.

## Core principle

The EUR/USD channel must trade from meaningful higher-timeframe location after a liquidity event, directional confirmation, and a 15M retracement. A pivot touch, moving-average signal, candlestick pattern, indicator reading, or apparent breakout cannot generate a signal alone.

> **1W → 1D → 4H → 1H → 15M context and execution hierarchy.**

The mandatory primary engine is:

> **Liquidity sweep → premium/discount location → 15M CHoCH/BOS → retracement → confirmation entry.**

## Timeframe responsibilities

| Timeframe | Responsibility |
|---|---|
| 1W | Establish macro structure and broad directional environment. |
| 1D | Confirm macro momentum, major swings, daily levels, and daily floor-pivot context. |
| 4H | Establish trade bias, meaningful supply/demand, swing structure, liquidity, and major zones. |
| 1H | Refine the active setup, trend, liquidity pools, and structural levels. |
| 15M | Native signal and execution timeframe. It confirms CHoCH/BOS, retracement, entry, stop, and target. |

## Directional bias

Structure determines the primary bias. Bullish structure is higher highs and higher lows; bearish structure is lower lows and lower highs; unclear or heavily conflicting structure is neutral and produces WAIT.

The 200 moving average is **confluence only**. It may increase or decrease the score, but it can never override clear 1W, 1D, 4H, or 1H structure. The 20 and 50 moving averages are also optional confluence and are not mandatory for a valid signal.

A genuine opposite-direction reversal requires a meaningful structural shift, not merely a temporary countertrend candle. The channel must not label a reversal from an isolated wick or minor internal fluctuation.

## Valid locations and zones

The channel may identify supply and demand from consolidation and displacement areas, higher-timeframe swing support and resistance, liquidity pools, and daily floor pivots.

Daily floor pivots are an **optional support/resistance source** calculated from the daily interval. A pivot becomes stronger when it overlaps with a higher-timeframe swing, supply/demand, liquidity, or the correct premium/discount region. Price touching a pivot alone is never an entry condition.

For an impulse leg, the channel uses the 0 and 1 boundaries and the 0.5 midpoint. BUY locations prefer discount below 0.5; SELL locations prefer premium above 0.5. Premium/discount is a mandatory location filter for the primary engine.

## Liquidity rules

Liquidity consists of meaningful highs and lows of smaller pullbacks inside a larger impulse or range. A weak high or low that has not previously achieved a meaningful sweep is more likely to be targeted. A strong high or low that previously swept liquidity and reversed is treated as more protected.

A valid setup requires a meaningful liquidity sweep or equivalent stop-run event in the intended location. The channel must then wait for price to react and confirm direction. It must not assume that every breakout is genuine; the videos emphasize that apparent forex breakouts can be false moves designed to take liquidity.

## BUY workflow

A valid BUY requires the following sequence:

1. The 1W, 1D, 4H, and 1H structure is bullish or a clearly confirmed reversal is underway.
2. Price reaches a meaningful demand, support, liquidity, or discount location. A daily pivot may strengthen the location but cannot qualify it by itself.
3. Price performs a meaningful sell-side liquidity sweep or false-break reaction in that location.
4. The 15M chart confirms a bullish CHoCH or BOS by breaking the relevant recent fractal high with a candle close.
5. Price retraces into the confirmed structure, demand, liquidity-reaction area, or discount region.
6. The retracement does not invalidate the protected bullish swing.
7. The channel places the stop beyond structural invalidation with a volatility/spread buffer.
8. The first meaningful opposing liquidity or zone is evaluated as the target. A farther target is allowed only when it provides a credible path and the nearer obstacle is handled.
9. The plan must provide a final RR of at least 1:2.
10. The candidate passes shared v5 safety and Entry Locator gates before any Telegram delivery.

## SELL workflow

A valid SELL follows the reverse sequence:

1. The 1W, 1D, 4H, and 1H structure is bearish or a clearly confirmed reversal is underway.
2. Price reaches meaningful supply, resistance, liquidity, or premium location.
3. Price performs a meaningful buy-side liquidity sweep or false-break reaction in that location.
4. The 15M chart confirms a bearish CHoCH or BOS by breaking the relevant recent fractal low with a candle close.
5. Price retraces into the confirmed structure, supply, liquidity-reaction area, or premium region.
6. The retracement does not invalidate the protected bearish swing.
7. The stop is placed beyond structural invalidation with a volatility/spread buffer.
8. The nearest meaningful opposing liquidity or zone is evaluated first, with a farther target allowed only when structurally credible.
9. The final RR must be at least 1:2.
10. The candidate passes shared v5 safety and Entry Locator gates before delivery.

## Optional confluence

The following evidence may improve the score but can never create a signal independently or override clear structure:

| Optional evidence | Rule |
|---|---|
| 200 MA | Supports or weakens directional alignment; never overrides structure. |
| 20/50 MA break | Adds confirmation when present; not mandatory. |
| Engulfing candle | Bullish or bearish engulfing near a valid zone adds confluence; it is not mandatory. |
| Stochastic RSI | Use 14/14/3/3; above 80 is overbought and below 20 is oversold. It confirms location/momentum only. |
| Daily floor pivot | Strengthens a location when overlapping with independent structure or liquidity. |
| Gartley/harmonic pattern | Optional pattern evidence. |
| Wyckoff pattern | Optional pattern evidence, including a spring or upthrust when it agrees with the core engine. |
| Gap/imbalance | A nearby gap may warn that price could fill it before reversing; it cannot create a trade. |

## Entry model

The default live entry is a **confirmation entry** after the liquidity sweep, 15M CHoCH/BOS, and retracement. There is no blind limit order at the extreme liquidity point.

The risk-entry model from the first video may be recorded separately for historical research or backtesting, but it is disabled for standard live or Telegram signals. Scaling-in is also disabled initially; one qualified setup produces one signal. It may be tested later as a separate strategy rather than mixed into the core channel.

## Stop loss

The stop must be beyond the structural invalidation point: below the protected strong swing for a BUY and above it for a SELL. A volatility and spread buffer must be added. The channel must never use a fixed approximately 9-pip stop merely to manufacture a desired RR.

The exact numerical buffer still needs to be defined before implementation, but the governing rule is fixed: the stop must represent genuine invalidation and allow the position room to develop.

## Target and risk/reward

The first meaningful opposing liquidity or zone is the primary target. If that nearer target cannot provide 1:2, a farther target may be considered only when price has a credible structural path to it and the nearer obstacle is not ignored. If no structurally realistic target provides 1:2, the channel returns WAIT.

The hard minimum final RR is 1:2. The videos’ 1:1.5 preference and example-specific ratios do not override this approved rule.

## Risk and signal frequency

Paper signals do not require account equity or position-size calculation. No account-based risk-sizing percentage is imposed by the EUR/USD strategy. There is **no daily trade-count limit, no daily loss cap, and no automatic stop after a fixed number of consecutive losses**. The v5 may emit any number of EUR/USD signals when each setup independently qualifies.

Removing global caps does not remove quality controls. Every signal must independently pass the complete strategy, minimum RR, valid structural levels, open-trade state rules, duplicate suppression, contradiction-chain rules, data validity, Entry Locator, and Telegram safety controls.

## Sessions and news

European/London and New York sessions are preferred but not mandatory. EUR/USD is not automatically blocked outside those sessions.

Major scheduled EUR/USD news produces WAIT for new entries. The implementation should use a validated economic calendar and block approximately 15 minutes before through 15 minutes after high-impact releases. Exceptionally volatile events such as CPI, NFP, FOMC, or ECB decisions should use approximately 30 minutes before through 30 minutes after. If the calendar is unavailable or stale, the channel must not assume that the news risk is absent.

## Mandatory versus optional rules

| Mandatory | Optional |
|---|---|
| 1W → 1D → 4H → 1H → 15M context | 200 MA |
| Structure-based directional bias | 20/50 MA break |
| Meaningful supply/demand, support/resistance, or liquidity location | Engulfing candle |
| Premium/discount location | Stochastic RSI |
| Liquidity sweep or valid false-break reaction | Daily floor pivot |
| 15M CHoCH/BOS | Gartley/harmonic pattern |
| Retracement before entry | Wyckoff pattern |
| Structural stop with buffer | Gap/imbalance warning |
| Realistic opposing target | London/New York timing preference |
| Final RR ≥ 1:2 | Risk-entry model in backtesting only |
| News validity | Scaling-in in later research only |

## WAIT and NO-TRADE conditions

The channel must return WAIT when higher-timeframe structure is unclear or materially conflicting; price is in the middle of a range or has no meaningful location; a liquidity sweep has not occurred; price has not reached the correct premium/discount region; 15M CHoCH/BOS has not been confirmed; the retracement has not occurred; the initial breakout is being chased; the stop lacks genuine structural invalidation; the nearest credible target prevents 1:2; the target contradicts major structure; high-impact news is inside the blocking window; required market or calendar data is stale or unavailable; or the individual setup exceeds its allowed risk.

The channel must not fabricate liquidity, pivots, patterns, news clearance, spread, confidence, or zones. Every WAIT result should record its exact reason in the v5 decision payload.

## Shared v5 boundary

The EUR/USD channel owns this asset-specific strategy judgment. Shared v5 infrastructure remains responsible for persistence, decision evidence, atomic duplicate prevention, contradiction-chain rules, Telegram delivery, tracking, outcome recovery, and Monitoring. Entry Locator remains a post-plan eligibility and execution-quality gate; it must not invent a second EUR/USD strategy or override the channel’s mandatory WAIT rules.

This specification is ready for a later shadow-mode implementation. No application code has been changed.
