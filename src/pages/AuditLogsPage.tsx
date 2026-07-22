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
  ACCOUNT_CREATED: '建立帳號', ACCOUNT_ACTIVATED: '啟用帳號', CONSENT_GIVEN: '個資同意',
  ACCOUNT_SUSPENDED: '停用帳號', ACCOUNT_REACTIVATED: '復用帳號', ACCOUNT_LOCKED: '帳號鎖定', ACCOUNT_UNLOCKED: '解除鎖定',
  PASSWORD_CHANGED: '變更密碼', PASSWORD_RESET_REQUESTED: '申請密碼重置', PASSWORD_RESET_ISSUED: '核發重置碼',
  CASE_CREATED: '建立案件', CASE_UPDATED: '編輯案件', PARTICIPANT_INVITED: '邀請債權行', CASE_PUBLISHED: '發布案件',
  CASE_CONFIRMED: '確認案件', CASE_DISPUTED: '回報異議', PLAN_RATIO_UPDATED: '設定還款計畫',
  REPAYMENT_RECORDED: '登記還款', CASE_SETTLED: '結清案件', CASE_TERMINATED: '終止案件', INTERNAL_TOTAL_VIEWED: '查看內部金額',
  BANK_ACTIVATED: '啟用機構', BANK_DEACTIVATED: '停用機構', COURT_ACTIVATED: '啟用法院', COURT_DEACTIVATED: '停用法院',
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
