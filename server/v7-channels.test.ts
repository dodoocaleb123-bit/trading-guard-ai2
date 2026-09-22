import { describe, expect, it } from "vitest";
import { evaluateV7AssetChannel } from "./v7-channels";
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

describe("v7 independent channels", () => {
  it("does not allow BTC 5MIN to create a signal", () => {
    const result = evaluateV7AssetChannel({ asset: "BTC/USD", timeframe: "5MIN", weekly: series("BTC/USD", "1week", "BUY"), daily: series("BTC/USD", "1day", "BUY"), h4: series("BTC/USD", "4h", "BUY"), h1: series("BTC/USD", "1h", "BUY"), m15: series("BTC/USD", "15min", "BUY"), m5: series("BTC/USD", "5min", "BUY"), freshness: fresh, sessionOpen: true });
    expect(result.status).toBe("WAITING");
    expect(result.waitReason).toContain("native signal timeframe");
  });
  it("keeps ordinary XAU decisions dependent on XAG confirmation", () => {
    const result = evaluateV7AssetChannel({ asset: "XAU/USD", timeframe: "5MIN", weekly: series("XAU/USD", "1week", "BUY"), daily: series("XAU/USD", "1day", "BUY"), h4: series("XAU/USD", "4h", "BUY"), h1: series("XAU/USD", "1h", "BUY"), m15: series("XAU/USD", "15min", "BUY"), m5: series("XAU/USD", "5min", "BUY"), freshness: fresh, sessionOpen: true, xagDirection: "SELL", xagFresh: true });
    expect(result.status).toBe("WAITING");
    expect(result.waitReason).toContain("XAG/USD direction");
  });
  it("never treats a news policy as an ordinary channel block", () => {
    const result = evaluateV7AssetChannel({ asset: "EUR/USD", timeframe: "15MIN", weekly: series("EUR/USD", "1week", "BUY"), daily: series("EUR/USD", "1day", "BUY"), h4: series("EUR/USD", "4h", "BUY"), h1: series("EUR/USD", "1h", "BUY"), m15: series("EUR/USD", "15min", "BUY"), m5: series("EUR/USD", "5min", "BUY"), freshness: fresh, sessionOpen: true });
    expect(result.ordinaryNewsPolicy).toBe("ADDITIVE_ONLY");
  });
});
