import { describe, expect, it } from "vitest";
import { loginInput, registerInput } from "./auth.schema.js";

describe("registerInput", () => {
  const valid = {
    tenantName: "Acme Inc.",
    tenantSlug: "acme",
    email: "owner@acme.test",
    password: "correct-horse-battery",
    name: "Ada Owner",
  };

  it("accepts a valid payload", () => {
    expect(registerInput.parse(valid)).toEqual(valid);
  });

  it("rejects an uppercase or symbol-containing slug", () => {
    expect(
      registerInput.safeParse({ ...valid, tenantSlug: "Acme_Inc" }).success,
    ).toBe(false);
  });

  it("rejects a password shorter than 8 characters", () => {
    expect(
      registerInput.safeParse({ ...valid, password: "short" }).success,
    ).toBe(false);
  });

  it("rejects an invalid email", () => {
    expect(
      registerInput.safeParse({ ...valid, email: "not-an-email" }).success,
    ).toBe(false);
  });

  it("rejects a missing tenantName", () => {
    const { tenantName: _tenantName, ...rest } = valid;
    expect(registerInput.safeParse(rest).success).toBe(false);
  });
});

describe("loginInput", () => {
  it("accepts a valid payload", () => {
    const valid = {
      tenantSlug: "acme",
      email: "owner@acme.test",
      password: "anything",
    };
    expect(loginInput.parse(valid)).toEqual(valid);
  });

  it("rejects an empty password (but does not enforce a minimum length policy)", () => {
    expect(
      loginInput.safeParse({
        tenantSlug: "acme",
        email: "owner@acme.test",
        password: "",
      }).success,
    ).toBe(false);
  });

  it("rejects a missing tenantSlug", () => {
    expect(
      loginInput.safeParse({ email: "owner@acme.test", password: "x" }).success,
    ).toBe(false);
  });
});
