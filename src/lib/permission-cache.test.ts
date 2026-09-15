import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PermissionCache } from './permission-cache.js';

describe('PermissionCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls the fetcher on a cache miss and returns its result', async () => {
    const cache = new PermissionCache(1000);
    const fetcher = vi.fn().mockResolvedValue(['users:read']);

    const result = await cache.getPermissions('tenant-a', 'role-1', fetcher);

    expect(result).toEqual(['users:read']);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('serves subsequent calls from cache without calling the fetcher again', async () => {
    const cache = new PermissionCache(1000);
    const fetcher = vi.fn().mockResolvedValue(['users:read']);

    await cache.getPermissions('tenant-a', 'role-1', fetcher);
    await cache.getPermissions('tenant-a', 'role-1', fetcher);
    await cache.getPermissions('tenant-a', 'role-1', fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('refetches once the TTL expires', async () => {
    const cache = new PermissionCache(1000);
    const fetcher = vi.fn().mockResolvedValueOnce(['users:read']).mockResolvedValueOnce(['users:read', 'users:create']);

    await cache.getPermissions('tenant-a', 'role-1', fetcher);
    vi.advanceTimersByTime(1001);
    const second = await cache.getPermissions('tenant-a', 'role-1', fetcher);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(second).toEqual(['users:read', 'users:create']);
  });

  it('keys the cache by tenantId AND roleId — different tenants never share an entry', async () => {
    const cache = new PermissionCache(1000);
    const fetcher = vi.fn().mockResolvedValue(['users:read']);

    await cache.getPermissions('tenant-a', 'role-1', fetcher);
    await cache.getPermissions('tenant-b', 'role-1', fetcher);

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('invalidate() forces the next call to refetch', async () => {
    const cache = new PermissionCache(1000);
    const fetcher = vi.fn().mockResolvedValue(['users:read']);

    await cache.getPermissions('tenant-a', 'role-1', fetcher);
    cache.invalidate('tenant-a', 'role-1');
    await cache.getPermissions('tenant-a', 'role-1', fetcher);

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('clear() drops every entry', async () => {
    const cache = new PermissionCache(1000);
    const fetcher = vi.fn().mockResolvedValue(['users:read']);

    await cache.getPermissions('tenant-a', 'role-1', fetcher);
    cache.clear();
    await cache.getPermissions('tenant-a', 'role-1', fetcher);

    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
