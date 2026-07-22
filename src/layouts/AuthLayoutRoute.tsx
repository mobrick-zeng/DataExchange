import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { AuthLayout } from './AuthLayout'

/** 未登入頁面的路由外層：已登入使用者造訪這些頁面時，直接導向 Dashboard */
export function AuthLayoutRoute() {
  const { currentUser } = useAuth()

  if (currentUser) {
    return <Navigate to="/dashboard" replace />
  }

  return (
    <AuthLayout>
      <Outlet />
    </AuthLayout>
  )
}
