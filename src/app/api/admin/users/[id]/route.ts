import { z } from "zod";
import { updateManagedUser } from "../../../../../modules/users/admin-user.service";
import { requireAdmin } from "../../../../../server/auth/guards";
import { ApiError } from "../../../../../server/http/api-error";
import { assertAllowedOrigin } from "../../../../../server/http/origin";
import { parseJsonBody, routeHandler } from "../../../../../server/http/route-handler";

type UserRouteContext = {
  params: Promise<{ id: string }>;
};

const userIdSchema = z.string().uuid();

const normalizedPhoneSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s-]/g, "").replace(/^\+86/, ""))
  .pipe(z.string().regex(/^1[3-9]\d{9}$/, "请输入有效的中国大陆手机号"));

const updateManagedUserSchema = z
  .object({
    displayName: z.string().trim().min(1).max(50),
    phone: normalizedPhoneSchema,
    status: z.enum(["ACTIVE", "PAUSED", "DISABLED"]),
    version: z.number().int().min(1),
  })
  .strict();

function parseUserId(id: string): string {
  const parsed = userIdSchema.safeParse(id);
  if (parsed.success) {
    return parsed.data;
  }
  throw new ApiError(422, "VALIDATION_ERROR", "输入不合法", {
    id: parsed.error.issues.map((issue) => issue.message),
  });
}

export async function PATCH(request: Request, context: UserRouteContext): Promise<Response> {
  return routeHandler(request, async ({ request: routeRequest, requestId }) => {
    assertAllowedOrigin(routeRequest);
    const actor = await requireAdmin();
    const id = parseUserId((await context.params).id);
    const input = await parseJsonBody(routeRequest, updateManagedUserSchema);
    const user = await updateManagedUser(id, input, { actorUserId: actor.id, requestId });
    return Response.json({ user });
  });
}
