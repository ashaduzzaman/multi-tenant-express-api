/**
 * Base class for all expected application errors.
 *
 * RULES:
 *   - Throw an AppError subclass for any error that is the user's fault or a
 *     known business-logic condition. The error handler turns it into a clean
 *     JSON response with the right status code.
 *   - Throw a plain Error (or let one bubble up) for unexpected/programmer
 *     errors. The error handler logs them at error level and returns 500.
 *   - Never include a tenant_id, user input, or DB row in `message` — those
 *     go in `details` so they can be redacted by the logger.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: Record<string, unknown>;
  public readonly isOperational = true;

  constructor(
    message: string,
    options: {
      statusCode?: number;
      code?: string;
      details?: Record<string, unknown>;
    } = {},
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = options.statusCode ?? 500;
    this.code = options.code ?? "INTERNAL_ERROR";
    this.details = options.details;
    // @types/node declares this unconditionally, but it's a V8-only API —
    // optional chaining is genuine defense for non-V8 engines, not dead code.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    Error.captureStackTrace?.(this, this.constructor);
  }
}

export class BadRequestError extends AppError {
  constructor(message = "Bad request", details?: Record<string, unknown>) {
    super(message, { statusCode: 400, code: "BAD_REQUEST", details });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super(message, { statusCode: 401, code: "UNAUTHORIZED" });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(message, { statusCode: 403, code: "FORBIDDEN" });
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super(message, { statusCode: 404, code: "NOT_FOUND" });
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflict", details?: Record<string, unknown>) {
    super(message, { statusCode: 409, code: "CONFLICT", details });
  }
}

export class ValidationError extends AppError {
  constructor(
    message = "Validation failed",
    details?: Record<string, unknown>,
  ) {
    super(message, { statusCode: 422, code: "VALIDATION_ERROR", details });
  }
}

export class TenantContextError extends AppError {
  constructor(message = "Tenant context is required for this operation") {
    super(message, { statusCode: 500, code: "TENANT_CONTEXT_MISSING" });
  }
}
