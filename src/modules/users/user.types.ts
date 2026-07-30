import type { User } from "../../generated/prisma/client";

export type RequestContext = {
  requestId: string;
  actorUserId?: string;
};

export type PublicUser = {
  id: string;
  role: User["role"];
  displayName: string;
  phone: string;
  status: User["status"];
  mustChangePassword: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    role: user.role,
    displayName: user.displayName,
    phone: user.phone,
    status: user.status,
    mustChangePassword: user.mustChangePassword,
    version: user.version,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
