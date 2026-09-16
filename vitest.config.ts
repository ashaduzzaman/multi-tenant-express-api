import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  optimizeDeps: {
    exclude: ["bcrypt"],
  },
  resolve: {
    alias: [
      {
        find: /^#\//,
        replacement: fileURLToPath(new URL("./src/", import.meta.url)),
      },
    ],
  },
  test: {
    environment: "node",
    globals: false,
    // bcrypt is a native addon (a compiled .node binary) with no proper
    // "exports" map — Vitest 4's stricter module resolution can't process
    // it through Vite's transform pipeline the way it could under Vitest 2.
    // Externalizing means Node's own require() loads it directly, bypassing
    // Vite's resolver entirely, which is what a native binary needs anyway.
    server: {
      deps: {
        external: ["bcrypt"],
      },
    },
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 10_000,
    hookTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.d.ts", "src/index.ts"],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70,
      },
    },
  },
});
