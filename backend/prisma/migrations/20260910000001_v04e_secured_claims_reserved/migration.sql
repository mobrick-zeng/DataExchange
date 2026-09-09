-- CreateTable
CREATE TABLE "secured_credit_items" (
    "securedItemId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "collateralType" TEXT NOT NULL,
    "principal" DECIMAL(21,4) NOT NULL DEFAULT 0,
    "interest" DECIMAL(21,4) NOT NULL DEFAULT 0,
    "penalty" DECIMAL(21,4) NOT NULL DEFAULT 0,
    "otherFee" DECIMAL(21,4) NOT NULL DEFAULT 0,
    "originalLoanAmount" DECIMAL(21,4),
    "creditBalance" DECIMAL(21,4),
    "periodPayment" DECIMAL(21,4),
    "lastPaymentAmount" DECIMAL(21,4),
    "overdueUnpaidAmount" DECIMAL(21,4),
    "contractStartDate" TIMESTAMP(3),
    "contractEndDate" TIMESTAMP(3),
    "lastInterestDate" TIMESTAMP(3),
    "monthlyDueDay" INTEGER,
    "accountNo" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "secured_credit_items_pkey" PRIMARY KEY ("securedItemId")
);

-- CreateIndex
CREATE INDEX "secured_credit_items_participantId_idx" ON "secured_credit_items"("participantId");

-- AddForeignKey
ALTER TABLE "secured_credit_items" ADD CONSTRAINT "secured_credit_items_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "case_participant_banks"("participantId") ON DELETE CASCADE ON UPDATE CASCADE;
