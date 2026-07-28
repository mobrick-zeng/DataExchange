/**
 * 系統列舉常數集中定義於此檔案。
 * 所有頁面／服務層皆應從這裡引用，避免各處硬編碼字串。
 * ⚠️ 權威來源為後端 Prisma enum（backend/prisma/schema.prisma）；本檔須與其保持一致。
 */

/** 銀行／機構代碼（3 碼字串；清單由後端 /api/banks 提供，前端不再寫死）。 */
export type BankCode = string

/** 使用者角色（對應後端 Role）。BANK_STAFF 的主辦／其他債權行身分因案動態認定，不另設角色。 */
export type Role =
  | 'ADMIN' // 平台管理員
  | 'BANK_STAFF' // 銀行人員
  | 'PLATFORM_AUDITOR' // 平台稽核檢視者

export const ROLES: Role[] = ['ADMIN', 'BANK_STAFF', 'PLATFORM_AUDITOR']

/** 帳號狀態機（對應後端 AccountStatus） */
export type AccountStatus =
  | 'PENDING_ACTIVATION' // 待啟用（以啟用碼首次登入並設密碼）
  | 'ACTIVE' // 已啟用
  | 'SUSPENDED' // 已停用

/** 案件狀態機（對應後端 CaseStatus，v0.3） */
export type CaseStatus =
  | 'DRAFT' // 主辦起案＋邀請，尚未發布
  | 'PENDING_CONFIRMATION' // 封閉申報中：各行自填並確認自己（含主辦）
  | 'PENDING_OUTCOME' // 全員確認、已揭露、產出彙整表，待主辦回報
  | 'ESTABLISHED' // 已回報成立（終態）
  | 'NOT_ESTABLISHED' // 已回報不成立（終態）

/** 各參與行（含主辦）對自己數字的確認狀態（對應後端 ParticipantConfirmationStatus） */
export type ParticipantConfirmationStatus =
  | 'PENDING' // 待填報並確認
  | 'CONFIRMED' // 已確認自己的數字

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

/** 全系統操作稽核事件（對應後端 AuditActionType，v0.3） */
export type AuditActionType =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILED'
  | 'LOGOUT'
  | 'ACCOUNT_CREATED'
  | 'ACCOUNT_ACTIVATED'
  | 'ACCOUNT_SUSPENDED'
  | 'ACCOUNT_REACTIVATED'
  | 'ACCOUNT_LOCKED'
  | 'ACCOUNT_UNLOCKED'
  | 'CONSENT_GIVEN'
  | 'PASSWORD_CHANGED'
  | 'PASSWORD_RESET_REQUESTED'
  | 'PASSWORD_RESET_ISSUED'
  | 'CASE_CREATED'
  | 'CASE_UPDATED'
  | 'PARTICIPANT_INVITED'
  | 'PARTICIPANT_REMOVED'
  | 'PARTICIPATION_REJECTED'
  | 'CASE_PUBLISHED'
  | 'DECLARATION_SUBMITTED'
  | 'CASE_CONFIRMED'
  | 'CONFIRMATION_WITHDRAWN'
  | 'CASE_DISCLOSED'
  | 'DOUBT_RAISED'
  | 'CASE_ESTABLISHED'
  | 'CASE_NOT_ESTABLISHED'
  | 'BANK_ACTIVATED'
  | 'BANK_DEACTIVATED'
  | 'COURT_ACTIVATED'
  | 'COURT_DEACTIVATED'

/** 通知事件類型（對應後端 NotificationType，v0.3） */
export type NotificationType =
  | 'CASE_INVITATION'
  | 'CASE_PUBLISHED'
  | 'PARTICIPANT_CONFIRMED'
  | 'ALL_CONFIRMED_DISCLOSED'
  | 'DOUBT_RAISED'
  | 'REOPENED_FOR_DOUBT'
  | 'PARTICIPATION_REJECTED'
  | 'PARTICIPANT_REMOVED'
  | 'CASE_ESTABLISHED'
  | 'CASE_NOT_ESTABLISHED'
