import { z } from "zod";

export const createRoleInput = z.object({
  name: z.string().min(1).max(100),
  permissionIds: z.array(z.string().uuid()).optional(),
});
export type CreateRoleInput = z.infer<typeof createRoleInput>;

export const updateRoleInput = z.object({
  name: z.string().min(1).max(100).optional(),
  permissionIds: z.array(z.string().uuid()).optional(),
});
export type UpdateRoleInput = z.infer<typeof updateRoleInput>;
