import { randomBytes } from "node:crypto";
import { Prisma, type UserStatus } from "../../generated/prisma/client";
import { prisma } from "../../server/db/client";
import { ApiError } from "../../server/http/api-error";
import { writeAudit } from "../audit/audit.service";
import { hashPassword } from "../auth/password";
import { normalizeMainlandPhone } from "./user.schemas";
import { toPublicUser, type PublicUser } from "./user.types";

export type AdminContext = {
  actorUserId: string;
  requestId: string;
};

function generateTemporaryPassword(): string {
  return randomBytes(18).toString("base64url");
}

function normalizedPhoneQuery(query: string): string {
  return query.trim().replace(/[\s-]/g, "").replace(/^\+86/, "");
}

function phoneAlreadyExistsError(): ApiError {
  return new ApiError(409, "PHONE_ALREADY_EXISTS", "手机号已存在");
}

async function throwManagedTargetError(
  tx: Prisma.TransactionClient,
  id: string,
  expectedVersion?: number,
): Promise<never> {
  const target = await tx.user.findUnique({
    where: { id },
    select: { role: true, version: true },
  });

  if (target === null) {
    throw new ApiError(404, "USER_NOT_FOUND", "用户不存在");
  }
  if (target.role !== "USER") {
    throw new ApiError(403, "USER_ROLE_FORBIDDEN", "管理员账号不能通过用户管理修改");
  }
  if (expectedVersion !== undefined && target.version !== expectedVersion) {
    throw new ApiError(409, "USER_VERSION_CONFLICT", "用户已被其他管理员修改，请刷新后重试");
  }

  throw new ApiError(409, "USER_VERSION_CONFLICT", "用户已被其他管理员修改，请刷新后重试");
}

export async function listManagedUsers(input: {
  query?: string;
  cursor?: string;
  limit: number;
}): Promise<{ items: PublicUser[]; nextCursor: string | null }> {
  const query = input.query?.trim();
  const users = await prisma.user.findMany({
    where: {
      role: "USER",
      ...(input.cursor === undefined ? {} : { id: { gt: input.cursor } }),
      ...(query === undefined || query.length === 0
        ? {}
        : {
            OR: [
              { displayName: { contains: query, mode: "insensitive" } },
              { phone: { contains: normalizedPhoneQuery(query) } },
            ],
          }),
    },
    orderBy: { id: "asc" },
    take: input.limit + 1,
  });

  const hasNextPage = users.length > input.limit;
  const page = hasNextPage ? users.slice(0, input.limit) : users;
  return {
    items: page.map(toPublicUser),
    nextCursor: hasNextPage ? (page.at(-1)?.id ?? null) : null,
  };
}

export async function createManagedUser(
  input: { displayName: string; phone: string },
  context: AdminContext,
): Promise<{ user: PublicUser; temporaryPassword: string }> {
  const phone = normalizeMainlandPhone(input.phone);
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  try {
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          role: "USER",
          displayName: input.displayName,
          phone,
          passwordHash,
          status: "ACTIVE",
          mustChangePassword: true,
        },
      });
      const publicUser = toPublicUser(created);

      await writeAudit(tx, {
        actorUserId: context.actorUserId,
        action: "USER_CREATED",
        targetType: "User",
        targetId: created.id,
        after: publicUser,
        requestId: context.requestId,
      });

      return publicUser;
    });

    return { user, temporaryPassword };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw phoneAlreadyExistsError();
    }
    throw error;
  }
}

export async function updateManagedUser(
  id: string,
  input: {
    displayName: string;
    phone: string;
    status: UserStatus;
    version: number;
  },
  context: AdminContext,
): Promise<PublicUser> {
  const phone = normalizeMainlandPhone(input.phone);

  try {
    return await prisma.$transaction(async (tx) => {
      const result = await tx.user.updateMany({
        where: { id, version: input.version, role: "USER" },
        data: {
          displayName: input.displayName,
          phone,
          status: input.status,
          version: { increment: 1 },
        },
      });
      if (result.count === 0) {
        return throwManagedTargetError(tx, id, input.version);
      }

      if (input.status === "DISABLED") {
        await tx.session.deleteMany({ where: { userId: id } });
      }

      const updated = await tx.user.findUniqueOrThrow({ where: { id } });
      const publicUser = toPublicUser(updated);
      await writeAudit(tx, {
        actorUserId: context.actorUserId,
        action: input.status === "DISABLED" ? "USER_DISABLED" : "USER_UPDATED",
        targetType: "User",
        targetId: id,
        before: { version: input.version },
        after: publicUser,
        requestId: context.requestId,
      });

      return publicUser;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw phoneAlreadyExistsError();
    }
    throw error;
  }
}

export async function resetManagedUserPassword(
  id: string,
  context: AdminContext,
): Promise<{ temporaryPassword: string }> {
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  await prisma.$transaction(async (tx) => {
    const result = await tx.user.updateMany({
      where: { id, role: "USER" },
      data: {
        passwordHash,
        mustChangePassword: true,
        passwordChangedAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (result.count === 0) {
      return throwManagedTargetError(tx, id);
    }

    await tx.session.deleteMany({ where: { userId: id } });
    const updated = await tx.user.findUniqueOrThrow({ where: { id } });
    await writeAudit(tx, {
      actorUserId: context.actorUserId,
      action: "USER_PASSWORD_RESET",
      targetType: "User",
      targetId: id,
      after: {
        mustChangePassword: updated.mustChangePassword,
        version: updated.version,
      },
      requestId: context.requestId,
    });
  });

  return { temporaryPassword };
}
