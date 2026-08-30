import { afterEach, describe, expect, it, vi } from "vitest";

describe("Gemini LLM provider", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("routes legacy OpenAI-shaped calls to Gemini with the server-side key", async () => {
    vi.resetModules();
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    vi.stubEnv("GEMINI_API_URL", "https://generativelanguage.googleapis.com/v1beta/openai");
    vi.stubEnv("GEMINI_MODEL", "gemini-2.5-flash");
    vi.stubEnv("BUILT_IN_FORGE_API_KEY", "");

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        id: "gemini-test",
        created: 1,
        model: "gemini-2.5-flash",
        choices: [{ index: 0, message: { role: "assistant", content: "hello" }, finish_reason: "stop" }],
      }), { status: 200, headers: { "content-type": "application/json" } })
    );

    const { invokeLLM } = await import("./_core/llm");
    const result = await invokeLLM({
      model: "gpt-5-mini",
      messages: [{ role: "user", content: "hello" }],
      maxTokens: 64,
    });

    expect(result.choices[0]?.message.content).toBe("hello");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      expect.objectContaining({
        headers: {
          "content-type": "application/json",
          authorization: "Bearer test-gemini-key",
        },
      })
    );
    const request = fetchMock.mock.calls[0]?.[1];
    expect(JSON.parse(String(request?.body))).toMatchObject({
      model: "gemini-2.5-flash",
      max_tokens: 64,
    });
  });
});
