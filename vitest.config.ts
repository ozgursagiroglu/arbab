import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**", ".arbab/**", ".arbab-tmp/**"],
    environment: "node",
    // Many tests build real git repositories and worktrees; under a loaded machine (parallel workers, other
    // sessions' lanes) they measured 20–30 s each and timed out at 20 s, although none hangs.
    testTimeout: 60_000,
  },
});
