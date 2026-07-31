import type { PublicUser } from "../modules/users/user.types";

type ApiErrorEnvelope = {
  error: {
    code: string;
    message: string;
    fieldErrors?: Record<string, string[]>;
    requestId: string;
  };
};

export type ManagedUserDto = Omit<PublicUser, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};

export type ManagedUserList = {
  items: ManagedUserDto[];
  nextCursor: string | null;
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

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const envelope = (await response.json()) as ApiErrorEnvelope;
    throw new ApiClientError(envelope.error);
  }
  return response.json() as Promise<T>;
}

async function adminRequest<T>(
  path: string,
  options?: { method?: "GET" | "POST" | "PATCH"; body?: unknown },
): Promise<T> {
  const response = await fetch(path, {
    method: options?.method ?? "GET",
    headers: options?.body === undefined ? undefined : { "content-type": "application/json" },
    body: options?.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return parseResponse<T>(response);
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

export async function listAdminUsers(input: {
  query?: string;
  cursor?: string;
  limit: number;
}): Promise<ManagedUserList> {
  const params = new URLSearchParams({ limit: String(input.limit) });
  if (input.query !== undefined && input.query.length > 0) params.set("query", input.query);
  if (input.cursor !== undefined) params.set("cursor", input.cursor);
  return adminRequest<ManagedUserList>(`/api/admin/users?${params}`);
}

export async function createAdminUser(input: {
  displayName: string;
  phone: string;
}): Promise<{ user: ManagedUserDto; temporaryPassword: string }> {
  return adminRequest("/api/admin/users", { method: "POST", body: input });
}

export async function updateAdminUser(
  id: string,
  input: {
    displayName: string;
    phone: string;
    status: ManagedUserDto["status"];
    version: number;
  },
): Promise<ManagedUserDto> {
  const result = await adminRequest<{ user: ManagedUserDto }>(`/api/admin/users/${id}`, {
    method: "PATCH",
    body: input,
  });
  return result.user;
}

export async function resetAdminUserPassword(
  id: string,
): Promise<{ temporaryPassword: string }> {
  return adminRequest(`/api/admin/users/${id}/reset-password`, { method: "POST" });
}
