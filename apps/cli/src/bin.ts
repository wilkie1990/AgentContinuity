#!/usr/bin/env node
import { AgentContinuityError } from "@agent-continuity/contracts";
import { buildProgram } from "./program.js";

try {
  await buildProgram().parseAsync(process.argv);
} catch (error) {
  if (AgentContinuityError.is(error)) {
    process.stderr.write(`${error.code}: ${error.message}\n`);
    if (Object.keys(error.details).length > 0) {
      process.stderr.write(`${JSON.stringify(error.details, null, 2)}\n`);
    }
  } else {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  }
  process.exit(1);
}
