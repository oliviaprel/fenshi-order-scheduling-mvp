import type { User } from "../../generated/prisma/client";
import type { RequestContext } from "../users/user.types";
import { toPublicUser } from "../users/user.types";
import { prisma } from "../../server/db/client";
import { ApiError } from "../../server/http/api-error";
import { writeAudit } from "../audit/audit.service";
import { normalizeMainlandPhone, passwordSchema } from "../users/user.schemas";
import type { AuthenticatedUser, LoginContext, LoginResult } from "./auth.types";
import { hashPassword, verifyPassword } from "./password";
import {
  completeSuccessfulLogin,
  releaseLoginAttempt,
  recordLoginFailure,
  reserveLoginAttempt,
} from "./login-throttle.service";
import { createSession } from "./session.service";

const dummyPasswordHash = hashPassword("dummy-password-never-authenticates");

function invalidCredentialsError(): ApiError {
  return new ApiError(401, "INVALID_CREDENTIALS", "手机号或密码错误");
}

export async function login(
  input: { phone: string; password: string },
  context: LoginContext,
): Promise<LoginResult> {
  const phone = normalizeMainlandPhone(input.phone);
  const reservationId = await reserveLoginAttempt(phone, context.ip, context.now);

  let user: User | null;
  let passwordMatches: boolean;
  try {
    user = await prisma.user.findUnique({ where: { phone } });
    passwordMatches = await verifyPassword(
      user?.passwordHash ?? (await dummyPasswordHash),
      input.password,
    );
  } catch (error) {
    await releaseLoginAttempt(reservationId);
    throw error;
  }

  if (user === null || !passwordMatches || user.status === "DISABLED") {
    await recordLoginFailure(reservationId, phone, context.ip, context.now);
    throw invalidCredentialsError();
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const [currentUser] = await tx.$queryRaw<User[]>`
        SELECT *
        FROM "User"
        WHERE "id" = ${user.id}::uuid
        FOR UPDATE
      `;
      if (
        currentUser === undefined ||
        currentUser.status === "DISABLED" ||
        currentUser.passwordHash !== user.passwordHash ||
        currentUser.version !== user.version
      ) {
        throw invalidCredentialsError();
      }

      await completeSuccessfulLogin(tx, reservationId, phone, context.ip);
      const session = await createSession(tx, currentUser.id, context.now);
      const publicUser = toPublicUser(currentUser);

      await writeAudit(tx, {
        actorUserId: currentUser.id,
        action: "LOGIN_SUCCEEDED",
        targetType: "User",
        targetId: currentUser.id,
        after: { userId: currentUser.id, expiresAt: session.expiresAt },
        requestId: context.requestId,
      });

      return { user: publicUser, ...session };
    });
  } catch (error) {
    if (error instanceof ApiError && error.code === "INVALID_CREDENTIALS") {
      await recordLoginFailure(reservationId, phone, context.ip, context.now);
    } else {
      await releaseLoginAttempt(reservationId);
    }
    throw error;
  }
}

export async function changeOwnPassword(
  actor: AuthenticatedUser,
  input: { currentPassword: string; newPassword: string },
  context: RequestContext & { currentTokenHash: string },
): Promise<void> {
  const newPassword = passwordSchema.parse(input.newPassword);
  const user = await prisma.user.findUnique({ where: { id: actor.id } });
  if (user === null || !(await verifyPassword(user.passwordHash, input.currentPassword))) {
    throw new ApiError(401, "INVALID_CURRENT_PASSWORD", "当前密码错误");
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.$transaction(async (tx) => {
    const updated = await tx.user.updateMany({
      where: {
        id: actor.id,
        passwordHash: user.passwordHash,
        version: user.version,
      },
      data: {
        passwordHash,
        passwordChangedAt: new Date(),
        mustChangePassword: false,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      throw new ApiError(409, "USER_CHANGED", "用户信息已发生变化，请重试");
    }

    await tx.session.deleteMany({
      where: {
        userId: actor.id,
        tokenHash: { not: context.currentTokenHash },
      },
    });

    await writeAudit(tx, {
      actorUserId: actor.id,
      action: "PASSWORD_CHANGED",
      targetType: "User",
      targetId: actor.id,
      before: { mustChangePassword: user.mustChangePassword, version: user.version },
      after: { mustChangePassword: false, version: user.version + 1 },
      requestId: context.requestId,
    });
  });
}
