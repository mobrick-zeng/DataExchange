/**
 * 後端 API 客戶端。取代原本的 localStorage Mock：
 * 統一附上 JWT、處理 JSON 與錯誤。
 */
const API_BASE = ((import.meta as any).env?.VITE_API_BASE as string) || 'http://localhost:4000'
const TOKEN_KEY = 'mediation-platform:token'

export function getToken(): string | null {
  return window.localStorage.getItem(TOKEN_KEY)
}
export function setToken(token: string): void {
  window.localStorage.setItem(TOKEN_KEY, token)
}
export function clearToken(): void {
  window.localStorage.removeItem(TOKEN_KEY)
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function apiFetch<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...((opts.headers as Record<string, string>) ?? {}),
  }
  // 僅在確實帶有 body 時才宣告 JSON content-type，
  // 否則無 body 的 POST（如 confirm／publish／read-all／unlock）會觸發
  // Fastify 的「Body cannot be empty when content-type is set to 'application/json'」錯誤。
  if (opts.body != null) headers['Content-Type'] = 'application/json'
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    throw new ApiError(res.status, (data && data.message) || `請求失敗（${res.status}）`)
  }
  return data as T
}
