import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const local = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    // Tests run straight from source so no build step is required before `pnpm test`.
    alias: {
      "@agent-continuity/contracts": local("./packages/contracts/src/index.ts"),
      "@agent-continuity/config": local("./packages/config/src/index.ts"),
      "@agent-continuity/database": local("./packages/database/src/index.ts"),
      "@agent-continuity/core/testing": local("./packages/core/src/testing.ts"),
      "@agent-continuity/core": local("./packages/core/src/index.ts"),
      "@agent-continuity/client": local("./packages/client/src/index.ts"),
    },
  },
  test: {
    globals: false,
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/server/**/*.test.ts", "apps/mcp/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "apps/web/**", "e2e/**"],
  },
});
