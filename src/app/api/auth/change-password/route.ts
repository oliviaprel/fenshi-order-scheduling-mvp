import { NextResponse } from "next/server";
import { changeOwnPasswordInputSchema } from "../../../../modules/auth/auth.schemas";
import { changeOwnPassword } from "../../../../modules/auth/auth.service";
import { hashSessionToken } from "../../../../modules/auth/session-token";
import { getCurrentSessionToken } from "../../../../server/auth/current-user";
import { requireUser } from "../../../../server/auth/guards";
import { ApiError } from "../../../../server/http/api-error";
import { assertAllowedOrigin } from "../../../../server/http/origin";
import { parseJsonBody, routeHandler } from "../../../../server/http/route-handler";

export async function POST(request: Request): Promise<Response> {
  return routeHandler(request, async ({ request: routeRequest, requestId }) => {
    assertAllowedOrigin(routeRequest);
    const actor = await requireUser({ allowPasswordChangeRequired: true });
    const input = await parseJsonBody(routeRequest, changeOwnPasswordInputSchema);
    const token = await getCurrentSessionToken();
    if (token === undefined) {
      throw new ApiError(401, "UNAUTHENTICATED", "请先登录");
    }

    await changeOwnPassword(actor, input, {
      requestId,
      currentTokenHash: hashSessionToken(token),
    });
    return new NextResponse(null, { status: 204 });
  });
}
