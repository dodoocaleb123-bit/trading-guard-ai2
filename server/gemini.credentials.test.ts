import { describe, expect, it } from "vitest";

describe("Google Gemini credentials", () => {
  it("authenticates against the lightweight models endpoint", async () => {
    const apiKey = process.env.GEMINI_API_KEY;
    expect(apiKey, "GEMINI_API_KEY must be configured").toBeTruthy();

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/openai/models",
      {
        headers: { authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15_000),
      }
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Gemini credential check failed: ${response.status} ${body.slice(0, 240)}`);
    }

    const payload = (await response.json()) as { data?: Array<{ id?: string }> };
    expect(Array.isArray(payload.data)).toBe(true);
    expect(payload.data?.length ?? 0).toBeGreaterThan(0);
  }, 20_000);
});
