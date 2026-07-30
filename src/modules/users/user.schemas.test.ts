import { describe, expect, it } from "vitest";
import { normalizeMainlandPhone, passwordSchema } from "./user.schemas";

describe("user input rules", () => {
  it.each([
    ["+86 138-0013-8000", "13800138000"],
    ["13800138000", "13800138000"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeMainlandPhone(input)).toBe(expected);
  });

  it.each(["12800138000", "1380013800", "138001380000", "1380013800a"])(
    "rejects invalid mainland mobile number %s",
    (input) => {
      expect(() => normalizeMainlandPhone(input)).toThrow();
    },
  );

  it("accepts only 10 to 72 character passwords", () => {
    expect(passwordSchema.safeParse("123456789").success).toBe(false);
    expect(passwordSchema.safeParse("1234567890").success).toBe(true);
    expect(passwordSchema.safeParse("x".repeat(72)).success).toBe(true);
    expect(passwordSchema.safeParse("x".repeat(73)).success).toBe(false);
  });
});
