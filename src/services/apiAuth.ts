import type { AccountStatus, BankCode, Role, User } from '@/types'
import { apiFetch, clearToken, setToken } from './api'

interface ApiUser {
  userId: string
  name: string
  email: string
  role: Role | null
  bankCode: string | null
}

/** 將後端回傳的登入者對應為前端既有的 User 型別（未使用欄位以預設值填入） */
export function toSessionUser(u: ApiUser): User {
  return {
    userId: u.userId,
    name: u.name,
    email: u.email,
    password: '',
    appliedBankCode: (u.bankCode ?? 'PLATFORM') as BankCode,
    approvedBankCode: (u.bankCode ?? null) as BankCode | null,
    role: u.role,
    accountStatus: 'ACTIVE' as AccountStatus,
    emailVerifiedAt: null,
    lastLoginAt: null,
    createdAt: '',
    updatedAt: '',
  }
}

export type ApiLoginResult =
  | { status: 'SUCCESS'; user: User }
  | { status: 'INVALID_CREDENTIALS' }
  | { status: 'ERROR'; message?: string }

export async function apiLogin(bankCode: string, email: string, password: string): Promise<ApiLoginResult> {
  try {
    const res = await apiFetch<{ token: string; user: ApiUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ bankCode, email, password }),
    })
    setToken(res.token)
    return { status: 'SUCCESS', user: toSessionUser(res.user) }
  } catch (e) {
    const status = e && typeof e === 'object' && 'status' in e ? (e as { status: number }).status : 0
    if (status === 401) return { status: 'INVALID_CREDENTIALS' }
    if (status === 429) return { status: 'ERROR', message: '登入嘗試過於頻繁，請稍後再試。' }
    return { status: 'ERROR', message: (e as Error)?.message }
  }
}

export function apiLogout(): void {
  clearToken()
}
