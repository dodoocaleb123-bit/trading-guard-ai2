import { describe, expect, it } from "vitest";
import { isCompleteTradeIdea, routeChatSubmission } from "./chat-intent";

describe("Cherry AI chat routing", () => {
  it("audits only complete directional setups with an explicit price field", () => {
    expect(isCompleteTradeIdea("SELL XAU/USD Entry: 4450 Stop Loss: 4460 Take Profit: 4430")).toBe(true);
    expect(routeChatSubmission("CHERRY", "BUY EUR/USD entry=1.1580", "AUDIT")).toBe("AUDIT");
  });

  it("keeps educational and informational Cherry questions in conversation mode", () => {
    expect(isCompleteTradeIdea("What does risk management mean in forex trading?")).toBe(false);
    expect(routeChatSubmission("CHERRY", "What does risk management mean in forex trading?", "AUDIT")).toBe("CONVERSATION");
    expect(routeChatSubmission("CHERRY", "What zones did v5 identify for BTC/USD 1H?", "AUDIT")).toBe("CONVERSATION");
  });
});
