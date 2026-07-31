import { z } from "zod";
import { resetManagedUserPassword } from "../../../../../../modules/users/admin-user.service";
import { requireAdmin } from "../../../../../../server/auth/guards";
import { ApiError } from "../../../../../../server/http/api-error";
import { assertAllowedOrigin } from "../../../../../../server/http/origin";
import { routeHandler } from "../../../../../../server/http/route-handler";

type ResetPasswordRouteContext = {
  params: Promise<{ id: string }>;
};

const userIdSchema = z.string().uuid();

function parseUserId(id: string): string {
  const parsed = userIdSchema.safeParse(id);
  if (parsed.success) {
    return parsed.data;
  }
  throw new ApiError(422, "VALIDATION_ERROR", "输入不合法", {
    id: parsed.error.issues.map((issue) => issue.message),
  });
}

export async function POST(
  request: Request,
  context: ResetPasswordRouteContext,
): Promise<Response> {
  return routeHandler(request, async ({ request: routeRequest, requestId }) => {
    assertAllowedOrigin(routeRequest);
    const actor = await requireAdmin();
    const id = parseUserId((await context.params).id);
    return Response.json(
      await resetManagedUserPassword(id, { actorUserId: actor.id, requestId }),
    );
  });
}
