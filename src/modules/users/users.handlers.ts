import type { Request, Response } from "express";
import { asyncHandler } from "#/lib/async-handler.js";
import { parsePaginationParams } from "#/lib/pagination.js";
import { UnauthorizedError } from "#/lib/errors.js";
import { requireParam } from "#/lib/request-params.js";
import { requireTenantId } from "#/middleware/tenant-context.js";
import { usersService } from "./users.service.js";
import {
  changePasswordInput,
  createUserInput,
  updateUserInput,
} from "./users.schema.js";

const ALLOWED_SORTS = ["name", "email", "createdAt"];

export const list = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = requireTenantId(req);
  const params = parsePaginationParams(req, ALLOWED_SORTS);
  const result = await usersService.list(tenantId, params);
  res.json({
    data: result.data,
    page: result.page,
    pageSize: result.pageSize,
    total: result.total,
  });
});

export const get = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = requireTenantId(req);
  const user = await usersService.get(tenantId, requireParam(req, "id"));
  res.json({ data: user });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = requireTenantId(req);
  const input = createUserInput.parse(req.body);
  const user = await usersService.create(tenantId, input);
  res.status(201).json({ data: user });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = requireTenantId(req);
  const input = updateUserInput.parse(req.body);
  const user = await usersService.update(
    tenantId,
    requireParam(req, "id"),
    input,
  );
  res.json({ data: user });
});

export const changePassword = asyncHandler(
  async (req: Request, res: Response) => {
    const tenantId = requireTenantId(req);
    const input = changePasswordInput.parse(req.body);
    await usersService.changePassword(
      tenantId,
      requireParam(req, "id"),
      input.password,
    );
    res.status(200).json({ data: { message: "Password updated" } });
  },
);

export const remove = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = requireTenantId(req);
  const actingUserId = req.auth?.userId;
  if (!actingUserId) throw new UnauthorizedError();
  await usersService.remove(tenantId, actingUserId, requireParam(req, "id"));
  res.status(204).send();
});
