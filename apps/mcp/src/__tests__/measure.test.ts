import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { measureMcpProfiles } from "../measure.js";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));

describe("MCP measurement harness", () => {
  it("reproduces the committed post-roadmap schema and round-trip baseline", async () => {
    const committed = JSON.parse(readFileSync(`${repositoryRoot}/docs/mcp-measurements.json`, "utf8"));
    expect(await measureMcpProfiles()).toEqual(committed);
  });
});
