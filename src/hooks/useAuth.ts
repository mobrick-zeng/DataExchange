import { useAuthStore } from '@/stores/authStore'
import { apiLogout } from '@/services/apiAuth'

/** 目前登入使用者與登出動作的統一入口 */
export function useAuth() {
  const currentUser = useAuthStore((s) => s.currentUser)
  const clearCurrentUser = useAuthStore((s) => s.clearCurrentUser)

  const logout = () => {
    apiLogout()
    clearCurrentUser()
  }

  return { currentUser, logout }
}
