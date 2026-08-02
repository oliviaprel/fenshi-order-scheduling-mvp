import { cookies } from "next/headers";
import { getEnv } from "../../lib/env";
import {
  authenticateSession,
  getSessionCookieName,
} from "../../modules/auth/session.service";
import type { AuthenticatedUser } from "../../modules/auth/auth.types";
import { getRouteContext } from "../http/route-handler";

export const SESSION_COOKIE = getSessionCookieName(getEnv().NODE_ENV);
export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: getEnv().NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 7,
};

export async function getCurrentSessionToken(): Promise<string | undefined> {
  const routeContext = getRouteContext();
  if (routeContext !== undefined) {
    return routeContext.request.cookies.get(SESSION_COOKIE)?.value;
  }

  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const user = await authenticateSession(await getCurrentSessionToken(), new Date());
  return user?.status === "DISABLED" ? null : user;
}
