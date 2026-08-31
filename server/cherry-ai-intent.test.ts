import { describe, expect, it } from "vitest";
import { isCompleteTradeIdea } from "./routers";

describe("Cherry AI trade-review intent", () => {
  it("accepts a directional setup with an explicit price field", () => {
    expect(isCompleteTradeIdea("SELL XAU/USD Entry: 4450 Stop Loss: 4460 Take Profit: 4430")).toBe(true);
    expect(isCompleteTradeIdea("BUY EUR/USD entry=1.1580")).toBe(true);
  });

  it("rejects informational questions and direction-only text", () => {
    expect(isCompleteTradeIdea("Which zones were marked out in the 1 hour and 4 hour timeframe by v5?")).toBe(false);
    expect(isCompleteTradeIdea("What does risk management mean?")).toBe(false);
    expect(isCompleteTradeIdea("BUY XAU/USD")).toBe(false);
  });
});
