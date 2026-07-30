export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors?: Record<string, string[]>;

  constructor(
    status: number,
    code: string,
    message: string,
    fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

export function toErrorResponse(error: unknown, requestId: string): Response {
  const apiError =
    error instanceof ApiError
      ? error
      : new ApiError(500, "INTERNAL_ERROR", "服务器内部错误，请稍后重试");

  return Response.json(
    {
      error: {
        code: apiError.code,
        message: apiError.message,
        ...(apiError.fieldErrors === undefined ? {} : { fieldErrors: apiError.fieldErrors }),
        requestId,
      },
    },
    { status: apiError.status },
  );
}
