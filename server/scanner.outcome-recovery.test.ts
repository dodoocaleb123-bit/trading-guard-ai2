import { describe, expect, it } from "vitest";
import { MAX_FAILED_OUTCOME_RETRIES_PER_RUN, MAX_OUTCOME_TRACKS_PER_RUN, isGenuineLiveResolvedOutcome, outcomeFallbackPrice, outcomeNotificationDedupeKey, selectOutcomeTrackingBatch } from "./scanner";

describe("scanner outcome recovery safeguards", () => {
  it("limits outcome tracking to the newest signals in deterministic order", () => {
    const signals = Array.from({ length: MAX_OUTCOME_TRACKS_PER_RUN + 3 }, (_, index) => ({
      id: index + 1,
      openedAt: new Date(Date.UTC(2026, 7, 24, 0, index)).toISOString(),
    }));

    expect(selectOutcomeTrackingBatch(signals)).toHaveLength(MAX_OUTCOME_TRACKS_PER_RUN);
    const selected = selectOutcomeTrackingBatch(signals);
    expect(selected[0]?.id).toBe(MAX_OUTCOME_TRACKS_PER_RUN + 3);
    expect(selected.at(-1)?.id).toBe(4);
    expect(selected).toHaveLength(MAX_OUTCOME_TRACKS_PER_RUN);
  });

  it("uses persisted or auditable fallback prices for retry messages", () => {
    expect(outcomeFallbackPrice({ status: "WIN", entry: "1", stopLoss: "0.9", takeProfit: "1.2", resolutionPrice: "1.18" })).toBe(1.18);
    expect(outcomeFallbackPrice({ status: "LOSS", entry: "1", stopLoss: "0.9", takeProfit: "1.2", outcomeNote: "Closed from live price 0.91." })).toBe(0.91);
    expect(outcomeFallbackPrice({ status: "WIN", entry: "1", stopLoss: "0.9", takeProfit: "1.2" })).toBe(1.2);
  });

  it("keeps the retry batch smaller than the outcome-tracking batch", () => {
    expect(MAX_FAILED_OUTCOME_RETRIES_PER_RUN).toBeLessThan(MAX_OUTCOME_TRACKS_PER_RUN);
  });

  it("recovers only genuine live-resolved outcomes and excludes manual overrides", () => {
    expect(isGenuineLiveResolvedOutcome({ status: "WIN", outcomeNote: "Closed from live BTC/USD price 100." })).toBe(true);
    expect(isGenuineLiveResolvedOutcome({ status: "LOSS", outcomeNote: "Closed from live XAU/USD price 200." })).toBe(true);
    expect(isGenuineLiveResolvedOutcome({ status: "WIN", outcomeNote: null })).toBe(true);
    expect(isGenuineLiveResolvedOutcome({ status: "WIN", outcomeNote: "Manual outcome override confirmed by user: take profit reported hit." })).toBe(false);
    expect(isGenuineLiveResolvedOutcome({ status: "PENDING", outcomeNote: "Still open." })).toBe(false);
  });

  it("uses one stable outcome dedupe key per signal and status", () => {
    expect(outcomeNotificationDedupeKey(17310001, "LOSS")).toBe("outcome:17310001:LOSS");
    expect(outcomeNotificationDedupeKey(17310001, "LOSS")).toBe(outcomeNotificationDedupeKey(17310001, "LOSS"));
    expect(outcomeNotificationDedupeKey(17310001, "LOSS")).not.toBe(outcomeNotificationDedupeKey(17310001, "WIN"));
  });
});
