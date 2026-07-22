import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User } from '@/types'

/**
 * 登入 Session 狀態（Demo 版）。
 * ⚠️ 僅供前端展示使用：session 保存於 localStorage，使用者可自行修改瀏覽器儲存內容，
 * 不可作為正式權限控管依據。正式版應改為伺服器端 Session／JWT + HttpOnly Cookie。
 */
interface AuthState {
  currentUser: User | null
  setCurrentUser: (user: User | null) => void
  clearCurrentUser: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      currentUser: null,
      setCurrentUser: (user) => set({ currentUser: user }),
      clearCurrentUser: () => set({ currentUser: null }),
    }),
    { name: 'mediation-platform-demo:session:v1' },
  ),
)
