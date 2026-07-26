import { AgentContinuityError, httpStatusForErrorCode } from "@agent-continuity/contracts";
import type { FastifyInstance } from "fastify";

/**
 * Single translation point from domain errors to HTTP. Routes never build error
 * responses themselves; they simply let core errors propagate.
 */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (AgentContinuityError.is(error)) {
      const status = httpStatusForErrorCode(error.code);
      if (status >= 500) request.log.error({ err: error }, "domain error");
      else request.log.info({ code: error.code, message: error.message }, "domain error");
      return reply.status(status).send(error.toBody());
    }

    // Fastify's own body parsing / schema failures.
    const fastifyError = error as { statusCode?: number; message?: string };
    if (typeof fastifyError.statusCode === "number" && fastifyError.statusCode < 500) {
      return reply
        .status(fastifyError.statusCode)
        .send(
          new AgentContinuityError(
            "VALIDATION_ERROR",
            fastifyError.message ?? "The request could not be processed.",
          ).toBody(),
        );
    }

    request.log.error({ err: error }, "unhandled error");
    return reply
      .status(500)
      .send(new AgentContinuityError("INTERNAL_ERROR", "An unexpected error occurred.").toBody());
  });
}
