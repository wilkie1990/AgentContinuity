import { describe, expect, it } from "vitest";
import { resolveConfig } from "../index.js";

// A directory that does not exist, so resolveConfig never picks up the developer's real
// ~/.agent-continuity/config.json while these tests run.
const ISOLATED_DIR = "/tmp/agent-continuity-config-test-does-not-exist";

describe("resolveConfig host resolution", () => {
  it("binds 127.0.0.1 by default when nothing is configured", () => {
    const config = resolveConfig({ dataDir: ISOLATED_DIR }, {});
    expect(config.server.host).toBe("127.0.0.1");
    expect(config.baseUrl).toBe("http://127.0.0.1:4732");
  });

  it("passes an explicit host straight through", () => {
    const config = resolveConfig({ dataDir: ISOLATED_DIR, server: { host: "192.168.0.134" } }, {});
    expect(config.server.host).toBe("192.168.0.134");
    expect(config.baseUrl).toBe("http://192.168.0.134:4732");
  });

  it("keeps baseUrl reachable from this machine when binding 0.0.0.0", () => {
    const config = resolveConfig({ dataDir: ISOLATED_DIR, server: { host: "0.0.0.0" } }, {});
    expect(config.server.host).toBe("0.0.0.0");
    expect(config.baseUrl).toBe("http://127.0.0.1:4732");
  });

  it("reads AGENT_CONTINUITY_HOST from the environment", () => {
    const config = resolveConfig({ dataDir: ISOLATED_DIR }, { AGENT_CONTINUITY_HOST: "10.0.0.5" });
    expect(config.server.host).toBe("10.0.0.5");
  });

  it("only supports a partial server override (host without port, or vice versa)", () => {
    const config = resolveConfig({ dataDir: ISOLATED_DIR, server: { port: 9999 } }, {});
    expect(config.server.host).toBe("127.0.0.1");
    expect(config.server.port).toBe(9999);
  });
});
