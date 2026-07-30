import { getEnv } from "../../lib/env";
import { ApiError } from "./api-error";

export function assertAllowedOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const allowedOrigin = new URL(getEnv().APP_ORIGIN).origin;

  if (origin === allowedOrigin || (origin === null && ["GET", "HEAD"].includes(request.method))) {
    return;
  }

  throw new ApiError(403, "ORIGIN_NOT_ALLOWED", "请求来源不被允许");
}
