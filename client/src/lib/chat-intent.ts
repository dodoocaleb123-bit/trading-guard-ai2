export function isCompleteTradeIdea(signal: string): boolean {
  const hasDirection = /\b(BUY|SELL)\b/i.test(signal);
  const hasPriceField = /\b(entry|stop\s*loss|take\s*profit|tp|sl)\s*[:=]/i.test(signal);
  return hasDirection && hasPriceField;
}

export function routeChatSubmission(
  assistant: "WHITE" | "CHERRY",
  signal: string,
  mode: "ASK" | "AUDIT",
): "AUDIT" | "CONVERSATION" {
  return assistant === "CHERRY" && mode === "AUDIT" && isCompleteTradeIdea(signal)
    ? "AUDIT"
    : "CONVERSATION";
}
