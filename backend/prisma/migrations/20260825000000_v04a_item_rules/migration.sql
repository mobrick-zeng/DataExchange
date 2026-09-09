-- v0.4a 填報規則
--  (1) 新增「其他」債權內容欄位（claimTypeOther）
--  (2) 一類一筆：同一參與行的同一債權種類僅能一列
--      建立唯一索引前，先把既有資料中重複的同種類「金額相加合併」，避免升級失敗。

-- 1) 「其他」債權內容
ALTER TABLE "credit_items" ADD COLUMN "claimTypeOther" TEXT;

-- 2) 合併重複：把同一 (participantId, claimType) 的金額加總寫回保留列（rn = 1）
UPDATE "credit_items" c
SET "principal"         = a.p,
    "interest"          = a.i,
    "penalty"           = a.pe,
    "otherFee"          = a.o,
    "internalPrincipal" = a.ip,
    "internalInterest"  = a.ii
FROM (
  SELECT "participantId",
         "claimType",
         SUM("principal")         AS p,
         SUM("interest")          AS i,
         SUM("penalty")           AS pe,
         SUM("otherFee")          AS o,
         SUM("internalPrincipal") AS ip,
         SUM("internalInterest")  AS ii
  FROM "credit_items"
  GROUP BY "participantId", "claimType"
) a,
(
  SELECT "itemId",
         "participantId" AS pid,
         "claimType"     AS ct,
         ROW_NUMBER() OVER (PARTITION BY "participantId", "claimType" ORDER BY "itemId") AS rn
  FROM "credit_items"
) r
WHERE c."itemId" = r."itemId"
  AND r.rn = 1
  AND a."participantId" = r.pid
  AND a."claimType"     = r.ct;

-- 3) 刪除多餘的重複列（rn > 1）
DELETE FROM "credit_items"
WHERE "itemId" IN (
  SELECT "itemId" FROM (
    SELECT "itemId",
           ROW_NUMBER() OVER (PARTITION BY "participantId", "claimType" ORDER BY "itemId") AS rn
    FROM "credit_items"
  ) t
  WHERE t.rn > 1
);

-- 4) 一類一筆唯一索引
CREATE UNIQUE INDEX "credit_items_participantId_claimType_key"
  ON "credit_items"("participantId", "claimType");
