import { z } from "zod";

const mainlandPhonePattern = /^1[3-9]\d{9}$/;

export function normalizeMainlandPhone(input: string): string {
  const normalized = input.replace(/[\s-]/g, "").replace(/^\+86/, "");

  if (!mainlandPhonePattern.test(normalized)) {
    throw new Error("请输入有效的中国大陆手机号");
  }

  return normalized;
}

export const passwordSchema = z.string().min(10).max(72);
