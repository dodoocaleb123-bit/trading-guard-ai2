# Bounded production audit findings — 2026-09-03

The authenticated production Monitoring dashboard rendered successfully. It showed 282 received external-trigger cycles, 282 completed, 0 failed, 27 provider-unavailable cycles in the rolling window, an average interval of 5.1 minutes, 171 duplicates suppressed, 24/24 complete v5 payloads in the smoke check, 48 active zones, and no pending replacement chains. The latest affected cycle was a Twelve Data 15-minute abort; recent cycles otherwise showed normal cadence and complete v5 persistence.

The persistent zone inventory displayed EUR/USD, XAU/USD, GBP/USD, and BTC/USD across 4H, 1H, 15M, and 5M. Monitoring explicitly keeps 1H as context and 15M/5M as execution. Tracking and Telegram ledger queries from the bounded audit showed resolved outcomes and delivery records consistent with the current dedupe and outcome-recovery rules.

White AI’s authenticated live route rendered the dedicated APP-AWARE CONVERSATIONS interface and returned app-aware educational/signal-explanation content without a trade-action mutation. Cherry AI exposed the dedicated INDEPENDENT TRADE REVIEW interface, but its composer routed an educational question through the legacy audit mutation and returned TRADE APPROVED. This was a confirmed client routing defect.

Fix applied in checkpoint c6628a14: Cherry AI now uses the audit mutation only for BUY/SELL plus an explicit Entry, Stop Loss, Take Profit, TP, or SL price field. Informational Cherry prompts use the guarded conversation channel. Client regression tests cover complete trade setup versus educational and zone questions. Deterministic tests excluding known live Gemini quota tests, TypeScript, and production build passed. The checkpoint was pushed to dodoocaleb123-bit/trading-guard-ai2 main for Render deployment; post-deployment Cherry verification remains required.

External limitation: two live Gemini provider tests returned HTTP 429/free-tier quota exhaustion. This is recorded as a provider limitation, not an application assertion failure.
