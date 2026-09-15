import type { Request } from 'express';
import { BadRequestError } from './errors.js';

/**
 * Express 5's route params are typed `string | string[]` (path-to-regexp v6
 * allows repeated params like `/:id+`). None of our routes use that, so a
 * route param that isn't a plain string is a malformed request, not a
 * programmer error — worth a typed 400, not a runtime crash on `.trim()`
 * or similar further down.
 */
export function requireParam(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new BadRequestError(`Missing or invalid path parameter: ${name}`);
  }
  return value;
}
