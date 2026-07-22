import { useCallback, useEffect, useState } from 'react'
import { useToast } from '@/hooks/useToast'
import { apiFetch } from '@/services/api'
import { SelectField } from '@/components/SelectField'
import { EmptyState } from '@/components/EmptyState'
import { formatDateTime } from '@/utils/datetime'

interface AuditRow {
  logId: string
  actionType: string
  userName: string | null
  bankName: string | null
  bankCode: string | null
  detail: string | null
  createdAt: string
}

const ACTION_LABELS: Record<string, string> = {
  LOGIN_SUCCESS: '登入成功', LOGIN_FAILED: '登入失敗', LOGOUT: '登出',
  CREATE_CASE: '建立案件', UPDATE_CASE: '編輯案件', PUBLISH_CASE: '發布案件', INVITE_BANK: '邀請銀行',
  CONFIRM_CASE_RECEIPT: '確認案件', DISPUTE_CASE: '回報異議', RECORD_REPAYMENT: '登記還款',
  SETTLE_CASE: '結清案件', TERMINATE_CASE: '終止案件', VIEW_INTERNAL_TOTAL: '查看內部金額',
  ACCOUNT_APPROVED: '核准帳號', ACCOUNT_REJECTED: '駁回帳號', ACCOUNT_SUSPENDED: '停用帳號', ACCOUNT_REACTIVATED: '重啟帳號',
}

const ACTION_FILTERS = [{ value: '', label: '全部事件' }, ...Object.entries(ACTION_LABELS).map(([value, label]) => ({ value, label }))]

export function AuditLogsPage() {
  const toast = useToast()
  const [logs, setLogs] = useState<AuditRow[]>([])
  const [actionType, setActionType] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    apiFetch<{ logs: AuditRow[] }>(`/api/audit-logs?limit=200${actionType ? `&actionType=${actionType}` : ''}`)
      .then((r) => setLogs(r.logs))
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false))
  }, [actionType]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(load, [load])

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">操作紀錄</h1>
        <div className="w-52"><SelectField label="" placeholder="全部事件" value={actionType} onChange={(e) => setActionType(e.target.value)} options={ACTION_FILTERS} /></div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">載入中…</p>
      ) : logs.length === 0 ? (
        <EmptyState icon="🧾" title="沒有符合的紀錄" description="調整篩選條件再試一次。" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-surface-border bg-surface-raised shadow-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-surface-border text-left text-xs text-slate-500">
                <th className="p-3">時間</th><th className="p-3">事件</th><th className="p-3">操作人</th><th className="p-3">銀行</th><th className="p-3">明細</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.logId} className="border-b border-surface-border last:border-0 text-slate-700">
                  <td className="p-3 whitespace-nowrap">{formatDateTime(l.createdAt)}</td>
                  <td className="p-3 text-slate-900">{ACTION_LABELS[l.actionType] ?? l.actionType}</td>
                  <td className="p-3">{l.userName ?? '—'}</td>
                  <td className="p-3">{l.bankName ?? l.bankCode ?? '—'}</td>
                  <td className="p-3 text-slate-500">{l.detail ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
