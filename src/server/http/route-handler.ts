import { AsyncLocalStorage } from "node:async_hooks";
import { NextRequest } from "next/server";
import type { ZodType } from "zod";
import { ApiError, toErrorResponse } from "./api-error";
import { getRequestId } from "./request-id";

type RouteContext = {
  request: NextRequest;
  requestId: string;
};

type RouteAction = (context: RouteContext) => Promise<Response>;

const routeContextStorage = new AsyncLocalStorage<RouteContext>();

export const MAX_JSON_BODY_BYTES = 32 * 1024;

export function getRouteContext(): RouteContext | undefined {
  return routeContextStorage.getStore();
}

export async function parseJsonBody<T>(
  request: Request,
  schema: ZodType<T>,
  maxBytes = MAX_JSON_BODY_BYTES,
): Promise<T> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > maxBytes) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", "请求体过大");
  }

  const chunks: Uint8Array[] = [];
  let bytesRead = 0;

  if (request.body !== null) {
    const reader = request.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const bytesToKeep = Math.min(value.byteLength, maxBytes + 1 - bytesRead);
        if (bytesToKeep > 0) {
          chunks.push(value.slice(0, bytesToKeep));
          bytesRead += bytesToKeep;
        }

        if (bytesRead > maxBytes) {
          await reader.cancel();
          throw new ApiError(413, "PAYLOAD_TOO_LARGE", "请求体过大");
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  let body: unknown;
  try {
    const bodyBytes = new Uint8Array(bytesRead);
    let offset = 0;
    for (const chunk of chunks) {
      bodyBytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    body = JSON.parse(new TextDecoder().decode(bodyBytes));
  } catch {
    throw new ApiError(400, "INVALID_JSON", "请求体必须是有效的 JSON");
  }

  const parsed = schema.safeParse(body);
  if (parsed.success) {
    return parsed.data;
  }

  const fieldErrors: Record<string, string[]> = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path.join(".") || "_root";
    (fieldErrors[field] ??= []).push(issue.message);
  }
  throw new ApiError(422, "VALIDATION_ERROR", "输入不合法", fieldErrors);
}

export async function routeHandler(request: Request, action: RouteAction): Promise<Response> {
  const requestId = getRequestId(request);
  const context: RouteContext = {
    request: "cookies" in request ? (request as NextRequest) : new NextRequest(request),
    requestId,
  };

  return routeContextStorage.run(context, async () => {
    try {
      const response = await action(context);
      response.headers.set("x-request-id", requestId);
      return response;
    } catch (error) {
      const response = toErrorResponse(error, requestId);
      response.headers.set("x-request-id", requestId);
      return response;
    }
  });
}
