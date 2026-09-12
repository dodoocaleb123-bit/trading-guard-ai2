# BTC/USD Video-Derived v5 Strategy

## Status

This document consolidates the three uploaded BTC/USD strategy videos and the user's approved decisions. It is a strategy specification only. The application code, scanner behavior, database schema, Telegram delivery, and live v5 workflow have not been changed.

## Core principle

The BTC/USD channel must trade only after higher-timeframe context, meaningful location, structural confirmation, and a retracement are present. It must never chase the initial breakout. The channel's native signal timeframe is 15M. A 5M chart may refine an already-valid 15M setup, but it can never create a signal independently.

> **1W → 1D → 4H → 1H → 15M context and execution hierarchy.**

## Timeframe responsibilities

| Timeframe | Responsibility |
|---|---|
| 1W | Establish the dominant macro structure and prevent targets that severely contradict the weekly direction. |
| 1D | Confirm the major directional environment and important daily levels. |
| 4H | Identify important repeated-reaction areas, dead zones, order blocks, major key levels, range boundaries, and intermediate structure. |
| 1H | Define the active setup, current trend, meaningful swing structure, and the level whose break activates lower-timeframe review. |
| 15M | Confirm the signal-producing structural break, pullback/retest, entry area, and executable trade plan. |
| 5M | Optional refinement only after a complete 15M setup exists; it cannot create or override a 15M signal. |

The channel must not add an 8H timeframe unless the platform later supports it and the strategy is explicitly revised.

## Directional bias

The channel classifies the weekly, daily, and 4H environment as bullish, bearish, or neutral. A bullish environment is characterized by higher highs and higher lows; a bearish environment by lower lows and lower highs; and a neutral environment by unclear or conflicting structure.

The 1H chart defines the active setup. The channel should place a conceptual alert at the level where the current 1H trend would break. Until that level breaks, the channel remains **WAITING — 1H STRUCTURE NOT ACTIVATED**. When the alert condition occurs, the channel evaluates the 15M chart for a directional structural break and retracement.

A lower-timeframe setup must not produce a target that severely contradicts the 1W direction. A genuine higher-timeframe conflict produces WAIT unless the approved reversal sequence has formed.

## Valid BTC location

The channel may use the following locations:

| Location type | Qualification |
|---|---|
| Dead zone/order block/major key level | Either 2–3 meaningful reactions or one exceptionally strong displacement origin. A fresh institutional-looking origin may qualify without historical touches. |
| Range | Defined by a meaningful swing high and swing low. The range is updated when a structural break creates a new boundary and price returns inside. |
| Discount zone | The lower 0–25% of the active range, preferred for BUY setups. |
| Premium zone | The upper 75–100% of the active range, preferred for SELL setups. |
| 50% level | Optional confluence only; it is never sufficient by itself. |
| Repeated support/resistance | A 4H area where price has reacted meaningfully two or three times, or where one exceptionally strong displacement originated. |
| Trendline or pattern boundary | Optional confluence when it has multiple valid touchpoints and agrees with the structural setup. |

Fib levels for the active range are 0, 0.25, 0.5, 0.75, and 1. A BUY should preferably originate in discount; a SELL should preferably originate in premium. A location by itself never generates a signal.

## BUY workflow

A valid BUY follows this sequence:

1. The 1W, 1D, and 4H context is bullish or has a clearly defined approved reversal structure.
2. The 4H/1H map identifies a valid demand, dead zone, order block, support, range low, or other meaningful location.
3. The 1H setup reaches or breaks the level whose activation permits 15M review.
4. The 15M chart forms a valid bullish structural break, preferably after a downside liquidity event or rejection of support. A simple initial breakout is not enough.
5. Price pulls back or retests the broken structure or valid demand/discount area. The first breakout candle must not be chased.
6. The retracement remains within a credible path and does not invalidate the structure.
7. The 15M setup has a structurally valid stop, a meaningful opposing target, and a final RR of at least 1:2.
8. Optional confluence may include the 50% level, trendline/pattern agreement, repeated reactions, or a five-touch corrective pattern. None of these is mandatory if the core structure is valid.
9. A 5M observation may refine the exact entry only after all 15M requirements pass.
10. The channel produces a BUY candidate for the shared v5 safety and Entry Locator gates.

## SELL workflow

A valid SELL follows the reverse sequence:

1. The 1W, 1D, and 4H context is bearish or has a clearly defined approved reversal structure.
2. The 4H/1H map identifies a valid supply, dead zone, order block, resistance, range high, or other meaningful location.
3. The 1H setup reaches or breaks the level whose activation permits 15M review.
4. The 15M chart forms a valid bearish structural break, preferably after an upside liquidity event or rejection of resistance.
5. Price pulls back or retests the broken structure or valid supply/premium area. The initial breakdown must not be chased.
6. The retracement remains within a credible path and does not invalidate the structure.
7. The 15M setup has a structurally valid stop, a meaningful opposing target, and a final RR of at least 1:2.
8. Optional pattern and Fib confluence may strengthen the setup but cannot replace the core structure.
9. A 5M observation may refine the entry only after all 15M requirements pass.
10. The channel produces a SELL candidate for the shared v5 safety and Entry Locator gates.

## Structural confirmation

The mandatory confirmation is a meaningful 15M break of structure in the intended direction followed by a pullback or retest. A wick-only move, tiny internal fluctuation, or unconfirmed first breakout is insufficient.

Liquidity concepts from the videos may be used as supporting evidence, including previous swing highs and lows being cleared before continuation or reversal. Triangle and wave five-touch counts are optional confluence only and can never be a mandatory requirement when the structural setup is already valid.

## Stop loss

The stop is placed beyond the previous or protected structural swing that invalidates the trade: below the relevant swing low for a BUY and above the relevant swing high for a SELL. It must not be artificially tightened to manufacture a higher ratio.

The final implementation still needs a precise numerical safety buffer, such as an ATR or spread-based offset, before coding. The strategy rule itself is fixed: the stop must be structural and must represent genuine invalidation.

## Targets and risk/reward

The first target must be the nearest meaningful opposing liquidity or level. A farther target is allowed only if the nearer target cannot satisfy 1:2 and price has a credible path to the farther target without ignoring the nearer structural obstacle.

The final Telegram signal requires a hard minimum RR of 1:2. The 1:1 level from the first video may be used as an internal TP1/1R management milestone, but it is not a valid final signal target.

Targets must remain compatible with the weekly and higher-timeframe structure. A mathematical target that contradicts major opposing structure is not acceptable merely because it produces a larger ratio.

## Break-even management

After TP1/1R is reached, the channel may move the stop to break-even only when the 15M structure also confirms continuation. Touching 1R alone is insufficient. This prevents a temporary spike from moving the stop prematurely and removing the position before the expected move develops.

Paper signals do not require account equity or position-size calculation. The strategy does not impose an account-based risk-sizing percentage. There is no global daily-loss cap, no maximum number of BTC/USD signals per day, and no automatic stop after a fixed number of consecutive losses. The v5 may emit any number of BTC/USD signals when each setup independently qualifies. This does not bypass existing per-asset open-trade state rules, duplicate suppression, contradiction-chain rules, data-validity gates, or Telegram delivery safety controls.

## Sessions and news

London and New York sessions are preferred context windows but are not mandatory. BTC signals are not blocked solely because they occur outside those sessions.

Major scheduled events or material crypto-market news produce WAIT around the event. Before implementation, the specific news provider, event categories, and exact block window must be defined. The channel must not treat an unavailable news feed as proof that no risk exists.

## Mandatory versus optional rules

| Mandatory | Optional confluence or refinement |
|---|---|
| 1W → 1D → 4H → 1H → 15M hierarchy | 5M entry refinement |
| 15M native signal timeframe | 50% Fib reaction |
| Activated 1H setup | Triangle/wave five-touch pattern |
| Meaningful location | Trendline or pattern agreement |
| 15M structure break | Extra liquidity evidence |
| Pullback/retest after the break | 1:1 TP1 internal milestone |
| Structural stop | London/New York timing preference |
| Realistic opposing target | Fresh displacement origin without multiple touches |
| Final RR ≥ 1:2 | Approved reversal-specific confluence |
| Daily risk controls | — |

## WAIT conditions

The BTC/USD channel must return WAIT when higher-timeframe context is neutral or materially conflicting, the 1H activation level has not broken, no meaningful location exists, the 15M structure break has not occurred, the initial breakout has not retraced, the setup is in the middle of a range, the stop cannot be placed at genuine invalidation, the nearest credible target prevents a realistic 1:2, the target strongly contradicts the weekly structure, the individual trade cannot produce valid structural levels or satisfy the strategy’s execution requirements, or required data/news inputs are stale or unavailable.

The channel must never fabricate a zone, liquidity event, spread, news clearance, or confidence value. It must record the exact WAIT reason in the v5 decision payload. A high signal count is acceptable; an unqualified signal is not.

## v5 and Entry Locator boundary

This BTC/USD channel owns the asset-specific BTC strategy judgment. The shared v5 framework remains responsible for persistence, decision evidence, atomic duplicate prevention, contradiction-chain rules, Telegram delivery, tracking, and Monitoring. The Entry Locator remains an eligibility and execution-quality gate after the BTC channel has produced an approved strategy plan; it must not add a different BTC strategy or override the channel’s mandatory WAIT rules.

This specification is ready for a later shadow-mode implementation. No application code has been changed.
