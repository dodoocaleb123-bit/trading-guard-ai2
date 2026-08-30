import { describe, expect, it } from "vitest";
import { parseStructuredContent } from "./integrations";

describe("structured LLM content normalization", () => {
  it("parses plain JSON content", () => {
    expect(parseStructuredContent('{"ok":true}')).toEqual({ ok: true });
  });

  it("parses fenced JSON content", () => {
    expect(parseStructuredContent("```json\n{\"ok\":true}\n```")).toEqual({ ok: true });
  });

  it("extracts an object when a provider adds surrounding text", () => {
    expect(parseStructuredContent("Here is the result:\n{\"ok\":true}\nDone.")).toEqual({ ok: true });
  });

  it("joins text parts and fails closed for unusable content", () => {
    expect(parseStructuredContent([{ type: "text", text: '{"ok":true}' }])).toEqual({ ok: true });
    expect(parseStructuredContent("not JSON")).toEqual({});
    expect(parseStructuredContent(null)).toEqual({});
  });
});

