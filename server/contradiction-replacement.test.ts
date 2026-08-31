import { describe, expect, it } from "vitest";
import { buildContradictionWarningDedupeKey, buildContradictoryReplacementDedupeKey } from "./scanner";
import { detectPaperTradeContradiction } from "./paper-trade-adjustments";

const signal = { id: 91, asset: "BTC/USD", timeframe: "15MIN", direction: "SELL" as const, entry: "100", stopLoss: "110", takeProfit: "80" };

const oppositeDecision = (confidence = 80, confluenceScore = 75) => ({
  direction: "BUY" as const,
  confidence,
  confluenceScore,
  setupIndicators: [{ id: "structure-uptrend", direction: "BUY" as const, strength: "STRONG" }],
  decisionTrace: { supportingComponents: ["Current structure"], conflictingComponents: [] },
});

describe("contradiction replacement delivery semantics", () => {
  it("uses one stable warning key for an original signal across changing fingerprints", () => {
    expect(buildContradictionWarningDedupeKey(signal.id)).toBe("contradiction-warning:91");
    expect(buildContradictionWarningDedupeKey(signal.id)).toBe(buildContradictionWarningDedupeKey(signal.id));
  });

  it("keeps a qualified replacement key separate from the one-time warning", () => {
    const contradiction = detectPaperTradeContradiction(signal, 101, oppositeDecision());
    expect(contradiction).not.toBeNull();
    expect(buildContradictoryReplacementDedupeKey(signal.id, contradiction!.fingerprint)).toContain("contradiction-replacement:91:");
    expect(buildContradictoryReplacementDedupeKey(signal.id, contradiction!.fingerprint)).not.toBe(buildContradictionWarningDedupeKey(signal.id));
  });

  it("requires opposite directional evidence before any replacement or warning path exists", () => {
    expect(detectPaperTradeContradiction(signal, 101, { ...oppositeDecision(), direction: "SELL" })).toBeNull();
    expect(detectPaperTradeContradiction(signal, 101, oppositeDecision(59, 80))).toBeNull();
  });
});
