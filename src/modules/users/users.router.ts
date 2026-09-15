import { Router } from "express";
import { authMiddleware } from "#/middleware/auth.js";
import {
  loadPermissions,
  requirePermission,
  requireSelfOrPermission,
} from "#/middleware/permissions.js";
import { tenantContextMiddleware } from "#/middleware/tenant-context.js";
import * as h from "./users.handlers.js";

const router = Router();

router.use(authMiddleware, tenantContextMiddleware, loadPermissions);

router.get("/", requirePermission("users:read"), h.list);
router.get("/:id", requirePermission("users:read"), h.get);
router.post("/", requirePermission("users:create"), h.create);
router.put("/:id", requirePermission("users:update"), h.update);
// Anyone can change their OWN password; changing someone else's still needs users:update.
router.put(
  "/:id/password",
  requireSelfOrPermission("id", "users:update"),
  h.changePassword,
);
router.delete("/:id", requirePermission("users:delete"), h.remove);

export { router as usersRouter };
