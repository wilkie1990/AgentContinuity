import { listExternalIPv4Addresses } from "@agent-workspace/config";
import { TEST_CONFIG } from "@agent-workspace/core/testing";
import { afterEach, describe, expect, it } from "vitest";
import { describeRunningServer, startServer, type RunningServer } from "../start.js";

describe("startServer", () => {
  let server: RunningServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("binds loopback by default and is never flagged as exposed", async () => {
    server = await startServer({
      config: { ...TEST_CONFIG, server: { host: "127.0.0.1", hosts: ["127.0.0.1"], port: 0 } },
    });

    expect(server.host).toBe("127.0.0.1");
    expect(server.isExposedBeyondLoopback).toBe(false);
    expect(server.urls).toEqual([server.url]);
    expect(server.url).toBe(`http://127.0.0.1:${server.port}`);
    expect(server.port).toBeGreaterThan(0);
  });

  it("expands 0.0.0.0 into concrete addresses and flags exposure", async () => {
    server = await startServer({
      config: { ...TEST_CONFIG, server: { host: "0.0.0.0", hosts: ["0.0.0.0"], port: 0 } },
    });

    expect(server.isExposedBeyondLoopback).toBe(true);
    expect(server.urls.length).toBeGreaterThanOrEqual(1);
    for (const url of server.urls) {
      expect(url).not.toContain("0.0.0.0");
    }
    expect(server.urls).toContain(`http://127.0.0.1:${server.port}`);
  });

  /**
   * The point of the multi-listener design: one workspace, one Fastify app, several
   * bound addresses, all answering on the same port.
   */
  it("binds every requested address on one port and serves all of them", async () => {
    const loopback = "127.0.0.1";
    const extra = listExternalIPv4Addresses()[0];

    server = await startServer({
      config: {
        ...TEST_CONFIG,
        server: {
          host: loopback,
          hosts: extra ? [loopback, extra] : [loopback],
          port: 0,
        },
      },
    });

    expect(server.hosts).toEqual(extra ? [loopback, extra] : [loopback]);

    for (const host of server.hosts) {
      const response = await fetch(`http://${host}:${server.port}/health`);
      expect(response.status, `${host} should answer`).toBe(200);
      expect(await response.json()).toEqual({ status: "ok", version: "0.1.0" });
    }

    if (extra) expect(server.isExposedBeyondLoopback).toBe(true);
  });
});

describe("describeRunningServer", () => {
  it("lists every URL and stays quiet when not exposed beyond loopback", () => {
    const lines = describeRunningServer({
      urls: ["http://127.0.0.1:4732"],
      isExposedBeyondLoopback: false,
    });

    expect(lines).toEqual(["Agent Workspace listening on http://127.0.0.1:4732"]);
  });

  it("appends the no-authentication warning when reachable beyond loopback", () => {
    const lines = describeRunningServer({
      urls: ["http://100.100.144.100:4732"],
      isExposedBeyondLoopback: true,
    });

    expect(lines[0]).toBe("Agent Workspace listening on http://100.100.144.100:4732");
    expect(lines.join("\n")).toMatch(/no authentication/i);
  });

  it("prints one line per URL when several addresses are reachable", () => {
    const lines = describeRunningServer({
      urls: ["http://127.0.0.1:4732", "http://192.168.0.134:4732"],
      isExposedBeyondLoopback: true,
    });

    expect(lines[0]).toBe("Agent Workspace listening on http://127.0.0.1:4732");
    expect(lines[1]).toBe("Agent Workspace listening on http://192.168.0.134:4732");
  });
});
