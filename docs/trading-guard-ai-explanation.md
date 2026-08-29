# Trading Guard AI: Application Overview and Operating Model

## 1. What Trading Guard AI is

Trading Guard AI is a **paper-trading forex analysis, signal-generation, monitoring, and explanation system**. Its purpose is to collect structured market information, interpret that information through the version 5 hierarchical trading engine, construct possible trade plans, apply execution safeguards, optionally send approved paper-only signals to Telegram, and record what happened afterward.

The app is not a broker, exchange, or order-execution platform. It does not place live trades, transfer money, manage a brokerage account, or guarantee profitable outcomes. A Telegram message represents an **UNVALIDATED paper signal** generated from the app’s available evidence. A user or trading group must independently assess the market and decide whether to act.

> The central design principle is separation of responsibilities: the scanner collects market data, v5 interprets the market structure, the Entry Locator applies the final signal gate, Telegram distributes an eligible paper signal, and the tracker records the outcome.

## 2. The nature of the application

The application combines four kinds of software in one command center:

| Capability | Role in the application |
|---|---|
| Market-data collector | Retrieves OHLCV candle data for the watched assets and timeframes. |
| Hierarchical trading engine | Uses multi-timeframe structure, zones, confirmations, target geometry, and risk rules to produce a judgment. |
| Paper-signal and monitoring system | Persists decisions, signals, Telegram delivery status, open-state locks, and WIN/LOSS/PENDING outcomes. |
| Explainable AI workspace | White AI explains the app and provides trading education; Cherry AI reviews proposed trade ideas independently. |

The app is designed for people who cannot watch the market continuously. Instead of requiring a trader to inspect every chart every five minutes, the system repeatedly collects snapshots and looks for a complete, structurally supported setup. When the evidence is incomplete or contradictory, the safer result is to wait rather than force a signal.

## 3. The assets and timeframes

The current watchlist contains four assets: **EUR/USD, XAU/USD, GBP/USD, and BTC/USD**. The hierarchy uses four timeframes, each with a different responsibility.

| Timeframe | V5 responsibility | Can it independently generate a Telegram trade signal? |
|---|---|---|
| 4H | Establishes higher-timeframe directional bias and major structural zones. | No; context only. |
| 1H | Supplies intermediate context, structure, and zone information. | No; context only. |
| 15M | Main execution timeframe and higher-priority signal timeframe. | Yes, when all gates pass. |
| 5M | Faster execution and confirmation timeframe. | Yes, when all gates pass. |

The 4H and 1H records are therefore not wasted data. They influence how v5 understands the market, identifies opposing areas, and decides whether a lower-timeframe setup agrees with or conflicts with the broader structure. However, the app does not send 1H Telegram trade signals under the current policy.

## 4. End-to-end workflow

### Step 1: The external scheduler starts a scanner cycle

The scanner is intended to run on a regular five-minute cadence controlled by the configured external scheduler. Each cycle is protected by a lease and run ledger. The lease prevents two callbacks for the same time bucket from processing the same work simultaneously, and it allows an orphaned `RUNNING` cycle to be reclaimed after the lease expires.

The run ledger records whether a cycle started, completed, failed, had usable market data, created signals, tracked outcomes, or was suppressed as a duplicate. This makes a quiet cycle distinguishable from a failed cycle.

### Step 2: The scanner retrieves raw OHLCV data

The scanner requests candle series from Twelve Data for the four watched assets and the required timeframes. The configured API keys are divided into asset pools so that EUR/USD and XAU/USD use one pool while GBP/USD and BTC/USD use another. Within each pool, keys rotate and fail over when a key is rate-limited, exhausted, or unavailable.

The scanner’s job is primarily collection and dispatch. It does not invent a chart screenshot, and it does not need a screenshot to understand a zone. It receives numerical candle data containing fields such as open, high, low, close, volume where available, and candle timestamps. These values are sufficient for the algorithms to derive swings, ranges, candle patterns, structure, and zones.

A complete hierarchy cycle requires the necessary 15M, 1H, and 4H series. The 5M series is used for the fast execution path when available. If required higher-timeframe data is incomplete or unavailable, v5 does not pretend that the hierarchy is complete; it records an unavailable or waiting state and fails closed instead of producing a misleading signal.

### Step 3: V5 derives market structure and zones

V5 analyzes the candle series across the hierarchy. Its structural vocabulary includes swing highs, swing lows, support and resistance, supply and demand zones, break of structure, change of character, displacement, rejection candles, engulfing candles, breakouts, and retests.

The app does not force a support or resistance level merely because a number is needed. A zone must be supported by the detector’s structural rules and available candle evidence. A zone can be useful as an active area, a target area, or an invalidated historical area, depending on its location, direction, retests, and later price behavior.

The lower timeframe is not interpreted in isolation. For example, a 15M bullish reaction may be less persuasive if it is directly beneath a major 4H supply zone. Conversely, a lower-timeframe confirmation that occurs at a meaningful demand zone and agrees with the higher-timeframe bias contributes more strongly to a possible BUY plan.

### Step 4: V5 reconciles the persistent zone inventory

Every detected zone is assigned an identity based on its user, asset, timeframe, and structural zone key. The durable records are stored in the `v5_zone_history` table. A new candle retrieval does not automatically erase previous zones.

During reconciliation, v5 attempts to match newly detected zones with historical records. A matched zone receives updated observation and retest information. A zone that has been revisited may become less fresh or weakened in a particular direction. A zone that is structurally broken or otherwise invalidated is retained as historical evidence with an `INVALIDATED` lifecycle, but it is excluded from current active-zone evidence.

The persistent record includes the zone kind, lower and upper price boundaries, reaction count, displacement, freshness, directional weakening, lifecycle, observation count, retest count, first-seen time, last-seen time, last candle time, last retest time, and supporting evidence JSON.

| Lifecycle | Meaning |
|---|---|
| ACTIVE | The zone remains usable historical/current evidence under the reconciliation rules. |
| WEAKENED | The zone remains known but has lost freshness or strength in a direction after later interaction. |
| INVALIDATED | The zone is retained for audit history but should not be used as an active zone in current trade reasoning. |

This is the app’s zone memory. Its purpose is to allow v5 to ask not only, “What zones are visible in this snapshot?” but also, “Which zones have persisted across snapshots, which have been retested, which have weakened, and which are no longer valid?”

### Step 5: V5 creates a hierarchical judgment

For each execution candidate, v5 combines the multi-timeframe evidence and determines whether the structural plan is **QUALIFIED** or **WAITING**. A waiting result is not necessarily an error. It can mean that the market is between zones, the confirmation sequence has not completed, the higher-timeframe context conflicts with the lower-timeframe move, or the required data/evidence is missing.

A qualified plan normally contains a direction, entry, stop-loss area, take-profit area, confidence, confluence, zones, confirmation evidence, geometry mode, decision trace, and risk/reward information. The target is intended to be placed near a realistic structural destination, usually before an opposing zone or another valid structural boundary. The stop is positioned beyond meaningful invalidation structure with the configured safety buffer, subject to the app’s risk and eligibility rules.

The engine is designed to avoid arbitrary targets. If the next opposing zone is too close to the entry under the configured clearance rule, it should not be treated as a suitable target. If the correct structural stop makes the ratio less attractive, the structural target is not silently moved to an arbitrary distance merely to manufacture a ratio.

### Step 6: The Entry Locator applies the final signal gate

The Entry Locator is the final execution gate between a v5 judgment and a Telegram signal. It does not replace v5 and it does not create an independent trade idea. It checks whether the v5 plan is eligible to be emitted under the application’s configured safeguards.

The current policy retains the normal confidence and confluence requirements: **at least 60% confidence and at least 45% confluence**. It also verifies the execution timeframe policy, risk geometry, direction, target and stop validity, cooldown or duplicate protections, asset/timeframe locks, and the absence of an unresolved conflicting or blocking state.

When the Entry Locator is not ready, the app records the reason and does not send a signal. This is an intentional fail-closed behavior. A v5 judgment can therefore be structurally interesting while still being withheld from Telegram because the final emission requirements were not satisfied.

### Step 7: The app persists the decision and, if eligible, creates a paper signal

The strategy decision ledger stores the asset, timeframe, verdict, confidence, confluence, rule evidence, market snapshot, generated direction, entry, stop loss, take profit, decision reason, cooldown key, and creation time. This is the audit record of what v5 and the Entry Locator believed at that moment.

For an eligible 15M or 5M plan, the app creates a generated paper signal. The generated signal is marked with its source, and the Telegram message identifies the workflow as a hierarchical v5 signal and the final source as the Entry Locator. The message remains paper-only and unvalidated.

The app also applies duplicate and unresolved-signal protections. An unresolved signal for the same asset and timeframe can prevent repeated Telegram spam. A later stronger contradictory detection can trigger a controlled replacement or adjustment workflow according to the configured rules rather than producing unlimited repeated messages every five minutes.

### Step 8: Telegram delivery is recorded separately

Telegram is a delivery channel, not the source of truth for the trading judgment. For every attempted message, the app records a delivery row containing the kind of message, status, Telegram message ID when available, deduplication key, error details, retry count, creation time, and delivery time.

This separation lets the interface distinguish several cases: a decision was denied; a decision qualified but was not attempted because another safeguard blocked it; a message was attempted and delivered; a message was attempted and failed; or an outcome message was sent as a reply to the original signal.

### Step 9: The tracker follows the paper signal

The outcome tracker periodically compares open paper signals with newer market prices. When the target or stop condition is met according to the tracking logic, the signal is resolved as WIN or LOSS and the result is saved. Pending signals remain open and continue to be tracked. The system is designed to avoid treating a pre-existing wick as a new post-entry result; the event must be evaluated relative to the signal’s recorded entry and lifecycle.

Resolved outcomes can appear in Trading History, Winning Rate, Best Time to Trade, and Best Days to Trade. The analytics are descriptive records of the app’s paper-signal sample, not proof of live profitability. Small or unresolved samples should not be interpreted as reliable performance evidence.

## 5. The Scanner interface

The Scanner page is the operational control room. It shows scanner freshness, required timeframe retrieval health, adaptive geometry diagnostics, the authenticated v5 production smoke status, the v5 persistent zone inventory, the qualification trend, collection status, decision-ledger information, Entry Locator state, and Telegram delivery status.

The per-asset zone inventory is organized into separate panels for EUR/USD, XAU/USD, GBP/USD, and BTC/USD. Each asset panel shows its 4H, 1H, 15M, and 5M records independently. For a timeframe with a persisted zone, the panel can show its kind and boundaries, lifecycle, observation count, retest count, freshness, and last-seen age. An empty panel means that no persisted qualifying zone is available for that asset/timeframe; it does not mean that the application should invent one.

The authenticated production smoke check is a diagnostic read path. It examines recent successful scanner activity, checks that persisted v5 hierarchy payloads have the expected workflow structure, reports qualified and waiting states, displays actual-ratio samples, and summarizes the active, weakened, and retained invalidated zone inventory. It cannot alter v5, release a signal lock, change a trade, or send a Telegram message.

## 6. White AI

White AI is the app-aware conversational assistant. It is designed to answer questions about the application’s actions and judgments, explain why a signal was sent or withheld, explain the role of each timeframe, describe the zone inventory, discuss the Entry Locator, clarify scanner health, and summarize paper-signal performance records.

White AI can answer questions such as:

| Question type | Evidence White AI should use |
|---|---|
| “Why was this stop loss small?” | The persisted signal’s entry, stop, target, ratio, decision reason, and available v5 evidence. |
| “What zones exist for BTC/USD on 1H?” | The user-scoped persistent zone-history records for BTC/USD and 1H. |
| “Why have we not received a signal?” | Scanner freshness, retrieval health, v5 waiting/qualified state, Entry Locator state, cooldowns, and Telegram delivery records. |
| “Which asset has the highest win rate?” | Resolved paper outcomes only, including sample size and evidence limitations. |
| “What does risk management mean?” | General trading education and the stored forex-document knowledge. |

White AI has persistent conversation memory, but that memory is advisory context. It is not allowed to rewrite v5 rules, change stops or targets, release blockers, approve signals, modify tracking, or send Telegram messages. If a requested live fact is not present in the persisted evidence, White AI should say that it is unavailable rather than fabricate an answer.

## 7. Cherry AI

Cherry AI is the independent trade-review assistant. It is intended for auditing a trade signal, whether the signal came from Trading Guard AI or from another trader. A user can provide a proposed direction, entry, stop, target, timeframe, and reasoning and ask Cherry AI whether the plan is coherent, what risks are visible, or how the idea relates to market-structure principles.

Cherry AI is advisory only. It does not insert the external trade into v5, does not alter the Entry Locator, does not create a generated signal, and does not send a Telegram alert. This separation prevents a conversational review from accidentally changing the autonomous signal workflow.

## 8. Stored records and auditability

The application uses durable records so that important events do not exist only in the current screen or in a Telegram chat.

| Record | What it preserves |
|---|---|
| Strategy rules | The ingested forex-document knowledge and persistent operating rules. |
| Strategy decision ledger | The v5 judgment, evidence, confidence, confluence, market snapshot, verdict, and generated plan. |
| V5 zone history | Zone identity, boundaries, structural evidence, lifecycle, observations, retests, freshness, and timestamps. |
| Entry Locator state | Per-asset/timeframe readiness, snapshot count, latest evidence, last direction, confidence, confluence, and emission time. |
| Generated signals | Paper trade plan, source, state, entry, stop, target, and outcome information. |
| Telegram deliveries | Delivery attempt status, message ID, deduplication, retries, failures, and timestamps. |
| Scanner run ledger | Cycle ownership, completion, market-data status, duplicate callbacks, created signals, tracked signals, and errors. |
| White AI memories | Conversation-derived advisory context, isolated from the v5 execution rules. |

This architecture supports retrospective questions: what data was available, what zones were known, why v5 waited, what the Entry Locator rejected, whether Telegram delivered the message, and how the paper signal was later resolved.

## 9. What the app does not know or guarantee

The app does not see a chart image in the same human visual way a trader sees a screenshot. It reconstructs chart information from numerical candle data and derived records. It can miss a meaningful event when provider data is unavailable, delayed, incomplete, or rate-limited. It can also wait for confirmation for a long time when the market does not satisfy the configured sequence.

The app does not know the future with certainty. Its confidence and confluence values are structured evidence scores, not probabilities that guarantee a winning trade. A high score does not remove market risk. A waiting result does not prove that no trade exists; it means the application did not find enough qualifying evidence under its rules at that time.

The app is also dependent on external services: Twelve Data for market data, the configured LLM service for conversational explanations, Telegram for distribution, the database for persistence, authentication for protected screens, and the scheduler for recurring scanner execution. An outage or subscription/hosting interruption can make the interface or a particular capability unavailable without meaning that the v5 rules themselves have changed.

## 10. A concise example

Suppose XAU/USD is approaching a previously persisted 4H supply zone. The 4H record provides bearish context. The 1H records show whether the area remains active or has been weakened by retests. On 15M, price reaches the zone and produces a qualifying rejection or engulfing sequence. On 5M, the execution structure agrees with the 15M direction.

V5 then evaluates whether the target can be placed near the next realistic opposing demand area and whether the stop can sit beyond meaningful invalidation structure with the required buffer. If the resulting plan is structurally coherent, the confidence and confluence thresholds pass, the timeframe is 15M or 5M, and no unresolved lock or cooldown blocks it, the Entry Locator can approve emission. The decision, zone evidence, signal, and Telegram delivery are persisted. The tracker then follows the paper signal until it resolves or is superseded under the configured rules.

If the confirmation candle never appears, the opposing zone is too close, the higher-timeframe context conflicts, provider data is incomplete, or the Entry Locator gate fails, the result is WAITING or DENIED. In that case, no Telegram trade signal is sent. That restraint is a core part of the app’s design.

## 11. Bottom line

Trading Guard AI is best understood as an **explainable, paper-only, multi-timeframe market-surveillance and signal-assistance system**. Its strongest characteristics are persistent evidence, separation of responsibilities, fail-closed signal emission, versioned zone memory, delivery and outcome reconciliation, and conversational explanation through White AI and Cherry AI.

Its purpose is not to replace a human trader or promise certainty. Its purpose is to reduce the amount of continuous chart-watching required, preserve the reasoning behind each possible signal, highlight when a setup is structurally supported, and remain disciplined when the available evidence is incomplete.
