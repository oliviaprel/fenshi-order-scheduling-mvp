import { randomUUID } from "node:crypto";

export function isAcceptedRequestId(value: string): boolean {
  return value.length <= 64 && /^[A-Za-z0-9._:-]+$/.test(value);
}

export function getRequestId(request: Request): string {
  const requestId = request.headers.get("x-request-id");
  return requestId !== null && isAcceptedRequestId(requestId) ? requestId : randomUUID();
}
