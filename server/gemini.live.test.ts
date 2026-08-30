import { describe, expect, it } from "vitest";
import { invokeLLM } from "./_core/llm";
import { parseStructuredContent } from "./integrations";

describe("Google Gemini live chat", () => {
  it("returns a minimal assistant response through the provider adapter", async () => {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: "Answer with exactly one short word." },
        { role: "user", content: "Say hello." },
      ],
      maxTokens: 256,
    });

    const content = response.choices[0]?.message.content;
    expect(typeof content).toBe("string");
    expect(String(content).trim().length).toBeGreaterThan(0);
  }, 45_000);

  it("returns structured JSON through the provider adapter", async () => {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: "Return only valid JSON with a boolean ok field." },
        { role: "user", content: "Set ok to true." },
      ],
      responseFormat: { type: "json_object" },
      maxTokens: 256,
    });

    const content = response.choices[0]?.message.content;
    expect(typeof content).toBe("string");
    expect(parseStructuredContent(content)).toEqual({ ok: true });
  }, 45_000);
});
