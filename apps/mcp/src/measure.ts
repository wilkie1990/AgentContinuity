import { createTestWorkspace } from "@agent-continuity/core/testing";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { fileURLToPath } from "node:url";
import { MCP_PROFILES, type McpProfile } from "./profile.js";
import { createMcpServer } from "./server.js";

const TOKEN_APPROXIMATION = "ceil(UTF-8 bytes / 4), a documented approximation rather than tokenizer output";

export type McpProfileMeasurement = {
  profile: McpProfile;
  registeredToolCount: number;
  inputSchemaBytes: number;
  inputSchemaTokensApprox: number;
  descriptionBytes: number;
  descriptionTokensApprox: number;
  toolNames: string[];
};

export type McpMeasurement = {
  method: { tokenApproximation: string; schemaSerialization: string };
  profiles: McpProfileMeasurement[];
  representativeRoundTrips: {
    scenario: string;
    atomicCalls: number;
    compositeCalls: number;
    reductionPercent: number;
  }[];
};

const bytes = (value: string) => Buffer.byteLength(value, "utf8");
const tokenApprox = (byteCount: number) => Math.ceil(byteCount / 4);

/** Measures the schemas that the MCP SDK actually advertises, not source estimates. */
export async function measureMcpProfiles(): Promise<McpMeasurement> {
  const profiles: McpProfileMeasurement[] = [];
  for (const profile of MCP_PROFILES) {
    const workspace = createTestWorkspace();
    const server = createMcpServer(workspace, { profile });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "mcp-measurement", version: "0.1.0" });
    try {
      await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
      const { tools } = await client.listTools();
      const inputSchemaBytes = tools.reduce((total, tool) => total + bytes(JSON.stringify(tool.inputSchema)), 0);
      const descriptionBytes = tools.reduce((total, tool) => total + bytes(tool.description ?? ""), 0);
      profiles.push({
        profile,
        registeredToolCount: tools.length,
        inputSchemaBytes,
        inputSchemaTokensApprox: tokenApprox(inputSchemaBytes),
        descriptionBytes,
        descriptionTokensApprox: tokenApprox(descriptionBytes),
        toolNames: tools.map((tool) => tool.name).sort(),
      });
    } finally {
      await client.close();
      await server.close();
      workspace.close();
    }
  }
  return {
    method: {
      tokenApproximation: TOKEN_APPROXIMATION,
      schemaSerialization: "UTF-8 byte length of JSON.stringify(tool.inputSchema) returned by tools/list",
    },
    profiles,
    representativeRoundTrips: [
      {
        scenario: "Lifecycle with one meaningful report and final handoff",
        atomicCalls: 9,
        compositeCalls: 3,
        reductionPercent: 67,
      },
    ],
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(await measureMcpProfiles(), null, 2)}\n`);
}
