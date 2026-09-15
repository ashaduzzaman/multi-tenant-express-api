import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSION_REGISTRY } from './permissions.js';

describe('PERMISSION_REGISTRY', () => {
  it('has unique permission names', () => {
    const names = PERMISSION_REGISTRY.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every name matches "<resource>:<action>"', () => {
    for (const p of PERMISSION_REGISTRY) {
      expect(p.name).toBe(`${p.resource}:${p.action}`);
    }
  });
});

describe('DEFAULT_ROLE_PERMISSIONS', () => {
  it('Owner gets every registered permission', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.Owner).toHaveLength(PERMISSION_REGISTRY.length);
  });

  it('every referenced permission name actually exists in the registry', () => {
    const known = new Set(PERMISSION_REGISTRY.map((p) => p.name));
    for (const perms of Object.values(DEFAULT_ROLE_PERMISSIONS)) {
      for (const name of perms) {
        expect(known.has(name)).toBe(true);
      }
    }
  });

  it('Admin does not get roles:delete', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.Admin).not.toContain('roles:delete');
  });

  it('Member is read-only on users and nothing else', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.Member).toEqual(['users:read']);
  });
});
