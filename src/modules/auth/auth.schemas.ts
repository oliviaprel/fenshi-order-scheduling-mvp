import { z } from "zod";
import { normalizeMainlandPhone, passwordSchema } from "../users/user.schemas";

const phoneSchema = z.string().transform((value, context) => {
  try {
    return normalizeMainlandPhone(value);
  } catch {
    context.addIssue({ code: "custom", message: "请输入有效的中国大陆手机号" });
    return z.NEVER;
  }
});

export const loginInputSchema = z
  .object({
    phone: phoneSchema,
    password: z.string().min(1).max(72),
  })
  .strict();

export const changeOwnPasswordInputSchema = z
  .object({
    currentPassword: z.string().min(1).max(72),
    newPassword: passwordSchema,
  })
  .strict();
