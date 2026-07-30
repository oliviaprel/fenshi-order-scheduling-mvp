import { Prisma } from "../../generated/prisma/client";
import { writeAudit } from "../audit/audit.service";
import { hashPassword } from "../auth/password";
import { prisma } from "../../server/db/client";
import { ApiError } from "../../server/http/api-error";
import { normalizeMainlandPhone, passwordSchema } from "./user.schemas";
import { toPublicUser, type PublicUser, type RequestContext } from "./user.types";

export async function createAdmin(
  input: { displayName: string; phone: string; password: string },
  context: RequestContext,
): Promise<PublicUser> {
  const phone = normalizeMainlandPhone(input.phone);
  const password = passwordSchema.parse(input.password);
  const passwordHash = await hashPassword(password);

  try {
    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          role: "ADMIN",
          displayName: input.displayName,
          phone,
          passwordHash,
          status: "ACTIVE",
          mustChangePassword: false,
        },
      });
      const publicUser = toPublicUser(user);

      await writeAudit(tx, {
        actorUserId: context.actorUserId,
        action: "ADMIN_CREATED",
        targetType: "User",
        targetId: user.id,
        after: publicUser,
        requestId: context.requestId,
      });

      return publicUser;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ApiError(409, "PHONE_ALREADY_EXISTS", "Phone number already exists");
    }

    throw error;
  }
}
