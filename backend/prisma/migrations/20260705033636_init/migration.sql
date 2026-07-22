-- CreateEnum
CREATE TYPE "BankType" AS ENUM ('BANK', 'PLATFORM');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'BANK_STAFF', 'VIEWER', 'PLATFORM_AUDITOR');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('UNVERIFIED', 'PENDING_REVIEW', 'ACTIVE', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('DRAFT', 'PENDING_CONFIRMATION', 'IN_REPAYMENT', 'SETTLED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "ParticipantConfirmationStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'CONFIRMED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "CaseBankRole" AS ENUM ('MAIN', 'CO_BANK');

-- CreateEnum
CREATE TYPE "ClaimType" AS ENUM ('CREDIT_LOAN', 'CREDIT_CARD', 'GUARANTEE', 'OTHER');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "ApprovalAction" AS ENUM ('SYSTEM_BOOTSTRAP', 'SUBMIT', 'EMAIL_VERIFIED', 'APPROVE', 'REJECT', 'RESUBMIT', 'ROLE_ASSIGN', 'BANK_CHANGE', 'SUSPEND', 'REACTIVATE');

-- CreateEnum
CREATE TYPE "AuditActionType" AS ENUM ('LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT', 'REGISTER_SUBMIT', 'OTP_REQUESTED', 'OTP_VERIFIED', 'OTP_VERIFY_FAILED', 'ACCOUNT_APPROVED', 'ACCOUNT_REJECTED', 'ACCOUNT_SUSPENDED', 'ACCOUNT_REACTIVATED', 'ROLE_ASSIGNED', 'BANK_CHANGED', 'CREATE_CASE', 'UPDATE_CASE', 'PUBLISH_CASE', 'INVITE_BANK', 'CONFIRM_CASE_RECEIPT', 'DISPUTE_CASE', 'RECORD_REPAYMENT', 'SETTLE_CASE', 'TERMINATE_CASE', 'VIEW_INTERNAL_TOTAL', 'PASSWORD_RESET_SUCCESS');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('ACCOUNT_PENDING_REVIEW', 'ACCOUNT_APPROVED', 'ACCOUNT_REJECTED', 'CASE_INVITATION', 'CONFIRMATION_DEADLINE_REMINDER', 'CASE_CONFIRMED_BY_BANK', 'CASE_DISPUTED_BY_BANK', 'ALL_BANKS_CONFIRMED', 'REPAYMENT_UPDATE_DUE', 'REPAYMENT_UPDATED', 'CASE_SETTLED', 'CASE_TERMINATED');

-- CreateTable
CREATE TABLE "banks" (
    "bankCode" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "type" "BankType" NOT NULL,

    CONSTRAINT "banks_pkey" PRIMARY KEY ("bankCode")
);

-- CreateTable
CREATE TABLE "users" (
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "department" TEXT,
    "title" TEXT,
    "appliedBankCode" TEXT NOT NULL,
    "approvedBankCode" TEXT,
    "role" "Role",
    "accountStatus" "AccountStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "emailVerifiedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "email_otps" (
    "otpId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "isUsed" BOOLEAN NOT NULL DEFAULT false,
    "invalidatedAt" TIMESTAMP(3),
    "resendAfter" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_otps_pkey" PRIMARY KEY ("otpId")
);

-- CreateTable
CREATE TABLE "account_approval_logs" (
    "logId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" "ApprovalAction" NOT NULL,
    "performedBy" TEXT,
    "previousStatus" "AccountStatus",
    "newStatus" "AccountStatus",
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_approval_logs_pkey" PRIMARY KEY ("logId")
);

-- CreateTable
CREATE TABLE "cases" (
    "caseId" TEXT NOT NULL,
    "caseNumber" TEXT NOT NULL,
    "debtorId" TEXT NOT NULL,
    "debtorName" TEXT NOT NULL,
    "mainBankCode" TEXT NOT NULL,
    "receiptDate" TIMESTAMP(3) NOT NULL,
    "mediationDate" TIMESTAMP(3),
    "mediationInstitution" TEXT,
    "notificationDate" TIMESTAMP(3),
    "declarationDeadline" TIMESTAMP(3) NOT NULL,
    "status" "CaseStatus" NOT NULL DEFAULT 'DRAFT',
    "totalDebtAmount" DECIMAL(21,4),
    "monthlyInstallment" DECIMAL(21,4),
    "planStartDate" TIMESTAMP(3),
    "planInstallments" INTEGER,
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
    "caseId" TEXT NOT NULL,
    "bankCode" TEXT NOT NULL,
    "roleInCase" "CaseBankRole" NOT NULL,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmationStatus" "ParticipantConfirmationStatus" NOT NULL DEFAULT 'PENDING',
    "confirmedBy" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "disputeReason" TEXT,
    "disputedAt" TIMESTAMP(3),

    CONSTRAINT "case_participant_banks_pkey" PRIMARY KEY ("caseId","bankCode")
);

-- CreateTable
CREATE TABLE "creditor_declarations" (
    "declarationId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "bankCode" TEXT NOT NULL,
    "totalAmount" DECIMAL(21,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creditor_declarations_pkey" PRIMARY KEY ("declarationId")
);

-- CreateTable
CREATE TABLE "credit_items" (
    "itemId" TEXT NOT NULL,
    "declarationId" TEXT NOT NULL,
    "claimType" "ClaimType" NOT NULL,
    "externalPrincipal" DECIMAL(21,4) NOT NULL DEFAULT 0,
    "externalInterest" DECIMAL(21,4) NOT NULL DEFAULT 0,
    "externalPenalty" DECIMAL(21,4) NOT NULL DEFAULT 0,
    "externalOtherFee" DECIMAL(21,4) NOT NULL DEFAULT 0,
    "externalTotal" DECIMAL(21,4) NOT NULL DEFAULT 0,
    "internalTotal" DECIMAL(21,4) NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "credit_items_pkey" PRIMARY KEY ("itemId")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "logId" TEXT NOT NULL,
    "userId" TEXT,
    "bankCode" TEXT,
    "actionType" "AuditActionType" NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "detail" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("logId")
);

-- CreateTable
CREATE TABLE "notifications" (
    "notificationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "relatedCaseId" TEXT,
    "relatedDeclarationId" TEXT,
    "message" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("notificationId")
);

-- CreateTable
CREATE TABLE "repayment_records" (
    "recordId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "bankCode" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "periodRepaid" DECIMAL(21,4) NOT NULL DEFAULT 0,
    "outstandingBalance" DECIMAL(21,4) NOT NULL DEFAULT 0,
    "recordedBy" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "repayment_records_pkey" PRIMARY KEY ("recordId")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_appliedBankCode_idx" ON "users"("appliedBankCode");

-- CreateIndex
CREATE INDEX "users_approvedBankCode_idx" ON "users"("approvedBankCode");

-- CreateIndex
CREATE INDEX "users_accountStatus_idx" ON "users"("accountStatus");

-- CreateIndex
CREATE INDEX "email_otps_userId_purpose_idx" ON "email_otps"("userId", "purpose");

-- CreateIndex
CREATE INDEX "account_approval_logs_userId_idx" ON "account_approval_logs"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "cases_caseNumber_key" ON "cases"("caseNumber");

-- CreateIndex
CREATE INDEX "cases_status_idx" ON "cases"("status");

-- CreateIndex
CREATE INDEX "cases_mainBankCode_idx" ON "cases"("mainBankCode");

-- CreateIndex
CREATE INDEX "cases_debtorId_idx" ON "cases"("debtorId");

-- CreateIndex
CREATE INDEX "case_participant_banks_bankCode_idx" ON "case_participant_banks"("bankCode");

-- CreateIndex
CREATE INDEX "case_participant_banks_confirmationStatus_idx" ON "case_participant_banks"("confirmationStatus");

-- CreateIndex
CREATE INDEX "creditor_declarations_bankCode_idx" ON "creditor_declarations"("bankCode");

-- CreateIndex
CREATE UNIQUE INDEX "creditor_declarations_caseId_bankCode_key" ON "creditor_declarations"("caseId", "bankCode");

-- CreateIndex
CREATE INDEX "credit_items_declarationId_idx" ON "credit_items"("declarationId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_actionType_idx" ON "audit_logs"("actionType");

-- CreateIndex
CREATE INDEX "notifications_userId_isRead_idx" ON "notifications"("userId", "isRead");

-- CreateIndex
CREATE INDEX "repayment_records_caseId_period_idx" ON "repayment_records"("caseId", "period");

-- CreateIndex
CREATE INDEX "repayment_records_bankCode_idx" ON "repayment_records"("bankCode");

-- CreateIndex
CREATE UNIQUE INDEX "repayment_records_caseId_bankCode_period_key" ON "repayment_records"("caseId", "bankCode", "period");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_appliedBankCode_fkey" FOREIGN KEY ("appliedBankCode") REFERENCES "banks"("bankCode") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_approvedBankCode_fkey" FOREIGN KEY ("approvedBankCode") REFERENCES "banks"("bankCode") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_otps" ADD CONSTRAINT "email_otps_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_approval_logs" ADD CONSTRAINT "account_approval_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_approval_logs" ADD CONSTRAINT "account_approval_logs_performedBy_fkey" FOREIGN KEY ("performedBy") REFERENCES "users"("userId") ON DELETE SET NULL ON UPDATE CASCADE;

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
ALTER TABLE "creditor_declarations" ADD CONSTRAINT "creditor_declarations_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("caseId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creditor_declarations" ADD CONSTRAINT "creditor_declarations_bankCode_fkey" FOREIGN KEY ("bankCode") REFERENCES "banks"("bankCode") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_items" ADD CONSTRAINT "credit_items_declarationId_fkey" FOREIGN KEY ("declarationId") REFERENCES "creditor_declarations"("declarationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("userId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_bankCode_fkey" FOREIGN KEY ("bankCode") REFERENCES "banks"("bankCode") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repayment_records" ADD CONSTRAINT "repayment_records_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("caseId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repayment_records" ADD CONSTRAINT "repayment_records_bankCode_fkey" FOREIGN KEY ("bankCode") REFERENCES "banks"("bankCode") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repayment_records" ADD CONSTRAINT "repayment_records_recordedBy_fkey" FOREIGN KEY ("recordedBy") REFERENCES "users"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;
