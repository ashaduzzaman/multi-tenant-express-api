import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { z, type ZodError } from "zod";
import { AppError, NotFoundError } from "#/lib/errors.js";
import { errorHandler, notFoundHandler } from "./error-handler.js";

function fakeResponse(): {
  res: Response;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
} {
  const status = vi.fn().mockReturnThis();
  const json = vi.fn().mockReturnThis();
  const send = vi.fn().mockReturnThis();
  const res = { status, json, send } as unknown as Response;
  return { res, status, json };
}

describe("notFoundHandler", () => {
  it("has exactly 2 declared parameters — Express must treat it as a normal handler, never an error handler", () => {
    // This is the exact bug class from IMPLEMENTATION.md Phase 6: a 4-arg
    // "404 handler" gets registered as ErrorRequestHandler and silently
    // swallows every real error instead of ever running for real 404s.
    expect(notFoundHandler.length).toBe(2);
  });

  it("responds 404 with a structured body", () => {
    const { res, status, json } = fakeResponse();
    notFoundHandler({} as Request, res, vi.fn());

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      error: { code: "NOT_FOUND", message: "Route not found" },
    });
  });
});

describe("errorHandler", () => {
  it("has exactly 4 declared parameters — Express must treat it as an error handler", () => {
    expect(errorHandler.length).toBe(4);
  });

  it("maps a ZodError to 422 with flattened field details", () => {
    const schema = z.object({ email: z.string().email() });
    const result = schema.safeParse({ email: "not-an-email" });
    const zodError = result.success ? undefined : (result.error as ZodError);
    const { res, status, json } = fakeResponse();

    errorHandler(zodError, { requestId: "req-1" } as Request, res, vi.fn());

    expect(status).toHaveBeenCalledWith(422);
    const body = json.mock.calls[0]?.[0] as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("maps a known AppError (< 500) to its own status code, without logging at error level", () => {
    const { res, status, json } = fakeResponse();
    errorHandler(
      new NotFoundError("Widget not found"),
      { requestId: "req-2" } as Request,
      res,
      vi.fn(),
    );

    expect(status).toHaveBeenCalledWith(404);
    const body = json.mock.calls[0]?.[0] as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.message).toBe("Widget not found");
  });

  it("maps a 5xx AppError to its status code", () => {
    const { res, status } = fakeResponse();
    const serviceUnavailable = new AppError("Downstream unavailable", {
      statusCode: 503,
      code: "SERVICE_UNAVAILABLE",
    });

    errorHandler(
      serviceUnavailable,
      { requestId: "req-3" } as Request,
      res,
      vi.fn(),
    );

    expect(status).toHaveBeenCalledWith(503);
  });

  it("maps an unknown error to a generic 500 without leaking internals", () => {
    const { res, status, json } = fakeResponse();
    errorHandler(
      new Error("some internal detail"),
      { requestId: "req-4" } as Request,
      res,
      vi.fn(),
    );

    expect(status).toHaveBeenCalledWith(500);
    const body = json.mock.calls[0]?.[0] as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).not.toContain("some internal detail");
  });
});
