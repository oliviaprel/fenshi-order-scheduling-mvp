import { NextResponse } from "next/server";
import { logout } from "../../../../modules/auth/session.service";
import {
  getCurrentSessionToken,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "../../../../server/auth/current-user";
import { assertAllowedOrigin } from "../../../../server/http/origin";
import { routeHandler } from "../../../../server/http/route-handler";

export async function POST(request: Request): Promise<Response> {
  return routeHandler(request, async ({ request: routeRequest }) => {
    assertAllowedOrigin(routeRequest);
    await logout(await getCurrentSessionToken());

    const response = new NextResponse(null, { status: 204 });
    response.cookies.set(SESSION_COOKIE, "", {
      ...sessionCookieOptions,
      maxAge: 0,
    });
    return response;
  });
}
