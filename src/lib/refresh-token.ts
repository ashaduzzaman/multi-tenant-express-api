import crypto from "node:crypto";

/** Opaque, high-entropy refresh token. Only its hash is ever persisted. */
export function generateRefreshToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** SHA-256 hash — one-way, deterministic, safe to store and compare in the DB. */
export function hashRefreshToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
