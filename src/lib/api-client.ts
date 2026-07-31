import type { PublicUser } from "../modules/users/user.types";

type ApiErrorEnvelope = {
  error: {
    code: string;
    message: string;
    fieldErrors?: Record<string, string[]>;
    requestId: string;
  };
};

export class ApiClientError extends Error {
  readonly code: string;
  readonly fieldErrors?: Record<string, string[]>;
  readonly requestId?: string;

  constructor(error: ApiErrorEnvelope["error"]) {
    super(error.message);
    this.name = "ApiClientError";
    this.code = error.code;
    this.fieldErrors = error.fieldErrors;
    this.requestId = error.requestId;
  }
}

async function request(path: string, body?: unknown): Promise<Response> {
  const response = await fetch(path, {
    method: "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    const envelope = (await response.json()) as ApiErrorEnvelope;
    throw new ApiClientError(envelope.error);
  }
  return response;
}

export async function login(input: { phone: string; password: string }): Promise<PublicUser> {
  const response = await request("/api/auth/login", input);
  const body = (await response.json()) as { user: PublicUser };
  return body.user;
}

export async function changePassword(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<void> {
  await request("/api/auth/change-password", input);
}

export async function logout(): Promise<void> {
  await request("/api/auth/logout");
}
