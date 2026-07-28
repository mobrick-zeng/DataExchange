import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { formatBankLabel, ROLE_LABELS } from '@/utils/labels'
import { apiFetch, ApiError } from '@/services/api'

interface DashboardSummary {
  role: string
  unreadNotifications: number
  asMain?: {
    casesByStatus: Record<string, number>
    pendingConfirmations: number
    outcomeToReport: number
  }
  asCoBank?: { toConfirm: number; casesByStatus: Record<string, number> }
  pendingUserActivations?: number
  pendingResetRequests?: number
  allCasesByStatus?: Record<string, number>
  totalCases?: number
}

const CASE_STATUS_LABELS: Record<string, string> = {
  DRAFT: '草稿',
  PENDING_CONFIRMATION: '封閉申報中',
  PENDING_OUTCOME: '待回報',
  ESTABLISHED: '成立',
  NOT_ESTABLISHED: '不成立',
}

function StatCard({ icon, label, value, to, tone = 'default' }: {
  icon: string
  label: string
  value: number
  to?: string
  tone?: 'default' | 'alert'
}) {
  const valueClass = tone === 'alert' && value > 0 ? 'text-rose-600' : 'text-slate-900'
  const body = (
    <div className="rounded-2xl border border-surface-border bg-surface-raised p-5 shadow-card transition-colors hover:bg-surface-muted/40">
      <div className="flex items-center justify-between">
        <span className="text-2xl" aria-hidden="true">{icon}</span>
        <span className={`text-2xl font-semibold ${valueClass}`}>{value}</span>
      </div>
      <p className="mt-2 text-sm text-slate-500">{label}</p>
    </div>
  )
  return to ? <Link to={to}>{body}</Link> : body
}

function StatusBreakdown({ data }: { data: Record<string, number> }) {
  const entries = Object.entries(data)
  if (entries.length === 0) {
    return <p className="text-sm text-slate-500">目前沒有案件。</p>
  }
  return (
    <div className="flex flex-wrap gap-2">
      {entries.map(([status, count]) => (
        <span key={status} className="rounded-full border border-surface-border bg-surface-muted/40 px-3 py-1 text-xs text-slate-700">
          {CASE_STATUS_LABELS[status] ?? status}：<span className="font-semibold text-slate-900">{count}</span>
        </span>
      ))}
    </div>
  )
}

export function DashboardPage() {
  const { currentUser, logout } = useAuth()
  const navigate = useNavigate()
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    apiFetch<DashboardSummary>('/api/dashboard/summary')
      .then(setSummary)
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) {
          logout()
          navigate('/login', { replace: true })
          return
        }
        setError(e instanceof Error ? e.message : '載入失敗')
      })
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!currentUser) return null

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            您好，{currentUser.name}
            {currentUser.role && <span className="text-slate-500">（{ROLE_LABELS[currentUser.role]}）</span>}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            所屬機構：{formatBankLabel(currentUser.bankCode, currentUser.bankName)}
          </p>
        </div>
        {summary && summary.unreadNotifications > 0 && (
          <span className="rounded-full bg-brand-600/10 px-3 py-1 text-sm font-medium text-brand-700">
            🔔 {summary.unreadNotifications} 則未讀
          </span>
        )}
      </div>

      {loading && <p className="text-sm text-slate-500">載入中…</p>}

      {error && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-600">
          {error}
        </div>
      )}

      {summary && !error && (
        <>
          {/* 銀行人員：以最大債權行身分 */}
          {summary.asMain && (
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-slate-900">我主辦的案件（最大債權行）</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <StatCard icon="⏳" label="待各行確認（申報中）" value={summary.asMain.pendingConfirmations} to="/cases" />
                <StatCard icon="📣" label="待我回報成立/不成立" value={summary.asMain.outcomeToReport} to="/cases" tone="alert" />
              </div>
              <div className="rounded-2xl border border-surface-border bg-surface-raised p-5 shadow-card">
                <p className="mb-3 text-sm font-medium text-slate-900">各狀態案件</p>
                <StatusBreakdown data={summary.asMain.casesByStatus} />
              </div>
            </section>
          )}

          {/* 銀行人員：以其他債權行身分 */}
          {summary.asCoBank && (
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-slate-900">我受邀的案件（其他債權行）</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <StatCard icon="🔔" label="待我申報確認" value={summary.asCoBank.toConfirm} to="/cases" tone="alert" />
              </div>
              <div className="rounded-2xl border border-surface-border bg-surface-raised p-5 shadow-card">
                <p className="mb-3 text-sm font-medium text-slate-900">各狀態案件</p>
                <StatusBreakdown data={summary.asCoBank.casesByStatus} />
              </div>
            </section>
          )}

          {/* 平台管理員 */}
          {summary.role === 'ADMIN' && (
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-slate-900">平台管理</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <StatCard icon="📋" label="待啟用帳號" value={summary.pendingUserActivations ?? 0} to="/admin/users" tone="alert" />
                <StatCard icon="🔑" label="待處理重置申請" value={summary.pendingResetRequests ?? 0} to="/admin/users" tone="alert" />
                <StatCard icon="📁" label="全平台案件數" value={summary.totalCases ?? 0} to="/cases" />
              </div>
              <div className="rounded-2xl border border-surface-border bg-surface-raised p-5 shadow-card">
                <p className="mb-3 text-sm font-medium text-slate-900">各狀態案件</p>
                <StatusBreakdown data={summary.allCasesByStatus ?? {}} />
              </div>
            </section>
          )}

          {/* 平台稽核 */}
          {summary.role === 'PLATFORM_AUDITOR' && (
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-slate-900">稽核總覽</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <StatCard icon="📁" label="全平台案件數" value={summary.totalCases ?? 0} to="/cases" />
              </div>
              <div className="rounded-2xl border border-surface-border bg-surface-raised p-5 shadow-card">
                <p className="mb-3 text-sm font-medium text-slate-900">各狀態案件</p>
                <StatusBreakdown data={summary.allCasesByStatus ?? {}} />
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
