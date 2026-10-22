import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Node by default: most specs are pure logic or route handlers that need
    // Node's Request/FormData globals. Component specs opt into a DOM per file
    // with a `@vitest-environment jsdom` (or happy-dom) docblock.
    environment: "node",
    include: ["**/*.{test,spec}.{ts,tsx}"],
    // packages/* are standalone and run with their own dependencies (see ci.yml).
    exclude: ["node_modules", ".next", "prisma", "e2e", "packages/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      // Unit-testable code only. app/** (server actions, API routes) needs a
      // live Prisma/DB and is out of scope for jsdom unit tests.
      include: ["components/**/*.{ts,tsx}", "lib/**/*.ts"],
      // Ratchet these upward as component backfill continues. As of ENDOR-219
      // actuals are ~56% lines (lib ~83%, components ~38%); the gap is
      // untested components like app-header/login-form, not this issue's scope.
      thresholds: {
        lines: 50,
        functions: 70,
        branches: 75,
        statements: 50,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "server-only": path.resolve(__dirname, "node_modules/server-only/empty.js"),
    },
  },
});
