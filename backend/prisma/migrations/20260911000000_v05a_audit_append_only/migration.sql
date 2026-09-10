-- 稽核軌跡改為「僅可新增」（append-only）：於資料庫層阻擋 UPDATE 與 DELETE。
--
-- 為什麼要在資料庫層做：應用層本來就只有 create 與 findMany（已逐檔確認 backend/src 無任何
-- auditLog.update / delete / updateMany / deleteMany），因此這裡防的不是應用程式，而是
-- 「繞過應用層直接連資料庫改動或抹除紀錄」。稽核軌跡若可被事後修改，其存證價值即不成立。
--
-- 觸發器採 FOR EACH STATEMENT：無論影響幾列都只觸發一次，成本可忽略。
--
-- 副作用（刻意保留）：audit_logs.userId 的外鍵為 ON DELETE SET NULL，故「刪除使用者」會
-- 對 audit_logs 產生 UPDATE 而被此觸發器阻擋。目前系統並無刪除使用者的功能（僅停用／復用），
-- 且「有稽核歷史的帳號不得被刪除、以免紀錄失去行為人歸屬」本身即為期望性質。
--
-- 若日後確有保留期限清理需求，須由具權限者明確暫時停用後再執行：
--   ALTER TABLE "audit_logs" DISABLE TRIGGER "audit_logs_no_delete";
--   -- ... 清理 ...
--   ALTER TABLE "audit_logs" ENABLE TRIGGER "audit_logs_no_delete";

CREATE OR REPLACE FUNCTION audit_logs_append_only() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'audit_logs 為僅可新增（append-only），不允許 % 操作', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$fn$;

DROP TRIGGER IF EXISTS "audit_logs_no_update" ON "audit_logs";
CREATE TRIGGER "audit_logs_no_update"
  BEFORE UPDATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_append_only();

DROP TRIGGER IF EXISTS "audit_logs_no_delete" ON "audit_logs";
CREATE TRIGGER "audit_logs_no_delete"
  BEFORE DELETE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_append_only();
