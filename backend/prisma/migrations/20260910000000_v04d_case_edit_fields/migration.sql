-- v0.4d 草稿異動／刪除 ＋ 調解相關欄位
--  (1) 稽核事件新增 CASE_DELETED
--  (2) cases 新增調解時間／地點與利息計算截止日
ALTER TYPE "AuditActionType" ADD VALUE 'CASE_DELETED';

ALTER TABLE "cases"
  ADD COLUMN "mediationTime"      TEXT,
  ADD COLUMN "mediationPlace"     TEXT,
  ADD COLUMN "interestCutoffDate" TIMESTAMP(3);
