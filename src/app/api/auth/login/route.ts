import { NextResponse } from "next/server";
import { loginInputSchema } from "../../../../modules/auth/auth.schemas";
import { login } from "../../../../modules/auth/auth.service";
import {
  SESSION_COOKIE,
  sessionCookieOptions,
} from "../../../../server/auth/current-user";
import { getClientIp } from "../../../../server/http/client-ip";
import { assertAllowedOrigin } from "../../../../server/http/origin";
import { parseJsonBody, routeHandler } from "../../../../server/http/route-handler";

export async function POST(request: Request): Promise<Response> {
  return routeHandler(request, async ({ request: routeRequest, requestId }) => {
    assertAllowedOrigin(routeRequest);
    const input = await parseJsonBody(routeRequest, loginInputSchema);
    const result = await login(input, {
      ip: getClientIp(routeRequest),
      now: new Date(),
      requestId,
    });

    const response = NextResponse.json({ user: result.user });
    response.cookies.set(SESSION_COOKIE, result.token, sessionCookieOptions);
    return response;
  });
}
