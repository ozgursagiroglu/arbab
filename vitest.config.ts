import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**", ".arbab/**", ".arbab-tmp/**"],
    environment: "node",
    testTimeout: 20_000,
  },
});
