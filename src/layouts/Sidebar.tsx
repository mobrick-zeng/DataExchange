import { NavLink } from 'react-router-dom'
import type { Role } from '@/types'

interface NavItem {
  to: string
  label: string
  icon: string
  roles: Role[] | 'all'
}

const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: '📊', roles: 'all' },
  { to: '/cases', label: '案件列表', icon: '📁', roles: 'all' },
  { to: '/cases/new', label: '新增案件', icon: '➕', roles: ['BANK_STAFF'] },
  { to: '/admin/users', label: '使用者與權限管理', icon: '👤', roles: ['ADMIN'] },
  { to: '/audit-logs', label: '操作紀錄', icon: '🧾', roles: ['ADMIN', 'PLATFORM_AUDITOR'] },
]

interface SidebarProps {
  role: Role | null
  onNavigate?: () => void
}

export function Sidebar({ role, onNavigate }: SidebarProps) {
  const items = NAV_ITEMS.filter((item) => item.roles === 'all' || (role && item.roles.includes(role)))

  return (
    <nav className="flex h-full flex-col gap-1 p-3">
      <div className="mb-2 px-3 py-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">主選單</p>
      </div>
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          onClick={onNavigate}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
              isActive
                ? 'bg-brand-600/15 text-brand-300 ring-1 ring-inset ring-brand-500/30'
                : 'text-slate-500 hover:bg-surface-muted hover:text-slate-900'
            }`
          }
        >
          <span aria-hidden="true">{item.icon}</span>
          {item.label}
        </NavLink>
      ))}
    </nav>
  )
}
