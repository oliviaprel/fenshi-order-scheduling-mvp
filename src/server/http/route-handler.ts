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

export function getRouteContext(): RouteContext | undefined {
  return routeContextStorage.getStore();
}

export async function parseJsonBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
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
    request:
      request instanceof NextRequest && request.cookies !== undefined
        ? request
        : new NextRequest(request),
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
