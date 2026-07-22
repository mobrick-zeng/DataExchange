import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import { apiFetch } from '@/services/api'
import { Button } from '@/components/Button'
import { EmptyState } from '@/components/EmptyState'

interface CaseRow {
  caseId: string
  courtCode: string
  courtName: string
  docNumber: string
  mainBankCode: string
  mainBankName: string
  status: string
  confirmationDeadline: string | null
  totalDebtAmount: string | null
  participantCount: number
  myRoleInCase: string | null
  myConfirmationStatus: string | null
}

export const CASE_STATUS_LABELS: Record<string, string> = {
  DRAFT: '建立中',
  PENDING_CONFIRMATION: '待確認',
  IN_REPAYMENT: '還款中',
  SETTLED: '已結清',
  TERMINATED: '毀諾／終止',
}
const STATUS_CLASS: Record<string, string> = {
  DRAFT: 'bg-slate-500/15 text-slate-700',
  PENDING_CONFIRMATION: 'bg-amber-500/15 text-amber-700',
  IN_REPAYMENT: 'bg-blue-500/15 text-blue-700',
  SETTLED: 'bg-emerald-500/15 text-emerald-700',
  TERMINATED: 'bg-rose-500/15 text-rose-700',
}
export const CONFIRM_STATUS_LABELS: Record<string, string> = {
  NOT_REQUIRED: '—',
  PENDING: '待確認',
  CONFIRMED: '已確認',
  DISPUTED: '已回報異議',
}

export function money(v: string | null | undefined): string {
  if (v == null) return '—'
  const n = Number(v)
  return isNaN(n) ? '—' : n.toLocaleString('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: 4 })
}

export function CasesPage() {
  const { currentUser } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [cases, setCases] = useState<CaseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const canCreate = currentUser?.role === 'BANK_STAFF'

  const load = () => {
    setLoading(true)
    apiFetch<{ cases: CaseRow[] }>('/api/cases')
      .then((r) => setCases(r.cases))
      .catch((e) => toast.error((e as Error).message ?? '載入失敗'))
      .finally(() => setLoading(false))
  }
  useEffect(load, []) // eslint-disable-line react-hooks/exhaustive-deps

  const confirmable = cases.filter((c) => c.myRoleInCase === 'CO_BANK' && c.myConfirmationStatus === 'PENDING')

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const batchConfirm = async () => {
    if (selected.size === 0) return
    try {
      await apiFetch('/api/cases/batch-confirm', { method: 'POST', body: JSON.stringify({ caseIds: [...selected] }) })
      toast.success(`已確認 ${selected.size} 件`)
      setSelected(new Set())
      load()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">案件列表</h1>
        {canCreate && <Button onClick={() => navigate('/cases/new')}>➕ 新增案件</Button>}
      </div>

      {confirmable.length > 0 && (
        <div className="flex items-center justify-between rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3">
          <p className="text-sm text-amber-800">
            有 {confirmable.length} 件待你確認，可勾選後批次確認（已選 {selected.size} 件）
          </p>
          <Button size="sm" onClick={batchConfirm} disabled={selected.size === 0}>批次確認</Button>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">載入中…</p>
      ) : cases.length === 0 ? (
        <EmptyState icon="📁" title="目前沒有案件" description={canCreate ? '點右上角「新增案件」開始建立。' : '目前沒有與您相關的案件。'} />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-surface-border bg-surface-raised shadow-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-surface-border text-left text-xs text-slate-500">
                <th className="w-10 p-3"></th>
                <th className="p-3">公文文號</th>
                <th className="p-3">法院</th>
                <th className="p-3">最大債權行</th>
                <th className="p-3">狀態</th>
                <th className="p-3">我的角色</th>
                <th className="p-3">我的確認</th>
                <th className="p-3 text-right">總債權額</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => {
                const canPick = c.myRoleInCase === 'CO_BANK' && c.myConfirmationStatus === 'PENDING'
                return (
                  <tr key={c.caseId} className="border-b border-surface-border last:border-0 hover:bg-surface-muted/40">
                    <td className="p-3">
                      {canPick && (
                        <input type="checkbox" checked={selected.has(c.caseId)} onChange={() => toggle(c.caseId)} />
                      )}
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
                    <td className="p-3 text-slate-700">{c.myRoleInCase === 'MAIN' ? '最大債權行' : c.myRoleInCase === 'CO_BANK' ? '其他債權行' : '—'}</td>
                    <td className="p-3 text-slate-700">{CONFIRM_STATUS_LABELS[c.myConfirmationStatus ?? ''] ?? '—'}</td>
                    <td className="p-3 text-right text-slate-900">{money(c.totalDebtAmount)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
