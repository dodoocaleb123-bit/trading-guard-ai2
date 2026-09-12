# GBP/USD Video-Derived v5 Strategy

## Status

This specification consolidates the three uploaded GBP/USD strategy videos and the user-approved decisions. It is a design document only. No scanner logic, v5 code, database schema, provider configuration, Entry Locator, Telegram workflow, or tracking behavior has been changed.

## Core principle

The GBP/USD channel must trade from higher-timeframe direction and a meaningful point of interest after liquidity is taken and lower-timeframe structure confirms the reaction. It must not place a blind limit order at the original higher-timeframe point of interest and must not chase an impulsive breakout.

> **Higher-timeframe context → POI → liquidity sweep → 5M market shift/BOS → new imbalance or order-block zone → deep retracement → entry → structural invalidation → realistic opposing target.**

## Timeframe hierarchy

| Timeframe | Responsibility |
|---|---|
| 1W | Broad macro context when available; it does not independently create a signal. |
| 1D | Primary trend and broad directional bias. A meaningful Daily structural high or low must remain intact for the current narrative. |
| 4H | Map momentum, higher-timeframe supply/demand, and the active point of interest. |
| 1H | Confirm and refine actionable directional structure. |
| 15M | Primary setup and signal timeframe; map execution structure, liquidity, and retracement zones. |
| 5M | Execution refinement and the mandatory lower-timeframe market shift/BOS confirmation. It may refine but must not bypass the required setup sequence. |

## Directional bias

Daily and 4H structure establish the primary bias. The 1H chart confirms or refines that bias. A bullish narrative remains valid while the protected Daily/4H structure has not been meaningfully broken; a bearish narrative remains valid while its protected high or low remains intact.

The 89-day moving average and a currency-strength matrix are optional confluence. They may strengthen or weaken a score, but they can never override clear Daily, 4H, or 1H structure. DXY’s inverse correlation with GBP/USD is also optional confluence: falling DXY can support a GBP/USD BUY and rising DXY can support a GBP/USD SELL, but disagreement must not reject an otherwise clean GBP/USD setup by itself.

## Valid points of interest and liquidity

A valid POI may be higher-timeframe supply or demand, a meaningful support or resistance area, a prior displacement origin, or another structural zone supported by price action. The channel should not treat every minor line as a POI.

Liquidity may be found at the Asia High/Low, London High/Low, previous-day High/Low, equal highs or lows, consolidation extremes, and higher-timeframe swing liquidity. London High/Low is not mandatory. It receives higher priority when the setup occurs during the London session, but the channel may use another valid liquidity source.

The channel must not sell into a falling market or buy into a rising market merely because price is moving quickly. It should wait for price to reach a meaningful location and create the required reaction.

## Mandatory entry engine

The mandatory sequence for both directions is:

1. Daily and 4H structure establish the directional narrative.
2. 1H confirms or refines the actionable direction.
3. Price reaches a valid higher-timeframe POI.
4. Price sweeps meaningful liquidity at or around that POI.
5. A 5M market shift or BOS confirms the reaction.
6. The shift creates a new lower-timeframe imbalance or order-block demand/supply zone.
7. Price makes a deep but valid retracement into that new zone.
8. The channel checks that the retracement is corrective rather than a strong move against the intended direction.
9. Entry is taken from the new 5M imbalance/order-block zone, not blindly from the original higher-timeframe POI.
10. Structural stop, target, news, data, RR, and shared v5 gates are evaluated before emission.

## BUY workflow

For a BUY, the Daily/4H/1H context must be bullish or support a confirmed bullish reversal. Price must reach a valid demand or support POI and take sell-side liquidity such as the Asia Low, previous-day Low, consolidation low, or another meaningful low. The 5M chart must then close with a body beyond the meaningful bearish structure, confirming a bullish market shift/BOS. The resulting 5M imbalance or demand/order-block zone becomes the entry area. Price must retrace into it without invalidating the protected low, and the entry is taken only after that retracement.

## SELL workflow

For a SELL, the Daily/4H/1H context must be bearish or support a confirmed bearish reversal. Price must reach a valid supply or resistance POI and take buy-side liquidity such as the Asia High, previous-day High, consolidation high, or another meaningful high. The 5M chart must close with a body beyond the meaningful bullish structure, confirming a bearish market shift/BOS. The resulting 5M imbalance or supply/order-block zone becomes the entry area. Price must retrace into it without invalidating the protected high, and the entry is taken only after that retracement.

## BOS definition

A valid BOS requires a candle-body close beyond a meaningful structural swing or prior structure body. A wick through the level alone is not a BOS. Minor internal fluctuations do not qualify as the meaningful swing unless the channel’s defined swing algorithm confirms them.

## Retracement rule

The channel must not enter immediately after a new high, low, or impulsive displacement. It must wait for a deep retracement into the newly created imbalance or order-block zone. If the retracement never occurs, the channel returns WAIT and does not chase the move. If a massive impulse makes the original origin unlikely to be revisited, the channel may identify a closer valid entry zone created by the current structure, but it must not invent a zone merely to force an entry.

## Stop-loss rules

The stop is placed at structural invalidation with a small approved buffer. For a BUY, that is below the protected retracement low, demand zone, or structural low whose failure proves the thesis wrong. For a SELL, it is above the protected retracement high, supply zone, or structural high whose failure proves the thesis wrong.

The strategy must not use a universal fixed 10-pip stop. A stop is not moved closer to manufacture a desired risk/reward ratio, and it is not moved farther without a structural reason. Paper signals do not require account equity or position-size calculation.

## Target and risk/reward rules

Target selection is structure/liquidity first and fixed 1:3 second. The channel first evaluates the nearest meaningful opposing liquidity or structural level. It may choose a farther target only when the nearer target cannot provide acceptable RR and price has a credible path to the farther level without ignoring a major obstacle.

A 1:3 target is preferred when the chart genuinely supports it, but the channel must never force a 1:3 target through major structure merely to satisfy a number. The hard minimum final RR is **1:2**. A candidate that cannot provide 1:2 after structural target selection returns WAIT.

The video-derived default management is **set-and-forget**: no automatic break-even move and no partial profit-taking. The original structural stop and final target remain in place. Scaling, adding to losers, and pyramiding are disabled initially. One qualified setup produces one signal.

## Risk and signal frequency

For paper signals, there is no account-balance-dependent risk sizing, no daily trade-count limit, and no daily loss cap. GBP/USD may produce any number of independently qualified signals. These freedoms do not bypass structural qualification, minimum RR, open-trade state rules, duplicate suppression, contradiction-chain rules, data freshness, news gates, Entry Locator, or Telegram safety controls.

## Session and news rules

London is preferred but not mandatory. The channel may use London High/Low with higher priority during the London session, but the setup is not rejected solely because it occurs outside London.

Major GBP/USD news produces WAIT for new entries. The initial block is **15 minutes before through 15 minutes after** a high-impact release. After that block, the restriction extends when either the live spread is greater than **2× its pre-news baseline** or 5M ATR(14) is greater than **1.5× its pre-news baseline**. New entries resume only after both spread and ATR normalize for **two consecutive 5M candles**, with a maximum extension of 30 minutes. If abnormal conditions persist beyond that maximum extension, no automatic entry is permitted; the entire setup must re-qualify from the beginning. If the economic calendar is unavailable or stale, the channel must return WAIT rather than assume the news state is clear.

## Optional confluence

| Optional evidence | Effect |
|---|---|
| 89-day moving average | Supports or weakens the Daily narrative; never overrides structure. |
| Currency-strength matrix | Adds GBP/USD relative-strength evidence; never mandatory. |
| DXY inverse correlation | Strengthens a thesis when DXY behaves oppositely; cannot independently reject a clean setup. |
| London High/Low | Higher-priority liquidity during London; not a universal mandatory trigger. |
| Asia High/Low and previous-day High/Low | Valid liquidity sources when structurally meaningful. |
| 1W context | Broad background only; it does not independently create a signal. |

## WAIT and NO-TRADE conditions

The channel returns WAIT when the Daily/4H/1H narrative is unclear or materially conflicting, no valid POI exists, price is in the middle of nowhere or a range, no meaningful liquidity has been swept, the 5M body-close BOS has not occurred, the new imbalance/order-block zone has not formed, the deep retracement has not occurred, the market is moving with strong opposing momentum, the original entry zone is too distant after a massive impulse, the structural stop is unclear, the target cannot satisfy the approved minimum RR, or required market/news data is stale or unavailable.

It must not chase a breakout, enter a random limit at the higher-timeframe POI, treat a wick as BOS, use a fixed 10-pip stop, force a distant target, add to a losing position, or fabricate DXY, currency-strength, news, spread, or zone evidence.

## v5 boundary

The GBP/USD channel owns the asset-specific strategy judgment. Shared v5 infrastructure remains responsible for persistence, complete decision payloads, duplicate prevention, contradiction-thread rules, Telegram delivery, tracking, outcome recovery, and Monitoring. Entry Locator remains a post-plan eligibility and execution-quality gate; it must not create a second GBP/USD strategy or override a channel WAIT.

This specification is ready for later shadow-mode implementation. No application code has been changed.
