import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MCP_TOOL_CATALOG } from "../profile.js";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));

describe("MCP documentation", () => {
  it("keeps README and MCP profile counts tied to the declarative catalog", () => {
    const readme = readFileSync(`${repositoryRoot}/README.md`, "utf8");
    const mcpDocs = readFileSync(`${repositoryRoot}/docs/mcp.md`, "utf8");
    expect(readme).toContain(`${MCP_TOOL_CATALOG.full.length} typed tools`);
    expect(readme).toContain(`${MCP_TOOL_CATALOG.agent.length}-tool agent profile`);
    expect(mcpDocs).toContain(`all **${MCP_TOOL_CATALOG.full.length} named,\ntyped tools**`);
    expect(mcpDocs).toContain(`with **${MCP_TOOL_CATALOG.agent.length} named, typed tools**`);
    expect(mcpDocs).toContain("AGENT_CONTINUITY_MCP_PROFILE=full");
  });
});
