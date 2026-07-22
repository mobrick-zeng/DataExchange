import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/services/api'
import { formatDateTime } from '@/utils/datetime'

interface Notification {
  notificationId: string
  message: string
  isRead: boolean
  createdAt: string
}

/** 通知鈴鐺：讀取後端通知，顯示未讀數與最新通知，可標記已讀。 */
export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  const load = useCallback(() => {
    apiFetch<{ notifications: Notification[]; unreadCount: number }>('/api/notifications')
      .then((r) => { setNotifications(r.notifications); setUnreadCount(r.unreadCount) })
      .catch(() => { /* 靜默：鈴鐺不阻斷主畫面 */ })
  }, [])

  // 初次載入 + 每 30 秒輪詢
  useEffect(() => {
    load()
    const t = window.setInterval(load, 30000)
    return () => window.clearInterval(t)
  }, [load])

  useEffect(() => {
    if (!open) return undefined
    load()
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onClickOutside)
    return () => window.removeEventListener('mousedown', onClickOutside)
  }, [open, load])

  const markRead = async (id: string) => {
    try { await apiFetch(`/api/notifications/${id}/read`, { method: 'POST' }); load() } catch { /* ignore */ }
  }
  const markAll = async () => {
    try { await apiFetch('/api/notifications/read-all', { method: 'POST' }); load() } catch { /* ignore */ }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-full p-2 text-slate-500 hover:bg-surface-muted hover:text-slate-900"
        aria-label="通知"
      >
        <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.8} stroke="currentColor" className="h-5 w-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.85 23.85 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white">
            {unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-72 rounded-xl border border-surface-border bg-surface-raised p-3 shadow-card">
          <div className="flex items-center justify-between px-2 py-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">通知</p>
            {notifications.length > 0 && (
              <button type="button" onClick={markAll} className="text-xs text-brand-700 hover:text-brand-500">全部已讀</button>
            )}
          </div>
          {notifications.length === 0 ? (
            <div className="px-2 py-6 text-center text-sm text-slate-500">目前沒有新通知</div>
          ) : (
            <div className="mt-2 max-h-96 space-y-2 overflow-y-auto">
              {notifications.map((n) => (
                <button
                  key={n.notificationId}
                  type="button"
                  onClick={() => markRead(n.notificationId)}
                  className={`w-full rounded-xl border px-3 py-2 text-left text-sm transition-colors ${n.isRead ? 'border-surface-border bg-surface-muted/20 text-slate-500' : 'border-brand-500/30 bg-brand-500/10 text-slate-900'}`}
                >
                  <p className="text-slate-900">{n.message}</p>
                  <p className="mt-1 text-[11px] text-slate-500">{formatDateTime(n.createdAt)}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
