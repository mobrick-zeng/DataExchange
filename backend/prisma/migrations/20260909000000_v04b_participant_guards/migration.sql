-- v0.4b 參與行治理防護
--  DeclarationSnapshot 增加「該輪被排除的行」存證欄位，
--  使每一輪揭露快照可完整還原「誰在、誰不在、為什麼不在」。
ALTER TABLE "declaration_snapshots"
  ADD COLUMN "excluded"      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "removalKind"   "ParticipantRemovalKind",
  ADD COLUMN "removalReason" TEXT;
