import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const local = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    // Tests run straight from source so no build step is required before `pnpm test`.
    alias: {
      "@agent-workspace/contracts": local("./packages/contracts/src/index.ts"),
      "@agent-workspace/config": local("./packages/config/src/index.ts"),
      "@agent-workspace/database": local("./packages/database/src/index.ts"),
      "@agent-workspace/core/testing": local("./packages/core/src/testing.ts"),
      "@agent-workspace/core": local("./packages/core/src/index.ts"),
      "@agent-workspace/client": local("./packages/client/src/index.ts"),
    },
  },
  test: {
    globals: false,
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/server/**/*.test.ts", "apps/mcp/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "apps/web/**", "e2e/**"],
  },
});
