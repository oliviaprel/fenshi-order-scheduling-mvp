import { NextResponse } from "next/server";
import { toPublicUser } from "../../../modules/users/user.types";
import { requireUser } from "../../../server/auth/guards";
import { routeHandler } from "../../../server/http/route-handler";

export async function GET(request: Request): Promise<Response> {
  return routeHandler(request, async () => {
    const user = await requireUser({ allowPasswordChangeRequired: true });
    return NextResponse.json({ user: toPublicUser(user) });
  });
}
