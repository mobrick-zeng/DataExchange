import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import { apiFetch } from '@/services/api'
import { Button } from '@/components/Button'
import { EmptyState } from '@/components/EmptyState'
import { SelectField } from '@/components/SelectField'
import { TextField } from '@/components/TextField'

interface CaseRow {
  caseId: string
  courtCode: string
  courtName: string
  docNumber: string
  mainBankCode: string
  mainBankName: string
  status: string
  receiptDate: string | null
  updatedAt: string
  consolidatedTotal: string | null
  participantCount: number
  confirmedCount: number
  myRoleInCase: string | null
  myConfirmationStatus: string | null
}
interface QueryResult { cases: CaseRow[]; total: number; page: number; size: number }
interface Opt { value: string; label: string }

export const CASE_STATUS_LABELS: Record<string, string> = {
  DRAFT: '草稿',
  PENDING_CONFIRMATION: '封閉申報中',
  PENDING_OUTCOME: '待回報',
  ESTABLISHED: '成立',
  NOT_ESTABLISHED: '不成立',
}
const STATUS_CLASS: Record<string, string> = {
  DRAFT: 'bg-slate-500/15 text-slate-700',
  PENDING_CONFIRMATION: 'bg-amber-500/15 text-amber-700',
  PENDING_OUTCOME: 'bg-blue-500/15 text-blue-700',
  ESTABLISHED: 'bg-emerald-500/15 text-emerald-700',
  NOT_ESTABLISHED: 'bg-rose-500/15 text-rose-700',
}
export const CONFIRM_STATUS_LABELS: Record<string, string> = {
  PENDING: '待確認',
  CONFIRMED: '已確認',
}

export function money(v: string | null | undefined): string {
  if (v == null) return '—'
  const n = Number(v)
  return isNaN(n) ? '—' : n.toLocaleString('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: 4 })
}

const fmtDate = (s: string | null | undefined) => (s ? s.slice(0, 10) : '—')

/** 搜尋字串刻意不放 URL（避免寫入存取日誌／瀏覽器紀錄），改存本分頁的 sessionStorage。 */
const Q_KEY = 'cases.q'
const readStoredQ = () => {
  try { return sessionStorage.getItem(Q_KEY) ?? '' } catch { return '' }
}
const writeStoredQ = (v: string) => {
  try { v ? sessionStorage.setItem(Q_KEY, v) : sessionStorage.removeItem(Q_KEY) } catch { /* 忽略：無 storage 也要能用 */ }
}

const TABS: Opt[] = [
  { value: 'open', label: '未結案' },
  { value: 'closed', label: '已結案' },
  { value: 'all', label: '全部' },
]
const SIZES = ['50', '100']

export function CasesPage() {
  const { currentUser } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  const [result, setResult] = useState<QueryResult>({ cases: [], total: 0, page: 1, size: 50 })
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [courts, setCourts] = useState<Opt[]>([])
  const [banks, setBanks] = useState<Opt[]>([])

  // 搜尋：輸入即時反映於畫面，實際查詢延遲 300ms（避免每個字都打 API）
  const [qInput, setQInput] = useState(readStoredQ)
  const [qDebounced, setQDebounced] = useState(readStoredQ)
  useEffect(() => {
    const t = window.setTimeout(() => { setQDebounced(qInput.trim()); writeStoredQ(qInput.trim()) }, 300)
    return () => window.clearTimeout(t)
  }, [qInput])

  const isBankStaff = currentUser?.role === 'BANK_STAFF'
  const canCreate = isBankStaff

  // ---- URL 查詢狀態 ----
  const tab = params.get('tab') ?? 'open'
  const status = params.get('status') ?? ''
  const court = params.get('court') ?? ''
  const main = params.get('main') ?? ''
  const roleFilter = params.get('role') ?? ''
  const myConf = params.get('myConf') ?? ''
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  const sort = params.get('sort') ?? 'updatedAt'
  const order = (params.get('order') ?? 'desc') as 'asc' | 'desc'
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1)
  const size = Math.min(100, Math.max(1, Number(params.get('size') ?? '50') || 50))

  /** 更新 URL 條件；除換頁外一律回到第 1 頁 */
  const setParam = useCallback((patch: Record<string, string>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    if (!('page' in patch)) next.delete('page')
    setParams(next)
  }, [params, setParams])

  const clearFilters = () => {
    setQInput(''); writeStoredQ('')
    setParams(new URLSearchParams({ tab }))
  }

  const activeFilterCount = [status, court, main, roleFilter, myConf, from, to].filter(Boolean).length + (qDebounced ? 1 : 0)

  useEffect(() => {
    Promise.all([
      apiFetch<{ courts: { courtCode: string; courtName: string }[] }>('/api/courts?activeOnly=1'),
      apiFetch<{ banks: { bankCode: string; bankName: string }[] }>('/api/banks?activeOnly=1'),
    ])
      .then(([cr, bk]) => {
        setCourts(cr.courts.map((c) => ({ value: c.courtCode, label: c.courtName })))
        setBanks(bk.banks.filter((b) => b.bankCode !== 'PLATFORM').map((b) => ({ value: b.bankCode, label: b.bankName })))
      })
      .catch(() => { /* 篩選下拉載入失敗不阻斷列表 */ })
  }, [])

  const load = useCallback(() => {
    setLoading(true)
    setSelected(new Set())
    const body: Record<string, unknown> = { tab, sort, order, page, size }
    if (status) body.status = [status]
    if (court) body.court = [court]
    if (main) body.main = main
    if (isBankStaff && roleFilter) body.role = roleFilter
    if (isBankStaff && myConf) body.myConf = myConf
    if (from) body.from = from
    if (to) body.to = to
    if (qDebounced) body.q = qDebounced
    apiFetch<QueryResult>('/api/cases/query', { method: 'POST', body: JSON.stringify(body) })
      .then(setResult)
      .catch((e) => toast.error((e as Error).message ?? '載入失敗'))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, status, court, main, roleFilter, myConf, from, to, sort, order, page, size, qDebounced, isBankStaff])
  useEffect(load, [load])

  const cases = result.cases
  const totalPages = Math.max(1, Math.ceil(result.total / result.size))
  // 本頁可批次確認者（分頁後「全選」只涵蓋本頁，UI 需明確標示）
  const confirmableOnPage = useMemo(
    () => cases.filter((c) => c.status === 'PENDING_CONFIRMATION' && !!c.myRoleInCase && c.myConfirmationStatus === 'PENDING'),
    [cases],
  )
  const allPagePicked = confirmableOnPage.length > 0 && confirmableOnPage.every((c) => selected.has(c.caseId))

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  const togglePage = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allPagePicked) confirmableOnPage.forEach((c) => next.delete(c.caseId))
      else confirmableOnPage.forEach((c) => next.add(c.caseId))
      return next
    })
  }

  const batchConfirm = async () => {
    if (selected.size === 0) return
    try {
      await apiFetch('/api/cases/batch-confirm', { method: 'POST', body: JSON.stringify({ caseIds: [...selected] }) })
      toast.success(`已確認 ${selected.size} 件`)
      load()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const sortHeader = (key: string, label: string) => {
    const on = sort === key
    return (
      <button type="button" className={`inline-flex items-center gap-1 ${on ? 'text-slate-900' : 'hover:text-slate-700'}`}
        onClick={() => setParam({ sort: key, order: on && order === 'desc' ? 'asc' : 'desc' })}>
        {label}<span className="text-[10px]">{on ? (order === 'desc' ? '▼' : '▲') : '↕'}</span>
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">案件列表</h1>
        {canCreate && <Button onClick={() => navigate('/cases/new')}>＋ 新增案件</Button>}
      </div>

      {/* 頁簽：未結案／已結案／全部 */}
      <div className="flex gap-1 rounded-xl border border-surface-border bg-surface-raised p-1">
        {TABS.map((t) => (
          <button key={t.value} type="button" onClick={() => setParam({ tab: t.value })}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              tab === t.value ? 'bg-brand-600/12 text-brand-700 ring-1 ring-inset ring-brand-500/30' : 'text-slate-500 hover:bg-surface-muted hover:text-slate-900'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* 篩選列 */}
      <div className="rounded-2xl border border-surface-border bg-surface-raised p-4 shadow-card">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <TextField label="公文文號搜尋" value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="例：1130000104" />
          <SelectField label="法院" placeholder="全部法院" value={court} onChange={(e) => setParam({ court: e.target.value })} options={courts} />
          <SelectField label="狀態" placeholder="全部狀態" value={status} onChange={(e) => setParam({ status: e.target.value })}
            options={Object.entries(CASE_STATUS_LABELS).map(([v, l]) => ({ value: v, label: l }))} />
          <SelectField label="最大債權行" placeholder="全部" value={main} onChange={(e) => setParam({ main: e.target.value })} options={banks} />
          {isBankStaff && (
            <>
              <SelectField label="我的角色" placeholder="全部" value={roleFilter} onChange={(e) => setParam({ role: e.target.value })}
                options={[{ value: 'MAIN', label: '主辦（最大債權行）' }, { value: 'CO_BANK', label: '其他債權行' }]} />
              <SelectField label="我的確認" placeholder="全部" value={myConf} onChange={(e) => setParam({ myConf: e.target.value })}
                options={[{ value: 'PENDING', label: '待確認' }, { value: 'CONFIRMED', label: '已確認' }]} />
            </>
          )}
          <TextField label="收文日（起）" type="date" value={from} onChange={(e) => setParam({ from: e.target.value })} />
          <TextField label="收文日（迄）" type="date" value={to} onChange={(e) => setParam({ to: e.target.value })} />
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            共 <b className="text-slate-900">{result.total}</b> 件
            {activeFilterCount > 0 && <>（已套用 {activeFilterCount} 項條件）</>}
          </p>
          {activeFilterCount > 0 && (
            <button type="button" onClick={clearFilters} className="text-xs font-medium text-brand-700 hover:underline">清除條件</button>
          )}
        </div>
      </div>

      {confirmableOnPage.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3">
          <p className="text-sm text-amber-800">
            本頁有 {confirmableOnPage.length} 件待你申報確認（<b>已選本頁 {selected.size} 件</b>）。
            <span className="text-amber-700">批次確認僅套用於已勾選的項目。</span>
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={togglePage}>{allPagePicked ? '取消全選本頁' : '全選本頁'}</Button>
            <Button size="sm" onClick={batchConfirm} disabled={selected.size === 0}>批次確認</Button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">載入中…</p>
      ) : cases.length === 0 ? (
        activeFilterCount > 0 ? (
          <EmptyState icon="🔍" title="沒有符合條件的案件" description="調整或清除篩選條件再試一次。" />
        ) : (
          <EmptyState icon="📁" title="目前沒有案件" description={canCreate ? '點右上角「新增案件」開始建立。' : '目前沒有與您相關的案件。'} />
        )
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-surface-border bg-surface-raised shadow-card">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-surface-border text-left text-xs text-slate-500">
                  <th className="w-10 p-3">
                    {confirmableOnPage.length > 0 && (
                      <input type="checkbox" checked={allPagePicked} onChange={togglePage} aria-label="全選本頁" />
                    )}
                  </th>
                  <th className="p-3">{sortHeader('docNumber', '公文文號')}</th>
                  <th className="p-3">法院</th>
                  <th className="p-3">{sortHeader('mainBankCode', '最大債權行')}</th>
                  <th className="p-3">{sortHeader('status', '狀態')}</th>
                  <th className="p-3">{sortHeader('receiptDate', '收文日')}</th>
                  <th className="p-3">我的角色</th>
                  <th className="p-3">我的確認</th>
                  <th className="p-3">確認進度</th>
                  <th className="p-3 text-right">彙整總額</th>
                </tr>
              </thead>
              <tbody>
                {cases.map((c) => {
                  const canPick = c.status === 'PENDING_CONFIRMATION' && !!c.myRoleInCase && c.myConfirmationStatus === 'PENDING'
                  return (
                    <tr key={c.caseId} className="border-b border-surface-border last:border-0 hover:bg-surface-muted/40">
                      <td className="p-3">
                        {canPick && <input type="checkbox" checked={selected.has(c.caseId)} onChange={() => toggle(c.caseId)} />}
                      </td>
                      <td className="p-3">
                        <Link to={`/cases/${c.caseId}`} className="font-medium text-brand-700 hover:underline">{c.docNumber}</Link>
                      </td>
                      <td className="p-3 text-slate-900">{c.courtName}</td>
                      <td className="p-3 text-slate-700">{c.mainBankName}</td>
                      <td className="p-3">
                        <span className={`rounded-full px-2.5 py-1 text-xs ${STATUS_CLASS[c.status] ?? 'bg-slate-500/15 text-slate-700'}`}>
                          {CASE_STATUS_LABELS[c.status] ?? c.status}
                        </span>
                      </td>
                      <td className="p-3 text-slate-700">{fmtDate(c.receiptDate)}</td>
                      <td className="p-3 text-slate-700">{c.myRoleInCase === 'MAIN' ? '主辦（最大債權行）' : c.myRoleInCase === 'CO_BANK' ? '其他債權行' : '—'}</td>
                      <td className="p-3 text-slate-700">{CONFIRM_STATUS_LABELS[c.myConfirmationStatus ?? ''] ?? '—'}</td>
                      <td className="p-3 text-slate-700">{c.confirmedCount}/{c.participantCount}</td>
                      <td className="p-3 text-right text-slate-900">{money(c.consolidatedTotal)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* 分頁 */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <span>每頁</span>
              <select value={String(size)} onChange={(e) => setParam({ size: e.target.value })}
                className="rounded-lg border border-surface-border bg-surface-raised px-2 py-1 text-sm text-slate-900">
                {SIZES.map((s) => <option key={s} value={s}>{s} 筆</option>)}
              </select>
              <span>第 {result.page} / {totalPages} 頁</span>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setParam({ page: String(page - 1) })}>上一頁</Button>
              <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setParam({ page: String(page + 1) })}>下一頁</Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
