import {
  CONTEXT_HARD_LIMIT_BYTES,
  CONTEXT_SOFT_LIMIT_BYTES,
  AgentContinuityError,
  type ContextSize,
} from "@agent-continuity/contracts";

export function measureContext(content: string | null): ContextSize {
  const value = content ?? "";
  const bytes = Buffer.byteLength(value, "utf8");
  return {
    characters: [...value].length,
    bytes,
    overSoftLimit: bytes > CONTEXT_SOFT_LIMIT_BYTES,
  };
}

export function assertContextWithinLimit(content: string | null): ContextSize {
  const size = measureContext(content);
  if (size.bytes > CONTEXT_HARD_LIMIT_BYTES) {
    throw new AgentContinuityError(
      "CONTEXT_TOO_LARGE",
      `Context is ${size.bytes} UTF-8 bytes; the hard limit is ${CONTEXT_HARD_LIMIT_BYTES} bytes.`,
      {
        actualBytes: size.bytes,
        actualCharacters: size.characters,
        softLimitBytes: CONTEXT_SOFT_LIMIT_BYTES,
        hardLimitBytes: CONTEXT_HARD_LIMIT_BYTES,
      },
    );
  }
  return size;
}
