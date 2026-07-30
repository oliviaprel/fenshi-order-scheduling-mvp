import type { PublicUser } from "../users/user.types";

export type LoginContext = {
  ip: string;
  now: Date;
  requestId: string;
};

export type AuthenticatedUser = PublicUser & {
  sessionId: string;
};

export type LoginResult = {
  user: PublicUser;
  token: string;
  expiresAt: Date;
};
