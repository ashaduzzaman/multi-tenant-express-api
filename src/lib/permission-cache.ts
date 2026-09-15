interface CacheEntry {
  permissions: string[];
  expiresAt: number;
}

/**
 * In-memory permission cache, keyed by `tenantId:roleId`. Roles are
 * tenant-scoped rows with globally-unique UUIDs, so the roleId alone would
 * be a safe key too — but combining both makes the isolation boundary
 * explicit in the cache itself, not just in the underlying data model.
 *
 * The DB fetch is injected as a callback so this class stays framework/DB
 * agnostic and trivially testable with fake timers (see permission-cache.test.ts).
 */
export class PermissionCache {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private readonly sweepInterval: NodeJS.Timeout;

  constructor(ttlMs = 5 * 60 * 1000) {
    this.ttlMs = ttlMs;
    this.sweepInterval = setInterval(() => this.sweepExpired(), ttlMs).unref();
  }

  async getPermissions(
    tenantId: string,
    roleId: string,
    fetcher: () => Promise<string[]>,
  ): Promise<string[]> {
    const key = cacheKey(tenantId, roleId);
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.permissions;
    }

    const permissions = await fetcher();
    this.cache.set(key, { permissions, expiresAt: Date.now() + this.ttlMs });
    return permissions;
  }

  invalidate(tenantId: string, roleId: string): void {
    this.cache.delete(cacheKey(tenantId, roleId));
  }

  clear(): void {
    this.cache.clear();
  }

  /** Stops the background sweep. Mainly for tests that create short-lived instances. */
  destroy(): void {
    clearInterval(this.sweepInterval);
  }

  private sweepExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) this.cache.delete(key);
    }
  }
}

function cacheKey(tenantId: string, roleId: string): string {
  return `${tenantId}:${roleId}`;
}

export const permissionCache = new PermissionCache();
