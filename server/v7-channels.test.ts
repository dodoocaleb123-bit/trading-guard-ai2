import { describe, expect, it } from "vitest";
import { evaluateV7AssetChannel, v7ChannelContract } from "./v7-channels";
import type { MarketSeries } from "./integrations";
import type { V7Freshness } from "./v7-intelligence";

function series(symbol: string, interval: MarketSeries["interval"], bias: "BUY" | "SELL"): MarketSeries {
  const values = Array.from({ length: 80 }, (_, i) => {
    const base = bias === "BUY" ? 100 + i * 0.25 : 120 - i * 0.25;
    return { datetime: new Date(Date.now() - (80 - i) * 5 * 60_000).toISOString(), open: base, high: base + 0.4, low: base - 0.4, close: base + (bias === "BUY" ? 0.2 : -0.2) };
  });
  return { symbol, interval, values, close: Number(values.at(-1)!.close), trend: bias === "BUY" ? "UP" : "DOWN", fetchedAt: new Date().toISOString(), marketContext: null };
}
const fresh: V7Freshness = { ok: true, quoteAgeMs: 1000, candleAgeMs: 1000, spread: 0.01, reasons: [] };
function common(asset: "XAU/USD" | "BTC/USD" | "EUR/USD" | "GBP/USD", timeframe: string) {
  return { asset, timeframe, weekly: series(asset, "1week", "BUY"), daily: series(asset, "1day", "BUY"), h4: series(asset, "4h", "BUY"), h1: series(asset, "1h", "BUY"), m15: series(asset, "15min", "BUY"), m5: series(asset, "5min", "BUY"), freshness: fresh, sessionOpen: true } as const;
}

describe("v7 independent channels", () => {
  it("does not allow BTC 5MIN to create a signal", () => {
    const result = evaluateV7AssetChannel(common("BTC/USD", "5MIN"));
    expect(result.status).toBe("WAITING");
    expect(result.waitReason).toContain("native signal timeframe");
  });
  it("allows BTC to evaluate without treating 5M as a signal creator", () => {
    const input = common("BTC/USD", "15MIN");
    const result = evaluateV7AssetChannel({ ...input, m5: null });
    expect(result.waitReason).not.toContain("5M data unavailable");
  });
  it("keeps ordinary XAU decisions dependent on XAG confirmation", () => {
    const result = evaluateV7AssetChannel({ ...common("XAU/USD", "5MIN"), xagDirection: "SELL", xagFresh: true });
    expect(result.status).toBe("WAITING");
    expect(result.waitReason).toContain("XAG/USD direction");
  });
  it("requires EUR native 15M execution", () => {
    const result = evaluateV7AssetChannel(common("EUR/USD", "5MIN"));
    expect(result.waitReason).toContain("EUR/USD native signal timeframe");
  });
  it("requires GBP native 5M execution", () => {
    const result = evaluateV7AssetChannel(common("GBP/USD", "15MIN"));
    expect(result.waitReason).toContain("GBP/USD native execution timeframe");
  });
  it("does not permit an ordinary news policy to block a channel by itself", () => {
    const result = evaluateV7AssetChannel(common("EUR/USD", "15MIN"));
    expect(result.ordinaryNewsPolicy).toBe("ADDITIVE_ONLY");
    expect(result.waitReason ?? "").not.toContain("news");
  });
  it("exposes the four document-specific contracts", () => {
    expect(v7ChannelContract.XAU).toContain("5m-sweep-displacement-bos-retracement");
    expect(v7ChannelContract.BTC).toContain("1h-activation");
    expect(v7ChannelContract.EUR).toContain("premium-discount-location");
    expect(v7ChannelContract.GBP).toContain("5m-sweep-bos-new-zone-deep-retracement");
  });
});
