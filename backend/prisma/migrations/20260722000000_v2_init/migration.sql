-- CreateEnum
CREATE TYPE "BankType" AS ENUM ('BANK', 'PLATFORM');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'BANK_STAFF', 'PLATFORM_AUDITOR');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('PENDING_ACTIVATION', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "AccessCodePurpose" AS ENUM ('ACTIVATION', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "ResetRequestStatus" AS ENUM ('PENDING', 'RESOLVED');

-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('DRAFT', 'PENDING_CONFIRMATION', 'IN_REPAYMENT', 'SETTLED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "ParticipantConfirmationStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'CONFIRMED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "CaseBankRole" AS ENUM ('MAIN', 'CO_BANK');

-- CreateEnum
CREATE TYPE "ClaimType" AS ENUM ('CREDIT_LOAN', 'CREDIT_CARD', 'GUARANTEE', 'OTHER');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('CASE_INVITATION', 'CASE_PUBLISHED', 'CONFIRMATION_DEADLINE_REMINDER', 'CASE_CONFIRMED_BY_BANK', 'CASE_DISPUTED_BY_BANK', 'ALL_BANKS_CONFIRMED', 'REPAYMENT_RECORDED', 'CASE_SETTLED', 'CASE_TERMINATED');

-- CreateEnum
CREATE TYPE "AuditActionType" AS ENUM ('LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT', 'ACCOUNT_CREATED', 'ACCOUNT_ACTIVATED', 'ACCOUNT_SUSPENDED', 'ACCOUNT_REACTIVATED', 'ACCOUNT_LOCKED', 'ACCOUNT_UNLOCKED', 'CONSENT_GIVEN', 'PASSWORD_CHANGED', 'PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET_ISSUED', 'CASE_CREATED', 'CASE_UPDATED', 'PARTICIPANT_INVITED', 'CASE_PUBLISHED', 'CASE_CONFIRMED', 'CASE_DISPUTED', 'PLAN_RATIO_UPDATED', 'REPAYMENT_RECORDED', 'CASE_SETTLED', 'CASE_TERMINATED', 'INTERNAL_TOTAL_VIEWED', 'BANK_ACTIVATED', 'BANK_DEACTIVATED', 'COURT_ACTIVATED', 'COURT_DEACTIVATED');

-- CreateTable
CREATE TABLE "banks" (
    "bankCode" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "type" "BankType" NOT NULL DEFAULT 'BANK',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "banks_pkey" PRIMARY KEY ("bankCode")
);

-- CreateTable
CREATE TABLE "courts" (
    "courtCode" TEXT NOT NULL,
    "courtName" TEXT NOT NULL,
    "courtType" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courts_pkey" PRIMARY KEY ("courtCode")
);

-- CreateTable
CREATE TABLE "users" (
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "department" TEXT,
    "title" TEXT,
    "passwordHash" TEXT,
    "bankCode" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "accountStatus" "AccountStatus" NOT NULL DEFAULT 'PENDING_ACTIVATION',
    "activatedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "consentedAt" TIMESTAMP(3),
    "consentVersion" TEXT,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "access_codes" (
    "codeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" "AccessCodePurpose" NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_codes_pkey" PRIMARY KEY ("codeId")
);

-- CreateTable
CREATE TABLE "password_reset_requests" (
    "requestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ResetRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,

    CONSTRAINT "password_reset_requests_pkey" PRIMARY KEY ("requestId")
);

-- CreateTable
CREATE TABLE "cases" (
    "caseId" TEXT NOT NULL,
    "courtCode" TEXT NOT NULL,
    "docNumber" TEXT NOT NULL,
    "mainBankCode" TEXT NOT NULL,
    "receiptDate" TIMESTAMP(3),
    "confirmationDeadline" TIMESTAMP(3),
    "status" "CaseStatus" NOT NULL DEFAULT 'DRAFT',
    "monthlyInstallment" DECIMAL(21,4),
    "planInstallments" INTEGER,
    "planStartDate" TIMESTAMP(3),
    "totalDebtAmount" DECIMAL(21,4),
    "confirmedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "terminatedAt" TIMESTAMP(3),
    "terminationReason" TEXT,
    "createdBy" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cases_pkey" PRIMARY KEY ("caseId")
);

-- CreateTable
CREATE TABLE "case_participant_banks" (
    "participantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "bankCode" TEXT NOT NULL,
    "roleInCase" "CaseBankRole" NOT NULL,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "planRatio" DECIMAL(9,6) NOT NULL DEFAULT 0,
    "confirmationStatus" "ParticipantConfirmationStatus" NOT NULL DEFAULT 'PENDING',
    "confirmedBy" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "disputeReason" TEXT,
    "disputedAt" TIMESTAMP(3),
    "confirmedClaimAmount" DECIMAL(21,4),

    CONSTRAINT "case_participant_banks_pkey" PRIMARY KEY ("participantId")
);

-- CreateTable
CREATE TABLE "credit_items" (
    "itemId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "claimType" "ClaimType" NOT NULL,
    "principal" DECIMAL(21,4) NOT NULL DEFAULT 0,
    "interest" DECIMAL(21,4) NOT NULL DEFAULT 0,
    "penalty" DECIMAL(21,4) NOT NULL DEFAULT 0,
    "otherFee" DECIMAL(21,4) NOT NULL DEFAULT 0,
    "internalTotal" DECIMAL(21,4) NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "credit_items_pkey" PRIMARY KEY ("itemId")
);

-- CreateTable
CREATE TABLE "repayment_periods" (
    "periodId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "actualReceivedTotal" DECIMAL(21,4) NOT NULL,
    "hasRoundingAdjust" BOOLEAN NOT NULL DEFAULT false,
    "recordedBy" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "repayment_periods_pkey" PRIMARY KEY ("periodId")
);

-- CreateTable
CREATE TABLE "repayment_allocations" (
    "allocationId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "plannedAmount" DECIMAL(21,4) NOT NULL DEFAULT 0,
    "actualAmount" DECIMAL(21,4) NOT NULL DEFAULT 0,
    "roundingAdjustment" DECIMAL(21,4) NOT NULL DEFAULT 0,

    CONSTRAINT "repayment_allocations_pkey" PRIMARY KEY ("allocationId")
);

-- CreateTable
CREATE TABLE "notifications" (
    "notificationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "relatedCaseId" TEXT,
    "message" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("notificationId")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "logId" TEXT NOT NULL,
    "userId" TEXT,
    "bankCode" TEXT,
    "actionType" "AuditActionType" NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "detail" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("logId")
);

-- CreateIndex
CREATE INDEX "banks_isActive_idx" ON "banks"("isActive");

-- CreateIndex
CREATE INDEX "courts_isActive_idx" ON "courts"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_bankCode_idx" ON "users"("bankCode");

-- CreateIndex
CREATE INDEX "users_accountStatus_idx" ON "users"("accountStatus");

-- CreateIndex
CREATE INDEX "access_codes_userId_purpose_idx" ON "access_codes"("userId", "purpose");

-- CreateIndex
CREATE INDEX "password_reset_requests_status_idx" ON "password_reset_requests"("status");

-- CreateIndex
CREATE INDEX "cases_status_idx" ON "cases"("status");

-- CreateIndex
CREATE INDEX "cases_mainBankCode_idx" ON "cases"("mainBankCode");

-- CreateIndex
CREATE UNIQUE INDEX "cases_courtCode_docNumber_key" ON "cases"("courtCode", "docNumber");

-- CreateIndex
CREATE INDEX "case_participant_banks_bankCode_idx" ON "case_participant_banks"("bankCode");

-- CreateIndex
CREATE INDEX "case_participant_banks_confirmationStatus_idx" ON "case_participant_banks"("confirmationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "case_participant_banks_caseId_bankCode_key" ON "case_participant_banks"("caseId", "bankCode");

-- CreateIndex
CREATE INDEX "credit_items_participantId_idx" ON "credit_items"("participantId");

-- CreateIndex
CREATE INDEX "repayment_periods_caseId_idx" ON "repayment_periods"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "repayment_periods_caseId_period_key" ON "repayment_periods"("caseId", "period");

-- CreateIndex
CREATE INDEX "repayment_allocations_participantId_idx" ON "repayment_allocations"("participantId");

-- CreateIndex
CREATE UNIQUE INDEX "repayment_allocations_periodId_participantId_key" ON "repayment_allocations"("periodId", "participantId");

-- CreateIndex
CREATE INDEX "notifications_userId_isRead_idx" ON "notifications"("userId", "isRead");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_actionType_idx" ON "audit_logs"("actionType");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_bankCode_fkey" FOREIGN KEY ("bankCode") REFERENCES "banks"("bankCode") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_codes" ADD CONSTRAINT "access_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_codes" ADD CONSTRAINT "access_codes_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_requests" ADD CONSTRAINT "password_reset_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cases" ADD CONSTRAINT "cases_courtCode_fkey" FOREIGN KEY ("courtCode") REFERENCES "courts"("courtCode") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cases" ADD CONSTRAINT "cases_mainBankCode_fkey" FOREIGN KEY ("mainBankCode") REFERENCES "banks"("bankCode") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cases" ADD CONSTRAINT "cases_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_participant_banks" ADD CONSTRAINT "case_participant_banks_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("caseId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_participant_banks" ADD CONSTRAINT "case_participant_banks_bankCode_fkey" FOREIGN KEY ("bankCode") REFERENCES "banks"("bankCode") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_participant_banks" ADD CONSTRAINT "case_participant_banks_confirmedBy_fkey" FOREIGN KEY ("confirmedBy") REFERENCES "users"("userId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_items" ADD CONSTRAINT "credit_items_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "case_participant_banks"("participantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repayment_periods" ADD CONSTRAINT "repayment_periods_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("caseId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repayment_periods" ADD CONSTRAINT "repayment_periods_recordedBy_fkey" FOREIGN KEY ("recordedBy") REFERENCES "users"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repayment_allocations" ADD CONSTRAINT "repayment_allocations_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "repayment_periods"("periodId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repayment_allocations" ADD CONSTRAINT "repayment_allocations_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "case_participant_banks"("participantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("userId") ON DELETE SET NULL ON UPDATE CASCADE;

