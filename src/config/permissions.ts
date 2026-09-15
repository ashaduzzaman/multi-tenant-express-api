export interface PermissionDef {
  name: string;
  resource: string;
  action: string;
  description: string;
}

/**
 * Single source of truth for every permission this starter kit knows about.
 * Adding a feature: add entries here, restart the API — `scripts/sync-permissions.ts`
 * upserts them into the `permissions` table at boot. No SQL migration needed.
 *
 * This is a generic starter catalog, not a real product's permission list —
 * extend it as you add modules.
 */
export const PERMISSION_REGISTRY: PermissionDef[] = [
  { name: 'users:read', resource: 'users', action: 'read', description: 'List and view users' },
  { name: 'users:create', resource: 'users', action: 'create', description: 'Create users' },
  {
    name: 'users:update',
    resource: 'users',
    action: 'update',
    description: 'Update users and reset passwords',
  },
  { name: 'users:delete', resource: 'users', action: 'delete', description: 'Delete users' },

  {
    name: 'roles:read',
    resource: 'roles',
    action: 'read',
    description: 'List roles and the permission catalog',
  },
  { name: 'roles:create', resource: 'roles', action: 'create', description: 'Create roles' },
  {
    name: 'roles:update',
    resource: 'roles',
    action: 'update',
    description: 'Update roles and their assigned permissions',
  },
  {
    name: 'roles:delete',
    resource: 'roles',
    action: 'delete',
    description: 'Delete non-system roles',
  },
];

/** Default role → permission-name assignments, seeded for every new tenant. */
export const DEFAULT_ROLE_PERMISSIONS: Record<'Owner' | 'Admin' | 'Member', string[]> = {
  Owner: PERMISSION_REGISTRY.map((p) => p.name),
  Admin: PERMISSION_REGISTRY.filter((p) => p.name !== 'roles:delete').map((p) => p.name),
  Member: ['users:read'],
};
