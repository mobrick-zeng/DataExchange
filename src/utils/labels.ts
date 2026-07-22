import type {
  AccountStatus,
  BankCode,
  CaseStatus,
  ClaimType,
  DeclarationStatus,
  ParticipantDeclarationStatus,
  Role,
} from '@/types'

export const BANK_NAMES: Record<BankCode, string> = {
  '012': '台北富邦銀行',
  '807': '玉山銀行',
  '812': '台新銀行',
  PLATFORM: '平台管理單位',
}

/** 顯示為「銀行名稱（代碼）」，平台管理單位不顯示代碼 */
export function formatBankLabel(bankCode: BankCode | null | undefined): string {
  if (!bankCode) return '—'
  if (bankCode === 'PLATFORM') return BANK_NAMES[bankCode]
  return `${BANK_NAMES[bankCode]}（${bankCode}）`
}

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: '平台管理員',
  BANK_STAFF: '銀行人員',
  MAIN_BANK_STAFF: '主辦銀行人員',
  CO_BANK_STAFF: '協辦銀行人員',
  VIEWER: '檢視者',
  PLATFORM_AUDITOR: '平台稽核檢視者',
}

export const ROLE_BADGE_CLASS: Record<Role, string> = {
  ADMIN: 'bg-violet-500/15 text-violet-700 ring-1 ring-inset ring-violet-500/30',
  BANK_STAFF: 'bg-blue-500/15 text-blue-700 ring-1 ring-inset ring-blue-500/30',
  MAIN_BANK_STAFF: 'bg-blue-500/15 text-blue-700 ring-1 ring-inset ring-blue-500/30',
  CO_BANK_STAFF: 'bg-indigo-500/15 text-indigo-700 ring-1 ring-inset ring-indigo-500/30',
  VIEWER: 'bg-slate-500/15 text-slate-700 ring-1 ring-inset ring-slate-500/30',
  PLATFORM_AUDITOR: 'bg-amber-500/15 text-amber-700 ring-1 ring-inset ring-amber-500/30',
}

export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = {
  UNVERIFIED: '未驗證',
  PENDING_REVIEW: '待審核',
  ACTIVE: '已啟用',
  REJECTED: '已駁回',
  SUSPENDED: '已停用',
}

export const ACCOUNT_STATUS_BADGE_CLASS: Record<AccountStatus, string> = {
  UNVERIFIED: 'bg-slate-500/15 text-slate-700 ring-1 ring-inset ring-slate-500/30',
  PENDING_REVIEW: 'bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-500/30',
  ACTIVE: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-500/30',
  REJECTED: 'bg-rose-500/15 text-rose-300 ring-1 ring-inset ring-rose-500/30',
  SUSPENDED: 'bg-neutral-500/20 text-neutral-300 ring-1 ring-inset ring-neutral-500/30',
}

export const CASE_STATUS_LABELS: Record<CaseStatus, string> = {
  DRAFT: '草稿',
  PENDING_DECLARATION: '待申報',
  IN_PROGRESS: '申報中',
  COMPLETED: '申報完成',
  CLOSED: '已結案',
}

export const CASE_STATUS_BADGE_CLASS: Record<CaseStatus, string> = {
  DRAFT: 'bg-slate-500/15 text-slate-700 ring-1 ring-inset ring-slate-500/30',
  PENDING_DECLARATION: 'bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-500/30',
  IN_PROGRESS: 'bg-blue-500/15 text-blue-300 ring-1 ring-inset ring-blue-500/30',
  COMPLETED: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-500/30',
  CLOSED: 'bg-neutral-500/20 text-neutral-300 ring-1 ring-inset ring-neutral-500/30',
}

export const DECLARATION_STATUS_LABELS: Record<DeclarationStatus, string> = {
  DRAFT: '草稿',
  SUBMITTED: '已送出',
  RETURNED: '退回補件',
  LOCKED: '已鎖定',
}

export const PARTICIPANT_DECLARATION_STATUS_LABELS: Record<ParticipantDeclarationStatus, string> = {
  NOT_STARTED: '未開始',
  DRAFT: '草稿',
  SUBMITTED: '已送出',
  RETURNED: '退回補件',
  LOCKED: '已鎖定',
}

export const DECLARATION_STATUS_BADGE_CLASS: Record<
  DeclarationStatus | ParticipantDeclarationStatus,
  string
> = {
  NOT_STARTED: 'bg-slate-500/15 text-slate-700 ring-1 ring-inset ring-slate-500/30',
  DRAFT: 'bg-slate-500/15 text-slate-700 ring-1 ring-inset ring-slate-500/30',
  SUBMITTED: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-500/30',
  RETURNED: 'bg-orange-500/15 text-orange-300 ring-1 ring-inset ring-orange-500/30',
  LOCKED: 'bg-neutral-500/20 text-neutral-300 ring-1 ring-inset ring-neutral-500/30',
}

export const CLAIM_TYPE_LABELS: Record<ClaimType, string> = {
  CREDIT_LOAN: '信貸',
  CREDIT_CARD: '信用卡',
  GUARANTEE: '保證',
  OTHER: '其他',
}

/** 左側選單與案件建立頁僅能顯示／選擇一般銀行，不含平台管理單位 */
export const GENERAL_BANK_CODES: BankCode[] = ['012', '807', '812']
