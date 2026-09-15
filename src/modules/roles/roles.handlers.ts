import type { Request, Response } from "express";
import { asyncHandler } from "#/lib/async-handler.js";
import { parsePaginationParams } from "#/lib/pagination.js";
import { requireParam } from "#/lib/request-params.js";
import { requireTenantId } from "#/middleware/tenant-context.js";
import { rolesService } from "./roles.service.js";
import { createRoleInput, updateRoleInput } from "./roles.schema.js";

const ALLOWED_SORTS = ["name", "createdAt"];

export const list = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = requireTenantId(req);
  const params = parsePaginationParams(req, ALLOWED_SORTS);
  const result = await rolesService.list(tenantId, params);
  res.json({
    data: result.data,
    page: result.page,
    pageSize: result.pageSize,
    total: result.total,
  });
});

export const listPermissions = asyncHandler(
  async (req: Request, res: Response) => {
    const tenantId = requireTenantId(req);
    const permissions = await rolesService.listPermissions(tenantId);
    res.json({ data: permissions });
  },
);

export const create = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = requireTenantId(req);
  const input = createRoleInput.parse(req.body);
  const role = await rolesService.create(tenantId, input);
  res.status(201).json({ data: role });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = requireTenantId(req);
  const input = updateRoleInput.parse(req.body);
  const role = await rolesService.update(
    tenantId,
    requireParam(req, "id"),
    input,
  );
  res.json({ data: role });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = requireTenantId(req);
  await rolesService.remove(tenantId, requireParam(req, "id"));
  res.status(204).send();
});
