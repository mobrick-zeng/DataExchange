import { useState } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'

/** 登入後頁面共用版型：頂部導覽列 + 左側選單（手機版收合為抽屜）+ 內容區 */
export function AppLayout() {
  const { currentUser, logout } = useAuth()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  if (!currentUser) {
    return <Navigate to="/login" replace />
  }

  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      {/* 桌機／平板：固定顯示的側邊選單 */}
      <aside className="hidden w-64 shrink-0 border-r border-surface-border bg-surface-raised md:flex">
        <Sidebar role={currentUser.role} />
      </aside>

      {/* 手機版：覆蓋式抽屜選單 */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileNavOpen(false)} aria-hidden="true" />
          <div className="relative flex w-64 flex-col border-r border-surface-border bg-surface-raised">
            <Sidebar role={currentUser.role} onNavigate={() => setMobileNavOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar user={currentUser} onLogout={logout} onToggleSidebar={() => setMobileNavOpen((v) => !v)} />
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
