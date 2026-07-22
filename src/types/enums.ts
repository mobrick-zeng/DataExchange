/**
 * 系統列舉常數集中定義於此檔案。
 * 所有頁面／服務層皆應從這裡引用，避免各處硬編碼字串。
 */

/** 銀行／機構代碼。第一版 Demo 固定 4 個選項，正式版由專案方確認外部系統代碼標準。 */
export type BankCode = '012' | '807' | '812' | 'PLATFORM'

export const BANK_CODES: BankCode[] = ['012', '807', '812', 'PLATFORM']

/** 一般銀行（不含平台管理單位），供註冊頁下拉選單使用 */
export const REGISTRABLE_BANK_CODES: BankCode[] = ['012', '807', '812']

/** 使用者角色 */
export type Role =
  | 'ADMIN' // 平台管理員
  | 'BANK_STAFF' // 銀行人員（正式版：最大/其他債權行因案動態認定）
  | 'MAIN_BANK_STAFF' // （舊）主辦銀行人員 — 保留相容
  | 'CO_BANK_STAFF' // （舊）協辦銀行人員 — 保留相容
  | 'VIEWER' // 檢視者
  | 'PLATFORM_AUDITOR' // 平台稽核檢視者

export const ROLES: Role[] = ['ADMIN', 'BANK_STAFF', 'VIEWER', 'PLATFORM_AUDITOR']

/** 帳號狀態機 */
export type AccountStatus =
  | 'UNVERIFIED' // 未驗證 Email
  | 'PENDING_REVIEW' // 已驗證／待審核
  | 'ACTIVE' // 已啟用
  | 'REJECTED' // 已駁回
  | 'SUSPENDED' // 已停用

/** 案件狀態機 */
export type CaseStatus =
  | 'DRAFT' // 草稿
  | 'PENDING_DECLARATION' // 待申報
  | 'IN_PROGRESS' // 申報中
  | 'COMPLETED' // 申報完成
  | 'CLOSED' // 已結案

/** 案件參與銀行的申報進度（case_participant_banks.declaration_status） */
export type ParticipantDeclarationStatus = 'NOT_STARTED' | 'DRAFT' | 'SUBMITTED' | 'RETURNED' | 'LOCKED'

/** 債權申報狀態機（creditor_declarations.status） */
export type DeclarationStatus = 'DRAFT' | 'SUBMITTED' | 'RETURNED' | 'LOCKED'

/** 案件中銀行的角色 */
export type CaseBankRole = 'MAIN' | 'CO_BANK'

/** 債權種類 */
export type ClaimType = 'CREDIT_LOAN' | 'CREDIT_CARD' | 'GUARANTEE' | 'OTHER'

export const CLAIM_TYPES: ClaimType[] = ['CREDIT_LOAN', 'CREDIT_CARD', 'GUARANTEE', 'OTHER']

/** OTP 用途 */
export type OtpPurpose = 'EMAIL_VERIFICATION' | 'PASSWORD_RESET'

/** 帳號審核歷程 action（account_approval_logs.action） */
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

/** 全系統操作稽核事件（audit_logs.action_type） */
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
  | 'SAVE_DECLARATION_DRAFT'
  | 'SUBMIT_DECLARATION'
  | 'RETURN_DECLARATION'
  | 'RESUBMIT_DECLARATION'
  | 'CLOSE_CASE'
  | 'VIEW_INTERNAL_TOTAL'
  | 'PASSWORD_RESET_SUCCESS'

/** 通知事件類型 */
export type NotificationType =
  | 'ACCOUNT_PENDING_REVIEW'
  | 'ACCOUNT_APPROVED'
  | 'ACCOUNT_REJECTED'
  | 'CASE_INVITATION'
  | 'DECLARATION_DEADLINE_REMINDER'
  | 'DECLARATION_RETURNED'
  | 'DECLARATION_RESUBMITTED'
  | 'ALL_BANKS_SUBMITTED'
  | 'CASE_CLOSED'

/**
 * 依「方案 B」設計：僅此陣列中的角色可查看所有銀行的 internal_total。
 * 未來若要切換為「方案 A」（一般 ADMIN 也可查看），只需將 'ADMIN' 加入此陣列，
 * 不需更動資料模型或分散在各頁面的顯示邏輯。
 */
export const INTERNAL_TOTAL_VISIBLE_ROLES: Role[] = ['PLATFORM_AUDITOR']
