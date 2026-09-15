import type { Request } from 'express';

export interface PaginationParams {
  page: number;
  pageSize: number;
  sort: string;
  order: 'asc' | 'desc';
}

export interface PaginatedResult<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

export function parsePaginationParams(req: Request, allowedSorts: string[]): PaginationParams {
  // NOTE: deliberately NOT `parseInt(...) || default` — that treats an
  // explicit `0` the same as "not provided", which silently produces the
  // wrong clamp (pageSize=0 would fall back to 20 instead of clamping to 1).
  const pageRaw = parseInt(req.query.page as string, 10);
  const page = Math.max(1, Number.isNaN(pageRaw) ? 1 : pageRaw);

  const pageSizeRaw = parseInt(req.query.pageSize as string, 10);
  const pageSize = Math.min(100, Math.max(1, Number.isNaN(pageSizeRaw) ? 20 : pageSizeRaw));

  const defaultSort = allowedSorts[0];
  if (defaultSort === undefined) {
    throw new Error('parsePaginationParams requires at least one allowed sort column');
  }
  const sortRaw = req.query.sort as string;
  const sort = allowedSorts.includes(sortRaw) ? sortRaw : defaultSort;
  const order = req.query.order === 'desc' ? 'desc' : 'asc';
  return { page, pageSize, sort, order };
}
