-- v0.35_TableChange：債權彙整表對齊（新增債權種類、對內債權欄位、案件日期欄位）
-- 皆為「加欄位／加 enum 值」的非破壞性變更，可直接 migrate deploy，不需清空資料。

-- AlterEnum：新增債權種類（現金卡、繼承）
ALTER TYPE "ClaimType" ADD VALUE 'CASH_CARD';
ALTER TYPE "ClaimType" ADD VALUE 'INHERITANCE';

-- AlterTable：案件新增日期欄位（調解日期、通報日期；皆可空）
ALTER TABLE "cases" ADD COLUMN     "mediationDate" TIMESTAMP(3),
ADD COLUMN     "notifiedDate" TIMESTAMP(3);

-- AlterTable：債權明細新增對內本金／利息（僅本行/稽核可見，不對他行揭露）
ALTER TABLE "credit_items" ADD COLUMN     "internalPrincipal" DECIMAL(21,4) NOT NULL DEFAULT 0,
ADD COLUMN     "internalInterest" DECIMAL(21,4) NOT NULL DEFAULT 0;
