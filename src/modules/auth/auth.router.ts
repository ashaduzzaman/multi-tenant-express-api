import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authMiddleware } from "#/middleware/auth.js";
import { loadPermissions } from "#/middleware/permissions.js";
import { tenantContextMiddleware } from "#/middleware/tenant-context.js";
import * as h from "./auth.handlers.js";

// Stricter than the app-wide limiter — these two endpoints are the ones
// worth protecting against credential-stuffing / slug-enumeration specifically.
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

const router = Router();

router.post("/register", authRateLimit, h.register);
router.post("/login", authRateLimit, h.login);
router.post("/refresh", h.refresh);
router.post("/logout", h.logout);
router.get(
  "/me",
  authMiddleware,
  tenantContextMiddleware,
  loadPermissions,
  h.me,
);

export { router as authRouter };
