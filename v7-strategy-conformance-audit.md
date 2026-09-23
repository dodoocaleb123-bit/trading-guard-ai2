# V7 Intelligence Strategy-Conformance Audit

**Audit date:** 2026-09-23  
**Repository:** `dodoocaleb123-bit/trading-guard-ai2`  
**GitHub main checked:** `786ebec56f1d6035a714b6581982657d89e65c9b`

## Executive conclusion

The deployed code contains the v7 four-channel architecture, hard minimum 1:2 risk/reward enforcement, freshness validation, live-quote/spread fields, XAG/USD confirmation plumbing, additive non-blocking news observations, and a separate post-release NEWS-EVENT path. However, the current channel evaluator is still a **simplified structural adapter**, not an exact mechanical implementation of every rule in the four attached PDF rulebooks. It would be inaccurate to confirm full rule-for-rule compliance at this point.

The requested news exception is respected: the PDF rule that high-impact news blocks ordinary channel signals is not applied. Ordinary channel signals use the additive-only news policy. BTC/USD remains outside the news-event path.

## Rule comparison

| Channel | Implemented correctly | Material gaps or deviations |
|---|---|---|
| **XAU/USD** | Requires higher-timeframe data, 1H/15M/5M structure, XAG direction/freshness, sweep/BOS/retracement evidence, structural stop logic, and final RR >= 1:2. | The PDF defines 5M as the primary execution/confirmation timeframe, but the current plan geometry is built from 15M for XAU. The evaluator uses generic six-candle directional structure and generic sweep/BOS logic rather than explicit POI, protected sweep wick, rejection model, displacement model, FVG/order-block selection, and nearest opposing structural target. It requires all 1W/1D/4H/1H directions to agree, which is stricter than the PDF's Daily-or-4H context plus supportive 1H/15M interpretation. Session handling is the common 08:00–17:00 UTC window rather than a distinct London/New York session detector. |
| **BTC/USD** | Enforces 15M as the native signal timeframe, includes 1W/1D/4H/1H/15M context, requires 5M data only as part of the current shared evaluator, applies sweep/BOS/retracement geometry, and enforces final RR >= 1:2. No BTC news path is used. | The PDF says 5M may refine a valid 15M setup but cannot create one; the current evaluator requires 5M directional agreement, so 5M is effectively mandatory. The code does not explicitly model the 1H activation-level break, discount/premium 0–25/75–100% location, dead-zone/order-block qualification, optional 50% Fib logic, nearest-target-versus-farther-target rule, weekly target contradiction check, or the documented 15M continuation condition for break-even management. |
| **EUR/USD** | Uses the 1W/1D/4H/1H/15M hierarchy, structural direction, sweep/BOS/retracement sequence, structural levels, and hard RR >= 1:2. Account-based sizing and daily caps are not used as paper-signal gates. | Premium/discount is represented only as a label/reason string; there is no actual mandatory range-location calculation. The evaluator uses generic direction/sweep logic instead of explicit 15M CHoCH/BOS after a meaningful location and protected-swing retracement. It also requires 5M directional data through the shared evaluator even though the EUR document makes 15M the native signal timeframe and does not make 5M a required signal creator. Daily floor pivot and optional confluence are not mechanically represented. |
| **GBP/USD** | Uses Daily/4H/1H/15M/5M data, makes 5M the native execution timeframe, requires sweep/BOS/retracement geometry, uses structural stops, and enforces hard RR >= 1:2. Account sizing and daily caps are not used. | The PDF's mandatory sequence requires a new 5M imbalance/order-block zone and a deep corrective retracement into that new zone. The current code uses a generic midpoint retracement and does not identify or persist the newly created imbalance/order-block zone. It does not explicitly distinguish Asia/London/previous-day liquidity, corrective versus opposing impulse, or protected retracement invalidation. It also requires weekly directional agreement even though the PDF treats 1W as broad context that does not independently create a signal. |

## News behavior

The ordinary channel path is additive-only: the attached PDFs' high-impact-news blocking rule was intentionally excluded as instructed. The code still contains a separate non-BTC news observation path and a confirmed NEWS-EVENT candidate path. Ordinary channel qualification is not supposed to be rejected merely because an event is approaching or has released.

The NEWS-EVENT path requires a high-impact event with an actual value, recent event time, fresh data, and subsequent price-action confirmation before creating a confirmed event signal. It does not use the headline alone to determine direction. BTC/USD is excluded.

## Production checks completed

- GitHub `main` points to `786ebec56f1d6035a714b6581982657d89e65c9b`.
- `https://trading-guard-ai2.onrender.com/healthz` returned HTTP 200 with `{"ok":true,"service":"trading-guard-ai"}`.
- The public Render frontend returned HTTP 200.
- Local TypeScript validation passed.
- Deterministic validation passed: **79 test files / 304 tests**.
- Production build passed.

## Production scanner-cycle limitation

A fresh production scanner cycle could not be independently triggered during this audit. Render's free compute plan does not provide Shell access, and the authenticated cron console was not available for an actionable run control in this session. Therefore, no claim is made that a new cycle was observed after this audit. The existing external trigger remains configured to acknowledge within the 30-second cron limit, but a fresh v7 Monitoring/Telegram cycle still needs to be run from the user's cron-job.org account or another authorized trigger interface.

## Recommended implementation correction

Before claiming exact PDF compliance, replace the generic `sweepAndBos`/`choosePlan` adapter with four strategy-specific evaluators that explicitly model each document's POI, liquidity, confirmation, retracement, structural invalidation, target priority, and optional-confluence rules. The news-block clauses should remain disabled for ordinary signals, as requested. After that correction, run a shadow comparison and a production scanner cycle before treating the v7 channels as fully conformant.

**No code changes were made during this audit.**

## Sources reviewed

The four PDFs supplied in this task: XAU/USD, BTC/USD, EUR/USD, and GBP/USD video-derived strategy documents, together with `server/v7-channels.ts`, `server/v7-intelligence.ts`, scanner integration code, tests, and the live Render health endpoint.
