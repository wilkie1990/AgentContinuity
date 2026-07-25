export const ERROR_CODES = [
  "PROJECT_NOT_FOUND",
  "PROJECT_ARCHIVED",
  "TASK_NOT_FOUND",
  "TASK_ALREADY_CLAIMED",
  "TASK_NOT_CLAIMED",
  "TASK_CLAIM_MISMATCH",
  "TASK_HAS_INCOMPLETE_ACCEPTANCE_CRITERIA",
  "TASK_HAS_ACTIVE_BLOCKERS",
  "BLOCKER_NOT_FOUND",
  "BLOCKER_ALREADY_RESOLVED",
  "DECISION_NOT_FOUND",
  "LINK_NOT_FOUND",
  "DEPENDENCY_NOT_FOUND",
  "DEPENDENCY_SELF_REFERENCE",
  "DEPENDENCY_CROSS_PROJECT",
  "DEPENDENCY_CYCLE",
  "ACCEPTANCE_CRITERION_NOT_FOUND",
  "ACCEPTANCE_CRITERION_ALREADY_COMPLETE",
  "ACCEPTANCE_CRITERION_ALREADY_OPEN",
  "INVALID_STATUS_TRANSITION",
  "INVALID_BOOTSTRAP_REFERENCE",
  "INVALID_METADATA",
  "VALIDATION_ERROR",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type ErrorDetails = Record<string, unknown>;

export type ErrorBody = {
  error: {
    code: ErrorCode;
    message: string;
    details: ErrorDetails;
  };
};

/**
 * The single error type raised by core services. Every transport (REST, MCP, CLI)
 * translates this into its own representation while preserving `code`.
 */
export class AgentWorkspaceError extends Error {
  readonly code: ErrorCode;
  readonly details: ErrorDetails;

  constructor(code: ErrorCode, message: string, details: ErrorDetails = {}) {
    super(message);
    this.name = "AgentWorkspaceError";
    this.code = code;
    this.details = details;
  }

  toBody(): ErrorBody {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }

  static is(value: unknown): value is AgentWorkspaceError {
    return value instanceof AgentWorkspaceError;
  }
}

const HTTP_STATUS_BY_CODE: Record<ErrorCode, number> = {
  PROJECT_NOT_FOUND: 404,
  PROJECT_ARCHIVED: 409,
  TASK_NOT_FOUND: 404,
  TASK_ALREADY_CLAIMED: 409,
  TASK_NOT_CLAIMED: 409,
  TASK_CLAIM_MISMATCH: 409,
  TASK_HAS_INCOMPLETE_ACCEPTANCE_CRITERIA: 409,
  TASK_HAS_ACTIVE_BLOCKERS: 409,
  BLOCKER_NOT_FOUND: 404,
  BLOCKER_ALREADY_RESOLVED: 409,
  DECISION_NOT_FOUND: 404,
  LINK_NOT_FOUND: 404,
  DEPENDENCY_NOT_FOUND: 404,
  DEPENDENCY_SELF_REFERENCE: 400,
  DEPENDENCY_CROSS_PROJECT: 400,
  DEPENDENCY_CYCLE: 409,
  ACCEPTANCE_CRITERION_NOT_FOUND: 404,
  ACCEPTANCE_CRITERION_ALREADY_COMPLETE: 409,
  ACCEPTANCE_CRITERION_ALREADY_OPEN: 409,
  INVALID_STATUS_TRANSITION: 409,
  INVALID_BOOTSTRAP_REFERENCE: 400,
  INVALID_METADATA: 400,
  VALIDATION_ERROR: 400,
  INTERNAL_ERROR: 500,
};

export function httpStatusForErrorCode(code: ErrorCode): number {
  return HTTP_STATUS_BY_CODE[code] ?? 500;
}
