import { z } from "zod";

export const registerInput = z.object({
  tenantName: z.string().min(1).max(255),
  tenantSlug: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/, "lowercase letters, numbers, and hyphens only"),
  email: z.string().email(),
  password: z.string().min(8).max(72),
  name: z.string().min(1).max(255),
});
export type RegisterInput = z.infer<typeof registerInput>;

export const loginInput = z.object({
  tenantSlug: z.string().min(1).max(64),
  email: z.string().email(),
  // No .min() beyond 1 here on purpose — never give a login-attacker a
  // password-policy oracle. Policy is enforced at registration time only.
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginInput>;
