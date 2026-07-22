import type { AccountStatus, ClaimType, Role } from '@/types'

/**
 * 顯示機構標籤。機構清單由後端提供，故傳入名稱時顯示「名稱（代碼）」；
 * 未提供名稱（例如只有代碼）時退回顯示代碼。PLATFORM 不顯示代碼。
 */
export function formatBankLabel(bankCode: string | null | undefined, bankName?: string | null): string {
  if (!bankCode) return '—'
  if (bankCode === 'PLATFORM') return bankName ?? '平台管理單位'
  return bankName ? `${bankName}（${bankCode}）` : bankCode
}

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: '平台管理員',
  BANK_STAFF: '銀行人員',
  PLATFORM_AUDITOR: '平台稽核檢視者',
}

export const ROLE_BADGE_CLASS: Record<Role, string> = {
  ADMIN: 'bg-violet-500/15 text-violet-700 ring-1 ring-inset ring-violet-500/30',
  BANK_STAFF: 'bg-blue-500/15 text-blue-700 ring-1 ring-inset ring-blue-500/30',
  PLATFORM_AUDITOR: 'bg-amber-500/15 text-amber-700 ring-1 ring-inset ring-amber-500/30',
}

export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = {
  PENDING_ACTIVATION: '待啟用',
  ACTIVE: '已啟用',
  SUSPENDED: '已停用',
}

export const ACCOUNT_STATUS_BADGE_CLASS: Record<AccountStatus, string> = {
  PENDING_ACTIVATION: 'bg-amber-500/15 text-amber-700 ring-1 ring-inset ring-amber-500/30',
  ACTIVE: 'bg-emerald-500/15 text-emerald-700 ring-1 ring-inset ring-emerald-500/30',
  SUSPENDED: 'bg-neutral-500/20 text-neutral-600 ring-1 ring-inset ring-neutral-500/30',
}

export const CLAIM_TYPE_LABELS: Record<ClaimType, string> = {
  CREDIT_LOAN: '信貸',
  CREDIT_CARD: '信用卡',
  GUARANTEE: '保證',
  OTHER: '其他',
}
