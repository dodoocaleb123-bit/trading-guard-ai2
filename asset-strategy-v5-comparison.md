# Asset-Specific Strategy Review for the v5 Engine

## Purpose and scope

This review analyzes the four uploaded strategy documents for XAU/USD, GBP/USD, EUR/USD, and BTC/USD. It compares their stated rules with the current v5 implementation and proposes an asset-aware integration design. **No application code, database schema, scanner behavior, signal policy, or production configuration was changed.**

The central design constraint remains that **v5 must remain the sole decision maker for signal approval**. The asset documents should therefore become structured evidence and asset-specific rules inside the v5 hierarchy, not four independent signal generators.

## Executive comparison

| Asset | Higher-timeframe context | Setup/map timeframe | Execution timeframe | Distinctive evidence | Document threshold emphasis |
|---|---|---|---|---|---|
| XAU/USD | 4H → 1H | 15M POI, liquidity | 5M | Liquidity sweep, displacement, BOS/CHoCH, retracement; volatility-aware SL; multiple targets | Minimum approximately 1:2; avoid abnormal news/volatility |
| GBP/USD | 1H, with 4H-compatible context | 15M levels and London/Asian range | 5M; 1M optional precision only | Session liquidity, deep retracement, BOS, retest, imbalance/order block | 10/16 minimum; 1:2 minimum; do not chase |
| EUR/USD | 1D/4H, with 1H/15M levels | 15M setup confirmation | 5M | Previous day/week levels, pivots, S/R, liquidity sweep, rejection, BOS, retest, news filter | Score ≥7/10; confluence ≥75%; confidence ≥70%; RR ≥1:2 |
| BTC/USD | Weekly → Daily → 4H → 1H | 15M structure and trigger | 15M; 5M optional refinement | Weekly/Daily bias, 1H structural event, 15M HL/LH plus BOS/retest | Score ≥8/10; realistic RR ≥1:2; WAIT is normal |

The documents agree on the main sequence: **location → liquidity/structure event → confirmation → retracement or retest → entry → structural invalidation → realistic opposing target → risk filter**. They disagree mainly on how much higher-timeframe context, session information, and scoring should be used for each asset.

## What the current v5 already does

The current hierarchy evaluator already detects displacement and structural supply/demand zones, retains persistent historical zones, determines a dominant 4H direction, reads 1H context, selects 15M/5M confirmation, and rejects setups without an active zone, a suitable opposing zone, or 30-pip clearance. Its only qualifying confirmation types are rejection, engulfing, and CHoCH. It derives the stop from structural invalidation with a volatility buffer and targets the next opposing zone. It then requires directionally valid geometry before a setup can become **QUALIFIED**.

The production scanner evaluates the four assets across 15MIN and 5MIN signal timeframes, while 1H and 4H are context. It passes the hierarchical result to the Entry Locator, which performs freshness, confidence/confluence, evidence-family, duplicate, and emission checks. Telegram delivery, tracking, contradiction replacements, and duplicate suppression occur only after those decisions.

That means the documents largely reinforce the existing architecture rather than replacing it. The main gaps are that some document concepts are not yet explicit or asset-specific: liquidity sweeps, displacement strength, deep retracement/retest state, London/session ranges, previous-day/week levels, pivots, BTC Weekly/Daily context, and asset-specific scorecards.

## Asset-by-asset interpretation

### XAU/USD

The XAU document is the closest match to the existing v5 direction. It requires 4H and 1H bias, a 15M point of interest, a buy-side or sell-side liquidity sweep, 5M rejection/displacement and structure break, then a retracement entry. The stop belongs beyond the sweep or invalidation structure, with an ATR or recent-range buffer. The target should be meaningful opposing liquidity rather than an artificially distant fixed-RR target.

The important addition for gold would be an explicit **liquidity-event state** and a distinction between a simple zone touch and a confirmed sweep followed by displacement. The document’s three-target model should not automatically create three Telegram signals; it is better represented first as TP1/TP2/TP3 internal planning, with the existing v5 policy deciding whether one approved target or a separate approved setup is emitted.

### GBP/USD

The GBP document emphasizes a 1H directional bias, 15M liquidity and London/Asian range mapping, and 5M displacement, BOS, deep retracement, and retest. Its optional 1M precision entry conflicts with the current production rule that live signals are only 15MIN or 5MIN. It should therefore remain an optional future refinement, not part of the initial integration.

GBP’s useful asset-specific layer is the **session liquidity map**. London/Asian times must be timezone- and daylight-saving-aware; the document explicitly warns against hardcoding video clock times. A session range should be treated as contextual liquidity evidence, never as a reason to override protected 4H structure. The 16-point score can be used as a GBP quality checklist, but its confidence bands should not be copied directly into the shared probabilistic-looking confidence field.

### EUR/USD

The EUR document combines 1D/4H structural context with previous day/week highs and lows, pivots, range boundaries, 15M levels, and a 5M sweep/rejection/BOS/retest sequence. It also gives the clearest hard filters: no middle-of-range entries, no major-news entries, no clear invalidation, no poor RR, and no near-tied directional score.

The most useful integration is an **EUR level confluence map** containing previous day/week levels, pivots, and calculated supply/demand. These should strengthen or weaken v5 evidence families, but duplicated reasons must be capped so one level is not counted as several independent confirmations. The document’s suggested minimum confidence of 70% and confluence of 75% are stricter than the current shared Entry Locator minimums of 60% and 45%; adopting them would be a product-policy change requiring explicit approval and historical validation.

### BTC/USD

BTC is materially different. The document adds Weekly and Daily context, uses 4H as intermediate structure, 1H as the actual structural setup, and 15M as the trigger. It explicitly allows a 5M chart only as optional refinement. It also requires the strongest score threshold of the four documents and expects WAIT to be common.

The biggest architectural question is data availability. The current scanner’s production market-data window is 5M, 15M, 1H, and 4H. A faithful BTC implementation would require Weekly and Daily data retrieval, persistence, freshness rules, and monitoring. Until that is approved and implemented, the safe interpretation is to use the existing 4H/1H/15M hierarchy and label the BTC Weekly/Daily rules as **unavailable context**, never silently fabricate them.

## Proposed integration architecture

### 1. Add an asset strategy profile inside v5

Create one declarative profile per asset containing the required context timeframes, preferred setup evidence, session or level maps, minimum score, minimum RR, and optional news/volatility restrictions. The profile must be consumed by the v5 hierarchy evaluator before it returns QUALIFIED or WAITING.

The profile must not call Telegram, create signals, bypass persistent zones, or replace the 4H protected-swing rule. It should only add structured evidence to the hierarchy decision and explain why a setup is waiting.

### 2. Preserve the common v5 decision order

For every asset, the proposed order is:

1. Confirm complete and fresh market data.
2. Update and reconcile persistent zones without deleting historical memory.
3. Establish higher-timeframe bias and protected-structure state.
4. Locate the current price relative to active zones and asset-specific levels.
5. Detect liquidity sweep, rejection, displacement, BOS/CHoCH, and retest state where available.
6. Select the 15M or 5M execution candidate; keep 1H and 4H contextual.
7. Derive entry, stop, and target from structure and opposing liquidity.
8. Apply common geometry, clearance, volatility, and news safeguards.
9. Apply the asset profile’s score and evidence requirements.
10. Return QUALIFIED or WAITING with a complete auditable payload.
11. Let Entry Locator perform its existing final emission gate.
12. Apply duplicate, contradiction-chain, tracking, and Telegram rules unchanged.

### 3. Use a strictest-common-risk policy initially

The documents all support structural stops, realistic opposing targets, and approximately 1:2 minimum RR. The safest initial common policy is therefore to retain the current v5 geometry validation and reject targets that are unrealistic, too close, too far, directionally wrong, or based on an extreme ratio. Asset profiles may add stricter filters, but they should not weaken the current safeguards without backtesting.

### 4. Separate evidence from confidence

A document score is a **setup-quality score**, not a probability of winning. The proposed payload should separately store:

| Field | Meaning |
|---|---|
| `assetProfileScore` | How many asset-specific rules passed |
| `assetProfileMaxScore` | Maximum possible profile points |
| `confluence` | Count of independent evidence families after caps |
| `confidence` | Existing v5/Entry Locator quality measure |
| `statisticalValidation` | Reserved for future backtested results, not inferred from the documents |

This prevents a GBP 14/16 or BTC 9/10 score from being misleadingly displayed as a guaranteed 90% win probability.

## Conflicts that need approval before implementation

| Decision | Why approval is needed | Recommended default |
|---|---|---|
| Add BTC Weekly/Daily retrieval | Expands provider calls, persistence, freshness rules, and Monitoring | Do not add until data budget and exact stale-data policy are approved |
| Use London/Asian session ranges for GBP | Requires timezone and daylight-saving definitions | Add as contextual evidence only; never a standalone trigger |
| Add previous-day/week and pivot levels for EUR | Requires deterministic calculation and evidence-family caps | Add as level-map evidence, not separate independent votes |
| Require explicit sweep + displacement + BOS + retest for all assets | More faithful to documents but will reduce signal frequency | Make asset-specific, with WAIT when incomplete |
| Introduce per-asset score thresholds | Thresholds differ across documents | Start in shadow-monitoring mode before emission impact |
| Add multi-target management for XAU | Could affect tracking and Telegram semantics | Store internal targets first; emit only under existing signal policy |
| Enable GBP 1M precision | Violates current 15M/5M live-signal policy | Keep out of initial release |
| Tighten EUR confidence/confluence gates | Would change current emission frequency | Validate on historical data and shadow cycles first |

## Recommended next step

The documents support an **asset-aware v5 evidence layer**, not four separate engines. The safest implementation sequence is: first encode the four profiles in shadow mode; then persist profile evidence in the v5 hierarchy payload; then compare qualified-versus-waiting outcomes and actual-ratio distributions; and only after review enable any profile-specific hard filters. This preserves v5 as the single authority, prevents the Entry Locator from becoming a second strategy engine, and avoids changing Telegram behavior before the new rules have been observed.

## References

[1] `XAUUSDstrategy.pdf`, “XAU/USD 5-Minute Gold Scalping Strategy,” uploaded by the user.

[2] `GBPUSD.pdf`, “GBPUSD — The Strategy I Would Build From the Videos,” uploaded by the user.

[3] `EURUSD.pdf`, “EURUSD 5M — Liquidity Sweep + Structure + Pivot/S&R Strategy,” uploaded by the user.

[4] `BTCUSDTradingStrategy.pdf`, “BTC/USD Institutional-Style Trading Plan,” uploaded by the user.
