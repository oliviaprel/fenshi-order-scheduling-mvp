DROP INDEX "Session_expiresAt_idx";

CREATE INDEX "Session_expiresAt_id_idx" ON "Session"("expiresAt", "id");

CREATE INDEX "LoginAttemptReservation_expiresAt_id_idx"
ON "LoginAttemptReservation"("expiresAt", "id");

CREATE INDEX "LoginThrottle_updatedAt_blockedUntil_keyHash_idx"
ON "LoginThrottle"("updatedAt", "blockedUntil", "keyHash");
