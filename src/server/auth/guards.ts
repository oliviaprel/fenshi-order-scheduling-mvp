import type { AuthenticatedUser } from "../../modules/auth/auth.types";
import { ApiError } from "../http/api-error";
import { getCurrentUser } from "./current-user";

export async function requireUser(options?: {
  allowPasswordChangeRequired?: boolean;
}): Promise<AuthenticatedUser> {
  const user = await getCurrentUser();
  if (user === null) {
    throw new ApiError(401, "UNAUTHENTICATED", "请先登录");
  }
  if (user.mustChangePassword && options?.allowPasswordChangeRequired !== true) {
    throw new ApiError(403, "PASSWORD_CHANGE_REQUIRED", "请先修改密码");
  }
  return user;
}

export async function requireAdmin(): Promise<AuthenticatedUser & { role: "ADMIN" }> {
  const user = await requireUser();
  if (user.role !== "ADMIN") {
    throw new ApiError(403, "ADMIN_REQUIRED", "需要管理员权限");
  }
  return { ...user, role: "ADMIN" };
}
