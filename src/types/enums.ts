/**
 * 系統列舉常數集中定義於此檔案。
 * 所有頁面／服務層皆應從這裡引用，避免各處硬編碼字串。
 * ⚠️ 權威來源為後端 Prisma enum（backend/prisma/schema.prisma）；本檔須與其保持一致。
 */

/** 銀行／機構代碼。Demo 固定 4 個，正式版由專案方確認外部系統代碼標準。 */
export type BankCode = '012' | '807' | '812' | 'PLATFORM'

export const BANK_CODES: BankCode[] = ['012', '807', '812', 'PLATFORM']

/** 一般銀行（不含平台管理單位），供邀請／下拉選單使用 */
export const REGISTRABLE_BANK_CODES: BankCode[] = ['012', '807', '812']

/** 使用者角色（對應後端 Role）。BANK_STAFF 的主辦／其他債權行身分因案動態認定，不另設角色。 */
export type Role =
  | 'ADMIN' // 平台管理員
  | 'BANK_STAFF' // 銀行人員
  | 'VIEWER' // 檢視者
  | 'PLATFORM_AUDITOR' // 平台稽核檢視者

export const ROLES: Role[] = ['ADMIN', 'BANK_STAFF', 'VIEWER', 'PLATFORM_AUDITOR']

/** 帳號狀態機（對應後端 AccountStatus） */
export type AccountStatus =
  | 'UNVERIFIED' // 未驗證 Email
  | 'PENDING_REVIEW' // 已驗證／待審核
  | 'ACTIVE' // 已啟用
  | 'REJECTED' // 已駁回
  | 'SUSPENDED' // 已停用

/** 案件狀態機（對應後端 CaseStatus） */
export type CaseStatus =
  | 'DRAFT' // 建立中（最大債權行代填）
  | 'PENDING_CONFIRMATION' // 已發布，待各其他債權行確認
  | 'IN_REPAYMENT' // 還款中（每月更新）
  | 'SETTLED' // 已結清
  | 'TERMINATED' // 毀諾／終止

/** 其他債權行對案件的確認流程（對應後端 ParticipantConfirmationStatus） */
export type ParticipantConfirmationStatus =
  | 'NOT_REQUIRED' // 最大債權行本身，無需確認
  | 'PENDING' // 待確認
  | 'CONFIRMED' // 已確認
  | 'DISPUTED' // 已回報異議

/** 案件中銀行的角色（對應後端 CaseBankRole） */
export type CaseBankRole = 'MAIN' | 'CO_BANK'

/** 債權種類（對應後端 ClaimType） */
export type ClaimType = 'CREDIT_LOAN' | 'CREDIT_CARD' | 'GUARANTEE' | 'OTHER'

export const CLAIM_TYPES: ClaimType[] = ['CREDIT_LOAN', 'CREDIT_CARD', 'GUARANTEE', 'OTHER']

/** 帳號審核歷程 action（對應後端 ApprovalAction） */
export type ApprovalAction =
  | 'SYSTEM_BOOTSTRAP'
  | 'SUBMIT'
  | 'EMAIL_VERIFIED'
  | 'APPROVE'
  | 'REJECT'
  | 'RESUBMIT'
  | 'ROLE_ASSIGN'
  | 'BANK_CHANGE'
  | 'SUSPEND'
  | 'REACTIVATE'

/** 全系統操作稽核事件（對應後端 AuditActionType） */
export type AuditActionType =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILED'
  | 'LOGOUT'
  | 'REGISTER_SUBMIT'
  | 'OTP_REQUESTED'
  | 'OTP_VERIFIED'
  | 'OTP_VERIFY_FAILED'
  | 'ACCOUNT_APPROVED'
  | 'ACCOUNT_REJECTED'
  | 'ACCOUNT_SUSPENDED'
  | 'ACCOUNT_REACTIVATED'
  | 'ROLE_ASSIGNED'
  | 'BANK_CHANGED'
  | 'CREATE_CASE'
  | 'UPDATE_CASE'
  | 'PUBLISH_CASE'
  | 'INVITE_BANK'
  | 'CONFIRM_CASE_RECEIPT'
  | 'DISPUTE_CASE'
  | 'RECORD_REPAYMENT'
  | 'SETTLE_CASE'
  | 'TERMINATE_CASE'
  | 'VIEW_INTERNAL_TOTAL'
  | 'PASSWORD_RESET_SUCCESS'
  | 'CREATE_INVITATION'
  | 'REVOKE_INVITATION'
  | 'ACCEPT_INVITATION'
  | 'REQUEST_PASSWORD_RESET'
  | 'ISSUE_PASSWORD_RESET'
  | 'ACCOUNT_LOCKED'
  | 'ACCOUNT_UNLOCKED'

/** 通知事件類型（對應後端 NotificationType） */
export type NotificationType =
  | 'ACCOUNT_PENDING_REVIEW'
  | 'ACCOUNT_APPROVED'
  | 'ACCOUNT_REJECTED'
  | 'CASE_INVITATION'
  | 'CONFIRMATION_DEADLINE_REMINDER'
  | 'CASE_CONFIRMED_BY_BANK'
  | 'CASE_DISPUTED_BY_BANK'
  | 'ALL_BANKS_CONFIRMED'
  | 'REPAYMENT_UPDATE_DUE'
  | 'REPAYMENT_UPDATED'
  | 'CASE_SETTLED'
  | 'CASE_TERMINATED'

/**
 * 依「方案 B」設計：僅此陣列中的角色可查看所有銀行的 internal_total。
 * 未來若要切換為「方案 A」（一般 ADMIN 也可查看），只需將 'ADMIN' 加入此陣列，
 * 不需更動資料模型或分散在各頁面的顯示邏輯。
 */
export const INTERNAL_TOTAL_VISIBLE_ROLES: Role[] = ['PLATFORM_AUDITOR']
