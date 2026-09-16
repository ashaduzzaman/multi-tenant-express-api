import { adminPrisma, disconnectAll } from "#/db/client.js";
import { syncPermissions } from "#/lib/sync-permissions.js";
import { logger } from "#/lib/logger.js";

async function main(): Promise<void> {
  await syncPermissions(adminPrisma);
  await disconnectAll();
}

main().catch((err: unknown) => {
  logger.error({ err }, "❌ permission sync failed");
  process.exit(1);
});
