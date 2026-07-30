import { randomUUID } from "node:crypto";

export function getRequestId(request: Request): string {
  return request.headers.get("x-request-id") || randomUUID();
}
