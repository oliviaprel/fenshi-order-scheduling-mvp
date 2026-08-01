import { NextResponse } from "next/server";
import { routeHandler } from "../../../../server/http/route-handler";

export async function GET(request: Request): Promise<Response> {
  return routeHandler(request, async () => NextResponse.json({ status: "ok" }));
}
