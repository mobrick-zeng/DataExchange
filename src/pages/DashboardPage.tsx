import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { formatBankLabel, ROLE_LABELS } from '@/utils/labels'
import { formatDate, formatDateTime } from '@/utils/datetime'
import { apiFetch, ApiError } from '@/services/api'
import { Button } from '@/components/Button'
import { EmptyState } from '@/components/EmptyState'
import { Spinner } from '@/components/Spinner'
import { CASE_STATUS_LABELS } from '@/pages/CasesPage'

// ---------------------------------------------------------------- 型別

type QueueKind = 'DECLARE' | 'CONFIRM' | 'REPORT' | 'PUBLISH' | 'REVIEW'

interface QueueItem {
  caseId: string
  docNumber: string
  courtName: string
  mainBankCode: string
  mainBankName: string
  roleInCase: string
  status: string
  round: number
  kind: QueueKind
  mediationDate: string | null
  mediationTime: string | null
}

interface Deadline {
  caseId: string
  docNumber: string
  kind: 'MEDIATION' | 'INTEREST_CUTOFF'
  date: string
  time: string | null
  daysLeft: number
}

interface RecentNote {
  notificationId: string
  type: string
  message: string
  isRead: boolean
  relatedCaseId: string | null
  docNumber: string | null
  createdAt: string
}

interface AuditRow {
  logId: string
  actionType: string
  bankCode: string | null
  targetType?: string | null
  targetId?: string | null
  docNumber?: string | null
  detail: string | null
  createdAt: string
}

interface DashboardSummary {
  role: string
  bankCode: string | null
  unreadNotifications: number
  generatedAt: string
  // 銀行人員
  actionQueue?: QueueItem[]
  actionQueueTotal?: number
  deadlines?: Deadline[]
  deadlineWindowDays?: number
  asMain?: { selfPending: number; byStatus: Record<string, number> }
  asCoBank?: { toConfirm: number; byStatus: Record<string, number> }
  recent?: RecentNote[]
  // 平台共用
  allCasesByStatus?: Record<string, number>
  totalCases?: number
  // 稽核
  doubtHotspots?: {
    caseId: string; docNumber: string; round: number; status: string
    mainBankCode: string; mainBankName: string
    lastDoubtBankCode: string | null; lastDoubtAt: string | null
  }[]
  monthly?: { disclosedCount: number; doubtCount: number; closedCount: number; avgConfirmDays: number | null; since: string }
  recentAudit?: AuditRow[]
  // 管理員
  pendingUserActivations?: number
  pendingResetRequests?: number
  activeBanks?: number
  activeCourts?: number
  bankActivity?: { bankCode: string; bankName: string; count: number }[]
  bankActivityDays?: number
  recentGovernance?: AuditRow[]
}

// ---------------------------------------------------------------- 常數

const QUEUE_META: Record<QueueKind, { label: string; cta: string; tone: string; dot: string }> = {
  DECLARE: { label: '待我填報', cta: '填報本行債權', tone: 'bg-rose-500/10 text-rose-700 ring-rose-500/25', dot: 'bg-rose-500' },
  CONFIRM: { label: '待我確認', cta: '確認無誤', tone: 'bg-amber-500/10 text-amber-700 ring-amber-500/25', dot: 'bg-amber-500' },
  REPORT: { label: '待我回報', cta: '前往回報', tone: 'bg-brand-600/10 text-brand-700 ring-brand-600/25', dot: 'bg-brand-600' },
  PUBLISH: { label: '待發布', cta: '邀請並發布', tone: 'bg-violet-500/10 text-violet-700 ring-violet-500/25', dot: 'bg-violet-500' },
  REVIEW: { label: '揭露後待檢視', tone: 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/25', cta: '檢視彙整表', dot: 'bg-emerald-500' },
}

const NOTIFICATION_LABELS: Record<string, string> = {
  CASE_INVITATION: '受邀參與案件',
  CASE_PUBLISHED: '案件已發布',
  PARTICIPANT_CONFIRMED: '參與行完成確認',
  ALL_CONFIRMED_DISCLOSED: '全員確認並揭露',
  DOUBT_RAISED: '有人標記疑義',
  REOPENED_FOR_DOUBT: '因疑義退回重新確認',
  PARTICIPATION_REJECTED: '參與行拒絕參與',
  PARTICIPANT_REMOVED: '被移出案件',
  CASE_ESTABLISHED: '案件回報成立',
  CASE_NOT_ESTABLISHED: '案件回報不成立',
}

const AUDIT_LABELS: Record<string, string> = {
  CASE_CREATED: '建立案件', CASE_UPDATED: '異動案件', CASE_DELETED: '刪除草稿案件',
  PARTICIPANT_INVITED: '邀請參與行', PARTICIPANT_REMOVED: '移出參與行', PARTICIPATION_REJECTED: '拒絕參與',
  CASE_PUBLISHED: '發布案件', DECLARATION_SUBMITTED: '填報本行債權', CASE_CONFIRMED: '確認本行債權',
  CONFIRMATION_WITHDRAWN: '撤回確認', CASE_DISCLOSED: '案件揭露', DOUBT_RAISED: '標記疑義',
  CASE_ESTABLISHED: '回報成立', CASE_NOT_ESTABLISHED: '回報不成立',
  ACCOUNT_CREATED: '建立帳號', ACCOUNT_ACTIVATED: '帳號啟用完成', ACCOUNT_SUSPENDED: '停用帳號',
  ACCOUNT_REACTIVATED: '恢復帳號', ACCOUNT_LOCKED: '帳號鎖定', ACCOUNT_UNLOCKED: '帳號解鎖',
  PASSWORD_RESET_REQUESTED: '申請密碼重置', PASSWORD_RESET_ISSUED: '核發密碼重置碼',
  BANK_ACTIVATED: '啟用機構', BANK_DEACTIVATED: '停用機構',
  COURT_ACTIVATED: '啟用法院', COURT_DEACTIVATED: '停用法院',
}

/** 相對時間：一週內以「幾分鐘／小時／天前」呈現，更久則回落為絕對時間 */
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60_000)
  if (min < 1) return '剛剛'
  if (min < 60) return `${min} 分鐘前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小時前`
  const day = Math.floor(hr / 24)
  if (day === 1) return '昨天'
  if (day < 7) return `${day} 天前`
  return formatDateTime(iso)
}

// ---------------------------------------------------------------- 共用元件

function Card({ title, hint, action, children }: {
  title: string; hint?: string; action?: React.ReactNode; children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border border-surface-border bg-surface-raised p-5 shadow-card">
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {hint && <span className="text-xs text-slate-500">{hint}</span>}
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {children}
    </section>
  )
}

/** KPI 磚：點擊即帶入案件列表對應篩選（deep-link，可 F5 重現） */
function Kpi({ label, value, to, emphasis = false }: {
  label: string; value: number; to: string; emphasis?: boolean
}) {
  const active = emphasis && value > 0
  return (
    <Link
      to={to}
      className={`flex flex-col gap-1 rounded-xl border p-3 transition-colors ${
        active
          ? 'border-rose-500/30 bg-rose-500/5 hover:bg-rose-500/10'
          : 'border-surface-border bg-surface-muted/30 hover:bg-surface-muted/60'
      }`}
    >
      <span className={`text-xl font-semibold tabular-nums ${active ? 'text-rose-600' : 'text-slate-900'}`}>{value}</span>
      <span className="text-xs text-slate-600">{label}</span>
    </Link>
  )
}

function Stat({ label, value, unit }: { label: string; value: string | number; unit?: string }) {
  return (
    <div className="rounded-xl border border-surface-border bg-surface-muted/30 p-3">
      <div className="flex items-baseline gap-1">
        <span className="text-xl font-semibold tabular-nums text-slate-900">{value}</span>
        {unit && <span className="text-xs text-slate-500">{unit}</span>}
      </div>
      <p className="mt-1 text-xs text-slate-600">{label}</p>
    </div>
  )
}

function StatusBreakdown({ data }: { data: Record<string, number> }) {
  const order = ['DRAFT', 'PENDING_CONFIRMATION', 'PENDING_OUTCOME', 'ESTABLISHED', 'NOT_ESTABLISHED']
  const entries = order.filter((s) => data[s] != null)
  if (entries.length === 0) return <p className="text-sm text-slate-500">目前沒有案件。</p>
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {entries.map((s) => (
        <Link
          key={s}
          to={`/cases?tab=all&status=${s}`}
          className="rounded-xl border border-surface-border bg-surface-muted/30 p-3 transition-colors hover:bg-surface-muted/60"
        >
          <div className="text-xl font-semibold tabular-nums text-slate-900">{data[s]}</div>
          <p className="mt-1 text-xs text-slate-600">{CASE_STATUS_LABELS[s] ?? s}</p>
        </Link>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- 頁面

export function DashboardPage() {
  const { currentUser, logout } = useAuth()
  const navigate = useNavigate()
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()

  // 刻意不做自動輪詢：資料僅於進頁與使用者按「重新整理」（或 F5）時取用
  const load = useCallback(() => {
    setLoading(true)
    apiFetch<DashboardSummary>('/api/dashboard/summary')
      .then((s) => { setSummary(s); setError(undefined) })
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

  useEffect(load, [load])

  if (!currentUser) return null

  const isBank = summary?.role === 'BANK_STAFF'
  const queue = summary?.actionQueue ?? []
  const queueTotal = summary?.actionQueueTotal ?? 0

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6">
      {/* ---------- 頁首 ---------- */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            您好，{currentUser.name}
            {currentUser.role && <span className="text-slate-500">（{ROLE_LABELS[currentUser.role]}）</span>}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            所屬機構：{formatBankLabel(currentUser.bankCode, currentUser.bankName)}
            {summary && <span className="text-slate-400">　·　資料時間 {formatDateTime(summary.generatedAt)}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {summary && summary.unreadNotifications > 0 && (
            <span className="rounded-full bg-brand-600/10 px-3 py-1 text-sm font-medium text-brand-700">
              🔔 {summary.unreadNotifications} 則未讀通知
            </span>
          )}
          <Button variant="secondary" size="sm" onClick={load} disabled={loading}>重新整理</Button>
        </div>
      </header>

      {loading && !summary && <Spinner />}

      {error && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-600">{error}</div>
      )}

      {summary && !error && (
        <>
          {/* ================= 銀行人員 ================= */}
          {isBank && (
            <>
              {/* --- 需要您處理 --- */}
              <Card
                title="需要您處理"
                hint={queueTotal > 0 ? `共 ${queueTotal} 筆待處理` : undefined}
                action={
                  queueTotal > queue.length
                    ? <Link to="/cases?tab=open" className="text-xs font-medium text-brand-700 hover:underline">查看全部 {queueTotal} 筆待處理 →</Link>
                    : undefined
                }
              >
                {queue.length === 0 ? (
                  <EmptyState
                    icon="✅"
                    title="目前沒有待您處理的事項"
                    description="所有案件的本行動作皆已完成。新的邀請或退回會出現在這裡，也會發送站內通知。"
                    action={<Link to="/cases" className="text-xs font-medium text-brand-700 hover:underline">前往案件列表 →</Link>}
                  />
                ) : (
                  <ul className="flex flex-col divide-y divide-surface-border">
                    {queue.map((q) => {
                      const meta = QUEUE_META[q.kind]
                      return (
                        <li key={`${q.caseId}-${q.kind}`} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} aria-hidden="true" />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="truncate text-sm font-medium text-slate-900">{q.docNumber}</span>
                              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${meta.tone}`}>{meta.label}</span>
                              {q.round > 1 && (
                                <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] text-slate-600">第 {q.round} 輪</span>
                              )}
                            </div>
                            <p className="mt-0.5 truncate text-xs text-slate-500">
                              {q.courtName}
                              　·　{q.roleInCase === 'MAIN' ? '本行主辦' : `主辦 ${formatBankLabel(q.mainBankCode, q.mainBankName)}`}
                              {q.mediationDate && `　·　庭期 ${formatDate(q.mediationDate)}${q.mediationTime ? ` ${q.mediationTime}` : ''}`}
                            </p>
                          </div>
                          <Link
                            to={`/cases/${q.caseId}`}
                            className="shrink-0 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-500"
                          >
                            {meta.cta}
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </Card>

              {/* --- 期限將至 --- */}
              <Card title="期限將至" hint={`未來 ${summary.deadlineWindowDays ?? 14} 天內的調解庭期與利息計算截止日`}>
                {(summary.deadlines ?? []).length === 0 ? (
                  <p className="text-sm text-slate-500">未來 {summary.deadlineWindowDays ?? 14} 天內沒有即將到期的項目。</p>
                ) : (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {(summary.deadlines ?? []).map((d) => {
                      const urgent = d.daysLeft <= 3
                      return (
                        <Link
                          key={`${d.caseId}-${d.kind}`}
                          to={`/cases/${d.caseId}`}
                          className={`rounded-xl border p-3 transition-colors ${
                            urgent ? 'border-rose-500/30 bg-rose-500/5 hover:bg-rose-500/10' : 'border-surface-border bg-surface-muted/30 hover:bg-surface-muted/60'
                          }`}
                        >
                          <p className="truncate text-sm font-medium text-slate-900">{d.docNumber}</p>
                          <p className="mt-1 text-xs text-slate-600">
                            {d.kind === 'MEDIATION' ? '調解庭期' : '利息計算截止'} {formatDate(d.date)}
                            {d.kind === 'MEDIATION' && d.time ? ` ${d.time}` : ''}
                          </p>
                          <p className={`mt-1 text-xs font-medium ${urgent ? 'text-rose-600' : 'text-slate-500'}`}>
                            {d.daysLeft === 0 ? '就是今天' : `還剩 ${d.daysLeft} 天`}
                          </p>
                        </Link>
                      )
                    })}
                  </div>
                )}
              </Card>

              {/* --- 雙軌 KPI --- */}
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <Card title="我主辦的案件" hint="最大債權行">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <Kpi label="本行待填報" value={summary.asMain?.selfPending ?? 0} emphasis
                      to="/cases?tab=open&role=MAIN&myConf=PENDING" />
                    {['DRAFT', 'PENDING_CONFIRMATION', 'PENDING_OUTCOME', 'ESTABLISHED', 'NOT_ESTABLISHED'].map((s) => (
                      <Kpi key={s} label={CASE_STATUS_LABELS[s] ?? s} value={summary.asMain?.byStatus[s] ?? 0}
                        to={`/cases?tab=all&role=MAIN&status=${s}`} />
                    ))}
                  </div>
                </Card>

                <Card title="我受邀的案件" hint="其他債權行">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <Kpi label="待我確認" value={summary.asCoBank?.toConfirm ?? 0} emphasis
                      to="/cases?tab=open&role=CO_BANK&myConf=PENDING&status=PENDING_CONFIRMATION" />
                    {['PENDING_CONFIRMATION', 'PENDING_OUTCOME', 'ESTABLISHED', 'NOT_ESTABLISHED'].map((s) => (
                      <Kpi key={s} label={CASE_STATUS_LABELS[s] ?? s} value={summary.asCoBank?.byStatus[s] ?? 0}
                        to={`/cases?tab=all&role=CO_BANK&status=${s}`} />
                    ))}
                  </div>
                </Card>
              </div>
              <p className="-mt-2 px-1 text-xs text-slate-500">點任一格即帶入案件列表對應篩選（角色／狀態／本行確認狀態）。</p>

              {/* --- 最近動態 --- */}
              <Card title="最近動態" hint="僅顯示與本行參與案件相關的動態">
                {(summary.recent ?? []).length === 0 ? (
                  <p className="text-sm text-slate-500">目前沒有動態。</p>
                ) : (
                  <ul className="flex flex-col divide-y divide-surface-border">
                    {(summary.recent ?? []).map((n) => (
                      <li key={n.notificationId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-slate-900">
                            {!n.isRead && <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-brand-600 align-middle" aria-label="未讀" />}
                            <span className="font-medium">{NOTIFICATION_LABELS[n.type] ?? n.type}</span>
                            {n.docNumber && <span className="text-slate-600">　{n.docNumber}</span>}
                          </p>
                          <p className="truncate text-xs text-slate-500">{n.message}</p>
                        </div>
                        <span className="shrink-0 text-xs text-slate-400">{relativeTime(n.createdAt)}</span>
                        {n.relatedCaseId && (
                          <Link to={`/cases/${n.relatedCaseId}`} className="shrink-0 text-xs font-medium text-brand-700 hover:underline">前往案件 →</Link>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </>
          )}

          {/* ================= 平台稽核 ================= */}
          {summary.role === 'PLATFORM_AUDITOR' && (
            <>
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-800">
                <b className="font-semibold">稽核總覽</b>：全案唯讀，可見各行明細與對內債權；監督視角，不介入案件流程。
              </div>

              <Card title="全平台案件（各狀態）" hint={`共 ${summary.totalCases ?? 0} 件`}>
                <StatusBreakdown data={summary.allCasesByStatus ?? {}} />
              </Card>

              <Card title="本月監督指標" hint={summary.monthly ? `統計自 ${formatDate(summary.monthly.since)}` : undefined}>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <Stat label="完成揭露案件" value={summary.monthly?.disclosedCount ?? 0} unit="件" />
                  <Stat label="疑義退回次數" value={summary.monthly?.doubtCount ?? 0} unit="次" />
                  <Stat label="平均建案至揭露天數" value={summary.monthly?.avgConfirmDays ?? '—'} unit="天" />
                  <Stat label="本月結案（成立／不成立）" value={summary.monthly?.closedCount ?? 0} unit="件" />
                </div>
              </Card>

              <Card title="疑義熱點（反覆退回）" hint="輪次 ≥ 2 的案件自動列入，供監督關注協商僵局">
                {(summary.doubtHotspots ?? []).length === 0 ? (
                  <p className="text-sm text-slate-500">目前沒有被退回重新確認的案件。</p>
                ) : (
                  <ul className="flex flex-col divide-y divide-surface-border">
                    {(summary.doubtHotspots ?? []).map((h) => (
                      <li key={h.caseId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-900">{h.docNumber}</p>
                          <p className="truncate text-xs text-slate-500">
                            {formatBankLabel(h.mainBankCode, h.mainBankName)} 主辦
                            {h.lastDoubtBankCode && `　·　最近疑義：${h.lastDoubtBankCode}`}
                            {h.lastDoubtAt && `（${formatDate(h.lastDoubtAt)}）`}
                          </p>
                        </div>
                        <span className="shrink-0 rounded-full bg-rose-500/10 px-2 py-0.5 text-[11px] font-medium text-rose-700 ring-1 ring-inset ring-rose-500/25">
                          已退回 {h.round - 1} 輪
                        </span>
                        <Link to={`/cases/${h.caseId}`} className="shrink-0 text-xs font-medium text-brand-700 hover:underline">檢視 →</Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card title="稽核事件流（全平台）" action={<Link to="/audit-logs" className="text-xs font-medium text-brand-700 hover:underline">完整操作紀錄 →</Link>}>
                {(summary.recentAudit ?? []).length === 0 ? (
                  <p className="text-sm text-slate-500">目前沒有案件事件。</p>
                ) : (
                  <ul className="flex flex-col divide-y divide-surface-border">
                    {(summary.recentAudit ?? []).map((l) => (
                      <li key={l.logId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-slate-900">
                            <span className="font-medium">{AUDIT_LABELS[l.actionType] ?? l.actionType}</span>
                            {l.docNumber && <span className="text-slate-600">　{l.docNumber}</span>}
                          </p>
                          <p className="truncate text-xs text-slate-500">
                            {l.bankCode ?? '系統'}
                            {l.detail && `　·　${l.detail}`}
                          </p>
                        </div>
                        <span className="shrink-0 text-xs text-slate-400">{formatDateTime(l.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </>
          )}

          {/* ================= 平台管理員 ================= */}
          {summary.role === 'ADMIN' && (
            <>
              <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 px-4 py-3 text-sm text-violet-800">
                <b className="font-semibold">平台全盲</b>：本平台不儲存、不顯示任何債權金額或明細。此頁僅呈現案件狀態與進度，以及帳號／機構治理資訊。
              </div>

              <Card title="待處理事項">
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <Kpi label="待啟用帳號" value={summary.pendingUserActivations ?? 0} to="/admin/users" emphasis />
                  <Kpi label="待處理密碼重置申請" value={summary.pendingResetRequests ?? 0} to="/admin/users" emphasis />
                  <Kpi label="已啟用銀行" value={summary.activeBanks ?? 0} to="/admin/institutions" />
                  <Kpi label="已啟用法院" value={summary.activeCourts ?? 0} to="/admin/institutions" />
                </div>
              </Card>

              <Card title="全平台案件（各狀態）" hint={`共 ${summary.totalCases ?? 0} 件　·　僅件數，無金額`}>
                <StatusBreakdown data={summary.allCasesByStatus ?? {}} />
              </Card>

              <Card title="機構起案活躍度" hint={`近 ${summary.bankActivityDays ?? 30} 天，僅統計起案件數，不涉及任何金額`}>
                {(summary.bankActivity ?? []).length === 0 ? (
                  <p className="text-sm text-slate-500">近期沒有新建案件。</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {(summary.bankActivity ?? []).map((b) => {
                      const max = Math.max(...(summary.bankActivity ?? []).map((x) => x.count), 1)
                      return (
                        <li key={b.bankCode} className="flex items-center gap-3">
                          <span className="w-40 shrink-0 truncate text-sm text-slate-700">{formatBankLabel(b.bankCode, b.bankName)}</span>
                          <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted">
                            <span className="block h-full rounded-full bg-brand-600" style={{ width: `${(b.count / max) * 100}%` }} />
                          </span>
                          <span className="w-8 shrink-0 text-right text-sm font-semibold tabular-nums text-slate-900">{b.count}</span>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </Card>

              <Card title="最近治理事件" action={<Link to="/audit-logs" className="text-xs font-medium text-brand-700 hover:underline">完整操作紀錄 →</Link>}>
                {(summary.recentGovernance ?? []).length === 0 ? (
                  <p className="text-sm text-slate-500">目前沒有治理事件。</p>
                ) : (
                  <ul className="flex flex-col divide-y divide-surface-border">
                    {(summary.recentGovernance ?? []).map((l) => (
                      <li key={l.logId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-900">{AUDIT_LABELS[l.actionType] ?? l.actionType}</p>
                          <p className="truncate text-xs text-slate-500">
                            {l.bankCode ?? '平台'}
                            {l.detail && `　·　${l.detail}`}
                          </p>
                        </div>
                        <span className="shrink-0 text-xs text-slate-400">{formatDateTime(l.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </>
          )}
        </>
      )}
    </div>
  )
}
