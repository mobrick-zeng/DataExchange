-- CreateEnum
CREATE TYPE "InvitationPurpose" AS ENUM ('NEW_ACCOUNT', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "ResetRequestStatus" AS ENUM ('PENDING', 'RESOLVED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditActionType" ADD VALUE 'REQUEST_PASSWORD_RESET';
ALTER TYPE "AuditActionType" ADD VALUE 'ISSUE_PASSWORD_RESET';

-- AlterTable
ALTER TABLE "invitations" ADD COLUMN     "purpose" "InvitationPurpose" NOT NULL DEFAULT 'NEW_ACCOUNT';

-- CreateTable
CREATE TABLE "password_reset_requests" (
    "requestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "bankCode" TEXT NOT NULL,
    "status" "ResetRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,

    CONSTRAINT "password_reset_requests_pkey" PRIMARY KEY ("requestId")
);

-- CreateIndex
CREATE INDEX "password_reset_requests_status_idx" ON "password_reset_requests"("status");

-- AddForeignKey
ALTER TABLE "password_reset_requests" ADD CONSTRAINT "password_reset_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("userId") ON DELETE CASCADE ON UPDATE CASCADE;
