import pino, { type LoggerOptions } from 'pino';
import { env } from '#/config/env.js';

const options: LoggerOptions = {
  level: env.LOG_LEVEL,
  base: { service: 'multitenant-api', env: env.NODE_ENV },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.secret',
    ],
    censor: '[REDACTED]',
  },
};

const transport =
  env.NODE_ENV === 'development'
    ? pino.transport({
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' },
      })
    : undefined;

export const logger = transport ? pino(options, transport) : pino(options);
