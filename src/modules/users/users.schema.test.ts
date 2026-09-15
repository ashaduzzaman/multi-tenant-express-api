import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { changePasswordInput, createUserInput, updateUserInput } from './users.schema.js';

describe('createUserInput', () => {
  const valid = { email: 'a@b.test', name: 'A B', password: 'password123', roleId: randomUUID() };

  it('accepts a valid payload', () => {
    expect(createUserInput.parse(valid)).toEqual(valid);
  });

  it('rejects an invalid email', () => {
    expect(createUserInput.safeParse({ ...valid, email: 'nope' }).success).toBe(false);
  });

  it('rejects a short password', () => {
    expect(createUserInput.safeParse({ ...valid, password: 'short' }).success).toBe(false);
  });

  it('rejects a non-uuid roleId', () => {
    expect(createUserInput.safeParse({ ...valid, roleId: 'not-a-uuid' }).success).toBe(false);
  });
});

describe('updateUserInput', () => {
  it('accepts a partial payload', () => {
    expect(updateUserInput.parse({ name: 'New Name' })).toEqual({ name: 'New Name' });
  });

  it('accepts an empty object', () => {
    expect(updateUserInput.parse({})).toEqual({});
  });

  it('rejects an invalid email when provided', () => {
    expect(updateUserInput.safeParse({ email: 'nope' }).success).toBe(false);
  });
});

describe('changePasswordInput', () => {
  it('accepts a valid new password', () => {
    expect(changePasswordInput.parse({ password: 'newpassword123' })).toEqual({
      password: 'newpassword123',
    });
  });

  it('rejects a short password', () => {
    expect(changePasswordInput.safeParse({ password: 'short' }).success).toBe(false);
  });
});
