import type {
  AccountStatus,
  ApprovalAction,
  AuditActionType,
  BankCode,
  CaseBankRole,
  CaseStatus,
  ClaimType,
  DeclarationStatus,
  NotificationType,
  OtpPurpose,
  ParticipantDeclarationStatus,
  Role,
} from './enums'

/** banks 資料表 */
export interface Bank {
  bankCode: BankCode
  bankName: string
  type: 'BANK' | 'PLATFORM'
}

/** users 資料表 */
export interface User {
  userId: string
  name: string
  email: string
  /**
   * Demo／POC 階段以明碼儲存於前端 Mock Store，僅供展示使用。
   * 正式版必須改為後端雜湊儲存（bcrypt／argon2），絕不可明碼保存或傳輸。
   */
  password: string
  department?: string
  title?: string
  /** 申請中所屬銀行（註冊時選擇） */
  appliedBankCode: BankCode
  /** 正式核准所屬銀行，僅管理員可設定／修改，核准前為 null */
  approvedBankCode: BankCode | null
  /** 角色，僅管理員可指派，核准前為 null */
  role: Role | null
  accountStatus: AccountStatus
  emailVerifiedAt: string | null
  lastLoginAt: string | null
  createdAt: string
  updatedAt: string
}

/** email_otps 資料表 */
export interface EmailOtp {
  otpId: string
  userId: string
  email: string
  purpose: OtpPurpose
  /**
   * Demo／POC 階段明碼儲存以供 Demo 信箱顯示；
   * 正式版必須改為雜湊值儲存並於伺服器端比對，原因與密碼相同：
   * OTP 在有效期間內等同臨時憑證，明碼外洩風險等同密碼外洩。
   */
  code: string
  expiresAt: string
  attemptCount: number
  maxAttempts: number
  isUsed: boolean
  invalidatedAt: string | null
  resendAfter: string
  createdAt: string
}

/** account_approval_logs 資料表：帳號審核完整歷程，只可新增不可覆寫 */
export interface AccountApprovalLog {
  logId: string
  userId: string
  action: ApprovalAction
  /** null 代表系統自動動作（如 SYSTEM_BOOTSTRAP／EMAIL_VERIFIED） */
  performedBy: string | null
  previousStatus: AccountStatus | null
  newStatus: AccountStatus | null
  reason?: string
  createdAt: string
}

/** cases 資料表 */
export interface Case {
  caseId: string
  caseNumber: string
  debtorId: string
  debtorName: string
  mainBankCode: BankCode
  receiptDate: string
  mediationDate?: string
  mediationInstitution?: string
  notificationDate?: string
  declarationDeadline: string
  status: CaseStatus
  createdBy: string
  note?: string
  createdAt: string
  updatedAt: string
}

/** case_participant_banks 資料表 */
export interface CaseParticipantBank {
  caseId: string
  bankCode: BankCode
  roleInCase: CaseBankRole
  invitedAt: string
  declarationStatus: ParticipantDeclarationStatus
}

/** creditor_declarations 資料表 */
export interface CreditorDeclaration {
  declarationId: string
  caseId: string
  bankCode: BankCode
  status: DeclarationStatus
  submittedBy?: string
  submittedAt?: string
  returnedBy?: string
  returnedAt?: string
  returnReason?: string
  totalAmount: number
  createdAt: string
  updatedAt: string
}

/** credit_items 資料表 */
export interface CreditItem {
  itemId: string
  declarationId: string
  claimType: ClaimType
  externalPrincipal: number
  externalInterest: number
  externalPenalty: number
  externalOtherFee: number
  /** = externalPrincipal + externalInterest + externalPenalty + externalOtherFee，前端唯讀自動計算 */
  externalTotal: number
  /** 銀行內部帳列參考金額，可視性依「方案B」僅 PLATFORM_AUDITOR 可見 */
  internalTotal: number
  note?: string
}

/** audit_logs 資料表 */
export interface AuditLog {
  logId: string
  userId: string | null
  bankCode: BankCode | null
  actionType: AuditActionType
  targetType?: string
  targetId?: string
  detail?: string
  createdAt: string
}

/** notifications 資料表 */
export interface Notification {
  notificationId: string
  userId: string
  type: NotificationType
  relatedCaseId?: string
  relatedDeclarationId?: string
  message: string
  isRead: boolean
  createdAt: string
}

/** Demo 信箱顯示用的衍生結構（非正式資料表，由 EmailOtp 計算而來） */
export interface DemoMailboxMessage {
  otpId: string
  email: string
  purpose: OtpPurpose
  subject: string
  sentAt: string
  code: string
  expiresAt: string
  status: 'VALID' | 'EXPIRED' | 'USED' | 'INVALIDATED'
}
