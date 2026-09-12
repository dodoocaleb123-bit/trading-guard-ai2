# Future News-Event Signal Path

## Status

This is a planning specification only. No application code, configuration, secrets, provider settings, database schema, scanner behavior, or Telegram behavior has been changed.

## Core decision

The four ordinary v5 asset channels remain independent. BTC/USD, EUR/USD, GBP/USD, and XAU/USD continue to evaluate their own video-derived strategies, and the presence of an approaching, active, or recently released news event does not block an otherwise qualified ordinary channel signal. BTC/USD is explicitly excluded from the news-data path: it receives no crypto-news feed, event reminders, directional warnings, or NEWS-EVENT SIGNALs.

A separate news-event path provides event awareness and may generate a distinct news-event signal. It does not replace or modify the ordinary asset-channel strategy.

## Message classes

| Class | Purpose | Trade signal? |
|---|---|---|
| `NEWS_WARNING` | Announces an approaching event, including event, affected asset, date, time, and countdown. Sent one day and one hour before release. | No |
| `NEWS_DIRECTIONAL_WARNING` | After release, reports the actual, forecast, surprise, event time, and a provisional directional interpretation. It must state that price action has not yet confirmed the direction. | No |
| `NEWS_EVENT_SIGNAL` | Sent only after the post-release reaction confirms the event-associated move through the separate confirmation sequence and universal safety gates. This class is unavailable for BTC/USD. | Yes, separately labeled |
| `CHANNEL_SIGNAL` | Ordinary signal produced by the asset-specific video-derived v5 channel. | Yes, ordinary path |

## News-event confirmation sequence

The scanner records the relevant event, actual value, forecast, surprise, release time, affected asset, and provider timestamp. It then observes price rather than treating the headline as a guaranteed direction.

The provisional directional warning may describe the usual macro interpretation, but it must not claim certainty. The news-event path then requires a liquidity sweep, strong displacement, a confirmed 5M BOS or CHoCH, and a retracement into a valid POI. It calculates entry, structural stop, target, and risk/reward only after that confirmation.

A news-event signal may bypass the asset-specific video strategy, because the purpose is to capture a post-news structural move that may contradict the existing market structure. It may not bypass universal safety controls.

## Universal safety gates

Every `NEWS_EVENT_SIGNAL` must use fresh, non-fabricated market data; contain a valid entry, structural stop, and realistic target; satisfy the approved minimum final RR of 1:2; pass duplicate suppression and Telegram idempotency; be persisted for tracking and outcome recovery; and include its event source, event identity, confirmation evidence, and signal class. These controls are platform protections, not asset-specific strategy rules.

## Asset-to-news mapping

The future news-event path applies only to the approved non-BTC assets. XAU/USD may use relevant USD macro events, GBP/USD may use GBP and USD events, and EUR/USD may use EUR and USD events. BTC/USD is market-data and strategy-only: no news provider is queried for it, no BTC news state is passed into its v5 channel, and no BTC news-event signal can be generated.

## Ordinary-channel independence

The ordinary four channels continue evaluating their own requirements in parallel. A news warning, directional warning, or news-event signal must not change their bias, add confluence to their score, remove their gates, or suppress their qualified signals. The Telegram labels must make the origin unmistakable.

## Required observability

Monitoring should distinguish provider/event status, reminder delivery, event release processing, provisional direction, confirmation-stage status, news-event signal identity, universal-gate results, and any suppression reason. Tracking should preserve the relationship between the event, warning messages, confirmation observations, and any resulting news-event signal.

## Open implementation decisions

Before implementation, the provider and credentials must be selected for each asset, event-to-asset mapping must be defined, the exact reminder timezone behavior must be fixed, and the provider’s actual-versus-forecast and impact fields must be validated. The post-release observation window and the precise displacement and POI definitions must also be finalized. Until then, this document remains a design record only.
