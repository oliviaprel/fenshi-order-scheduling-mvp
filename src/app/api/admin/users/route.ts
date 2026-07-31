import { z } from "zod";
import {
  createManagedUser,
  listManagedUsers,
} from "../../../../modules/users/admin-user.service";
import { requireAdmin } from "../../../../server/auth/guards";
import { ApiError } from "../../../../server/http/api-error";
import { assertAllowedOrigin } from "../../../../server/http/origin";
import { parseJsonBody, routeHandler } from "../../../../server/http/route-handler";

const normalizedPhoneSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s-]/g, "").replace(/^\+86/, ""))
  .pipe(z.string().regex(/^1[3-9]\d{9}$/, "请输入有效的中国大陆手机号"));

const createManagedUserSchema = z
  .object({
    displayName: z.string().trim().min(1).max(50),
    phone: normalizedPhoneSchema,
  })
  .strict();

const listManagedUsersSchema = z.object({
  query: z.string().trim().min(1).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

function parseListInput(request: Request): z.infer<typeof listManagedUsersSchema> {
  const url = new URL(request.url);
  const parsed = listManagedUsersSchema.safeParse({
    query: url.searchParams.get("query") ?? undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
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

export async function GET(request: Request): Promise<Response> {
  return routeHandler(request, async ({ request: routeRequest }) => {
    await requireAdmin();
    return Response.json(await listManagedUsers(parseListInput(routeRequest)));
  });
}

export async function POST(request: Request): Promise<Response> {
  return routeHandler(request, async ({ request: routeRequest, requestId }) => {
    assertAllowedOrigin(routeRequest);
    const actor = await requireAdmin();
    const input = await parseJsonBody(routeRequest, createManagedUserSchema);
    const result = await createManagedUser(input, { actorUserId: actor.id, requestId });
    return Response.json(result, { status: 201 });
  });
}
