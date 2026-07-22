import { useEffect, useRef, useState } from 'react'
import type { User } from '@/types'
import { formatBankLabel } from '@/utils/labels'
import { RoleBadge } from '@/components/RoleBadge'
import { NotificationBell } from './NotificationBell'

interface TopBarProps {
  user: User
  onLogout: () => void
  onToggleSidebar: () => void
}

export function TopBar({ user, onLogout, onToggleSidebar }: TopBarProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return undefined
    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('mousedown', onClickOutside)
    return () => window.removeEventListener('mousedown', onClickOutside)
  }, [menuOpen])

  return (
    <header className="flex h-16 items-center justify-between gap-3 border-b border-surface-border bg-surface-raised px-4 sm:px-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onToggleSidebar}
          className="rounded-lg p-2 text-slate-500 hover:bg-surface-muted hover:text-slate-900 md:hidden"
          aria-label="開啟選單"
        >
          <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.8} stroke="currentColor" className="h-5 w-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
          </svg>
        </button>
        <div className="hidden flex-col leading-tight sm:flex">
          <span className="text-xs text-slate-500">目前登入機構</span>
          <span className="text-sm font-medium text-slate-900">{formatBankLabel(user.bankCode, user.bankName)}</span>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-4">
        <NotificationBell />
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-surface-muted"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600/20 text-sm font-semibold text-brand-300">
              {user.name.slice(0, 1)}
            </span>
            <span className="hidden flex-col items-start leading-tight sm:flex">
              <span className="text-sm font-medium text-slate-900">{user.name}</span>
            </span>
            <RoleBadge role={user.role} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 z-40 mt-2 w-56 rounded-xl border border-surface-border bg-surface-raised p-2 shadow-card">
              <div className="border-b border-surface-border px-3 py-2 sm:hidden">
                <p className="text-xs text-slate-500">目前登入機構</p>
                <p className="text-sm text-slate-900">{formatBankLabel(user.bankCode, user.bankName)}</p>
              </div>
              <div className="px-3 py-2">
                <p className="text-sm font-medium text-slate-900">{user.name}</p>
                <p className="text-xs text-slate-500">{user.email}</p>
              </div>
              <button
                type="button"
                onClick={onLogout}
                className="mt-1 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-rose-300 hover:bg-rose-500/10"
              >
                登出
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
