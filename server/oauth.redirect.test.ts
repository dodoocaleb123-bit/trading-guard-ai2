import { describe, expect, it } from "vitest";
import { getOAuthSuccessRedirect } from "./_core/oauth";

describe("OAuth success redirect", () => {
  it("redirects to the configured frontend origin", () => {
    expect(getOAuthSuccessRedirect("https://trading-guard-ui.onrender.com")).toBe("https://trading-guard-ui.onrender.com/");
  });

  it("falls back to the backend root when no frontend origin is configured", () => {
    expect(getOAuthSuccessRedirect("")).toBe("/");
  });

  it("rejects malformed frontend origins without breaking login", () => {
    expect(getOAuthSuccessRedirect("not-a-url")).toBe("/");
  });
});
