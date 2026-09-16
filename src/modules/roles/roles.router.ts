import { Router } from "express";
import { authMiddleware } from "#/middleware/auth.js";
import {
  loadPermissions,
  requirePermission,
} from "#/middleware/permissions.js";
import { tenantContextMiddleware } from "#/middleware/tenant-context.js";
import * as h from "./roles.handlers.js";

const router = Router();

router.use(authMiddleware, tenantContextMiddleware, loadPermissions);

router.get("/", requirePermission("roles:read"), h.list);
router.get("/permissions", requirePermission("roles:read"), h.listPermissions);
router.post("/", requirePermission("roles:create"), h.create);
router.put("/:id", requirePermission("roles:update"), h.update);
router.delete("/:id", requirePermission("roles:delete"), h.remove);

export { router as rolesRouter };
