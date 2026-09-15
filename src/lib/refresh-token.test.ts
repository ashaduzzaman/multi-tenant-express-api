import { describe, expect, it } from 'vitest';
import { generateRefreshToken, hashRefreshToken } from './refresh-token.js';

describe('generateRefreshToken', () => {
  it('returns a 64-char hex string (32 random bytes)', () => {
    const token = generateRefreshToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never returns the same token twice', () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    expect(a).not.toBe(b);
  });
});

describe('hashRefreshToken', () => {
  it('is deterministic for the same input', () => {
    const token = generateRefreshToken();
    expect(hashRefreshToken(token)).toBe(hashRefreshToken(token));
  });

  it('produces a 64-char hex SHA-256 digest', () => {
    expect(hashRefreshToken('anything')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('different tokens hash differently', () => {
    expect(hashRefreshToken('a')).not.toBe(hashRefreshToken('b'));
  });
});
