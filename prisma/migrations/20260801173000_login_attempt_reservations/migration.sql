-- CreateTable
CREATE TABLE "LoginAttemptReservation" (
    "id" UUID NOT NULL,
    "phoneKeyHash" CHAR(64) NOT NULL,
    "ipKeyHash" CHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAttemptReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoginAttemptReservation_phoneKeyHash_expiresAt_idx"
ON "LoginAttemptReservation"("phoneKeyHash", "expiresAt");

-- CreateIndex
CREATE INDEX "LoginAttemptReservation_ipKeyHash_expiresAt_idx"
ON "LoginAttemptReservation"("ipKeyHash", "expiresAt");
