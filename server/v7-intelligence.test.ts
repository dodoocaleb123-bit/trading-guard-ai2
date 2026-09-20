import { describe, expect, it } from "vitest";
import { buildV7ChannelResult, calculateV7Freshness, finalRiskReward, isBtcNewsExcluded, isWithinV7Session, qualifiesV7RiskGeometry } from "./v7-intelligence";

const series = { fetchedAt: "2026-09-20T08:00:00.000Z", values: [{ datetime: "2026-09-20 07:59:00" }] };

describe("v7 intelligence contract", () => {
  it("uses the locked 08:00-17:00 UTC session", () => {
    expect(isWithinV7Session(new Date("2026-09-20T08:00:00Z"))).toBe(true);
    expect(isWithinV7Session(new Date("2026-09-20T17:00:00Z"))).toBe(false);
  });

  it("requires live bid/ask spread and fresh quote/candle evidence", () => {
    const result = calculateV7Freshness({ asset: "EUR/USD", series, quote: { asset: "EUR/USD", price: 1, bid: null, ask: null, spread: null, fetchedAt: "2026-09-20T08:00:00Z" }, now: new Date("2026-09-20T08:00:05Z") });
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain("live bid/ask spread unavailable");
  });

  it("enforces final RR >= 1:2 and structural direction", () => {
    expect(finalRiskReward(100, 99, 102)).toBe(2);
    expect(qualifiesV7RiskGeometry("BUY", 100, 99, 102)).toBe(true);
    expect(qualifiesV7RiskGeometry("BUY", 100, 99, 101.99)).toBe(false);
    expect(qualifiesV7RiskGeometry("SELL", 100, 101, 98)).toBe(true);
  });

  it("keeps BTC outside the news-event path and native to 15MIN", () => {
    expect(isBtcNewsExcluded("BTC/USD")).toBe(true);
    const result = buildV7ChannelResult({ asset: "BTC/USD", timeframe: "5MIN", sessionOpen: true, strategyQualified: true, freshness: { ok: true, quoteAgeMs: 100, candleAgeMs: 100, spread: 1, reasons: [] }, base: { direction: "BUY", entry: 100, stopLoss: 99, takeProfit: 102, confidence: 80, confluenceScore: 70 } });
    expect(result.status).toBe("WAITING");
    expect(result.waitReason).toContain("native signal timeframe is 15MIN");
  });

  it("does not let ordinary news status block a qualified channel", () => {
    const result = buildV7ChannelResult({ asset: "EUR/USD", timeframe: "15MIN", sessionOpen: true, strategyQualified: true, freshness: { ok: true, quoteAgeMs: 100, candleAgeMs: 100, spread: 0.0001, reasons: [] }, base: { direction: "BUY", entry: 100, stopLoss: 99, takeProfit: 102, confidence: 80, confluenceScore: 70 } });
    expect(result.status).toBe("QUALIFIED");
    expect(result.ordinaryNewsPolicy).toBe("ADDITIVE_ONLY");
  });
});
