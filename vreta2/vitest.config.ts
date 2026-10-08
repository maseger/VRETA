import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@shared": fileURLToPath(new URL("./supabase/functions/_shared", import.meta.url)) } },
  test: {
    environment: "node",
    testTimeout: 120_000,
    hookTimeout: 240_000,
    pool: "forks",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
  },
});
