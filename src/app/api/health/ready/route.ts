import { NextResponse } from "next/server";
import { prisma } from "../../../../server/db/client";
import { routeHandler } from "../../../../server/http/route-handler";
import { logger } from "../../../../server/logging/logger";

export async function GET(request: Request): Promise<Response> {
  return routeHandler(request, async ({ requestId }) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return NextResponse.json({ status: "ok" });
    } catch (error) {
      logger.error("database readiness check failed", {
        requestId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      return NextResponse.json({ status: "unavailable" }, { status: 503 });
    }
  });
}
