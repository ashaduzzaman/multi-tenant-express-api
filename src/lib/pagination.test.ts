import type { Request } from "express";
import { describe, expect, it } from "vitest";
import { parsePaginationParams } from "./pagination.js";

function fakeRequest(query: Record<string, string>): Request {
  return { query } as unknown as Request;
}

describe("parsePaginationParams", () => {
  it("defaults to page 1, pageSize 20, first allowed sort, ascending", () => {
    const params = parsePaginationParams(fakeRequest({}), [
      "name",
      "createdAt",
    ]);
    expect(params).toEqual({
      page: 1,
      pageSize: 20,
      sort: "name",
      order: "asc",
    });
  });

  it("parses valid page/pageSize/sort/order from the query", () => {
    const params = parsePaginationParams(
      fakeRequest({
        page: "3",
        pageSize: "50",
        sort: "createdAt",
        order: "desc",
      }),
      ["name", "createdAt"],
    );
    expect(params).toEqual({
      page: 3,
      pageSize: 50,
      sort: "createdAt",
      order: "desc",
    });
  });

  it("clamps page below 1 up to 1", () => {
    expect(
      parsePaginationParams(fakeRequest({ page: "0" }), ["name"]).page,
    ).toBe(1);
    expect(
      parsePaginationParams(fakeRequest({ page: "-5" }), ["name"]).page,
    ).toBe(1);
  });

  it("clamps pageSize to the [1, 100] range", () => {
    expect(
      parsePaginationParams(fakeRequest({ pageSize: "0" }), ["name"]).pageSize,
    ).toBe(1);
    expect(
      parsePaginationParams(fakeRequest({ pageSize: "1000" }), ["name"])
        .pageSize,
    ).toBe(100);
  });

  it("falls back to the first allowed sort when sort is not in the allow-list", () => {
    const params = parsePaginationParams(
      fakeRequest({ sort: "dROP TABLE users" }),
      ["name", "createdAt"],
    );
    expect(params.sort).toBe("name");
  });

  it('treats anything other than "desc" as ascending', () => {
    expect(
      parsePaginationParams(fakeRequest({ order: "DESC" }), ["name"]).order,
    ).toBe("asc");
    expect(
      parsePaginationParams(fakeRequest({ order: "desc" }), ["name"]).order,
    ).toBe("desc");
  });

  it("ignores non-numeric page/pageSize and falls back to defaults", () => {
    const params = parsePaginationParams(
      fakeRequest({ page: "abc", pageSize: "xyz" }),
      ["name"],
    );
    expect(params.page).toBe(1);
    expect(params.pageSize).toBe(20);
  });
});
