import { randomUUID } from "node:crypto";
import pinoHttpImport from "pino-http";
import type { HttpLogger, Options } from "pino-http";
import { logger } from "#/lib/logger.js";

// pino-http's shipped .d.ts declares an ESM-style `export default` inside a
// package TS resolves as CommonJS format (no package.json "type" field), so
// under `moduleResolution: NodeNext` the default import's inferred type is
// the whole module namespace instead of the callable function — a mismatch
// between the .d.ts and the real `module.exports = pinoHttp` runtime shape.
// It IS callable at runtime; this cast just corrects the type at the one
// place it's used, rather than fighting module resolution globally.
const pinoHttp = pinoHttpImport as unknown as (opts: Options) => HttpLogger;

export const requestLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const existing = req.headers["x-request-id"];
    const id =
      typeof existing === "string" && existing.length > 0
        ? existing
        : randomUUID();
    res.setHeader("x-request-id", id);
    // Make available on req for handlers + error handler
    (req as unknown as { requestId: string }).requestId = id;
    return id;
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
  customSuccessMessage: (req, res) =>
    `${req.method} ${req.url} ${String(res.statusCode)}`,
  customErrorMessage: (req, res) =>
    `${req.method} ${req.url} ${String(res.statusCode)} (error)`,
});
