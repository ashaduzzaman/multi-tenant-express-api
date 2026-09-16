import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createRoleInput, updateRoleInput } from "./roles.schema.js";

describe("createRoleInput", () => {
  it("accepts a name with no permissionIds", () => {
    expect(createRoleInput.parse({ name: "Support" })).toEqual({
      name: "Support",
    });
  });

  it("accepts a name with permissionIds", () => {
    const id = randomUUID();
    expect(
      createRoleInput.parse({ name: "Support", permissionIds: [id] }),
    ).toEqual({
      name: "Support",
      permissionIds: [id],
    });
  });

  it("rejects an empty name", () => {
    expect(createRoleInput.safeParse({ name: "" }).success).toBe(false);
  });

  it("rejects a non-uuid permission id", () => {
    expect(
      createRoleInput.safeParse({ name: "X", permissionIds: ["not-a-uuid"] })
        .success,
    ).toBe(false);
  });
});

describe("updateRoleInput", () => {
  it("accepts a partial payload (name only)", () => {
    expect(updateRoleInput.parse({ name: "Renamed" })).toEqual({
      name: "Renamed",
    });
  });

  it("accepts a partial payload (permissionIds only)", () => {
    expect(updateRoleInput.parse({ permissionIds: [] })).toEqual({
      permissionIds: [],
    });
  });

  it("accepts an empty object (no-op update)", () => {
    expect(updateRoleInput.parse({})).toEqual({});
  });

  it("rejects an empty name when provided", () => {
    expect(updateRoleInput.safeParse({ name: "" }).success).toBe(false);
  });
});
