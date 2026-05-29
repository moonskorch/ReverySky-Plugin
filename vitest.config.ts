import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const configDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      obsidian: path.resolve(configDir, "tests/mocks/obsidian.ts")
    }
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
    isolate: true,
    restoreMocks: true
  }
});
