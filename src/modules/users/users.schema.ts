import { z } from 'zod';

export const createUserInput = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(255),
  password: z.string().min(8).max(72),
  roleId: z.string().uuid(),
});
export type CreateUserInput = z.infer<typeof createUserInput>;

export const updateUserInput = z.object({
  email: z.string().email().optional(),
  name: z.string().min(1).max(255).optional(),
  roleId: z.string().uuid().optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserInput>;

export const changePasswordInput = z.object({
  password: z.string().min(8).max(72),
});
export type ChangePasswordInput = z.infer<typeof changePasswordInput>;
