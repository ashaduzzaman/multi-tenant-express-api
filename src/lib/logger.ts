import pino, { type LoggerOptions } from "pino";
import { env } from "#/config/env.js";

const options: LoggerOptions = {
  level: env.LOG_LEVEL,
  base: { service: "multitenant-api", env: env.NODE_ENV },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "*.password",
      "*.passwordHash",
      "*.token",
      "*.secret",
    ],
    censor: "[REDACTED]",
  },
};

// pino.transport()'s return type resolves to `any` under the installed
// @types for pino — it's a real DestinationStream at runtime, so this cast
// documents the fix instead of leaving an unexplained `any` in the codebase.
const transport: pino.DestinationStream | undefined =
  env.NODE_ENV === "development"
    ? (pino.transport({
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:HH:MM:ss.l",
          ignore: "pid,hostname",
        },
      }) as pino.DestinationStream)
    : undefined;

export const logger = transport ? pino(options, transport) : pino(options);
