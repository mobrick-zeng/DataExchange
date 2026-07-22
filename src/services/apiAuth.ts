import type { User } from '@/types'
import { apiFetch, clearToken, setToken } from './api'

interface ApiUser {
  userId: string
  name: string
  email: string
  role: User['role']
  bankCode: string
  bankName?: string | null
}

function toSessionUser(u: ApiUser): User {
  return { userId: u.userId, name: u.name, email: u.email, role: u.role, bankCode: u.bankCode, bankName: u.bankName ?? null }
}

export type ApiLoginResult =
  | { status: 'SUCCESS'; user: User }
  | { status: 'ACTIVATION_REQUIRED'; email: string; name: string }
  | { status: 'INVALID_CREDENTIALS' }
  | { status: 'ERROR'; message?: string }

export async function apiLogin(bankCode: string, email: string, password: string): Promise<ApiLoginResult> {
  try {
    const res = await apiFetch<{ token?: string; user?: ApiUser; activationRequired?: boolean; email?: string; name?: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ bankCode, email, password }),
    })
    if (res.activationRequired) return { status: 'ACTIVATION_REQUIRED', email: res.email ?? email, name: res.name ?? '' }
    if (res.token && res.user) {
      setToken(res.token)
      return { status: 'SUCCESS', user: toSessionUser(res.user) }
    }
    return { status: 'ERROR', message: '登入回應格式異常' }
  } catch (e) {
    const status = e && typeof e === 'object' && 'status' in e ? (e as { status: number }).status : 0
    if (status === 401) return { status: 'INVALID_CREDENTIALS' }
    if (status === 429) return { status: 'ERROR', message: '登入嘗試過於頻繁，請稍後再試。' }
    return { status: 'ERROR', message: (e as Error)?.message }
  }
}

/** 以啟用碼設定新密碼並勾選同意，完成啟用（成功即自動登入） */
export async function apiActivate(params: { bankCode: string; email: string; code: string; password: string; consent: true }): Promise<{ status: 'SUCCESS'; user: User } | { status: 'ERROR'; message?: string }> {
  try {
    const res = await apiFetch<{ token: string; user: ApiUser }>('/api/auth/activate', { method: 'POST', body: JSON.stringify(params) })
    setToken(res.token)
    return { status: 'SUCCESS', user: toSessionUser(res.user) }
  } catch (e) {
    return { status: 'ERROR', message: (e as Error)?.message }
  }
}

export function apiLogout(): void {
  clearToken()
}
