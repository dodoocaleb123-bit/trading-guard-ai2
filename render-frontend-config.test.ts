import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Render frontend configuration", () => {
  it("includes the public Supabase configuration required by the migrated auth flow", () => {
    const blueprint = readFileSync(resolve(process.cwd(), "render-frontend.yaml"), "utf8");
    expect(blueprint).toContain("key: VITE_API_BASE_URL");
    expect(blueprint).toContain("key: VITE_SUPABASE_URL");
    expect(blueprint).toContain("key: VITE_SUPABASE_ANON_KEY");
    expect(blueprint).not.toContain("key: BUILT_IN_FORGE_API_KEY");
  });
});
