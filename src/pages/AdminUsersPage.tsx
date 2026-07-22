import { useCallback, useEffect, useState } from 'react'
import { useToast } from '@/hooks/useToast'
import { apiFetch } from '@/services/api'
import { Button } from '@/components/Button'
import { Modal } from '@/components/Modal'
import { TextField } from '@/components/TextField'
import { SelectField } from '@/components/SelectField'
import { EmptyState } from '@/components/EmptyState'
import { ACCOUNT_STATUS_LABELS, ROLE_LABELS, formatBankLabel } from '@/utils/labels'

interface AdminUser {
  userId: string
  name: string
  email: string
  bankCode: string
  bankName: string | null
  role: string
  accountStatus: string
  lockedUntil: string | null
  activatedAt: string | null
}
interface Bank { bankCode: string; bankName: string }
interface ResetReq { requestId: string; userId: string; name: string; email: string; bankCode: string }

const STATUS_FILTERS = [
  { value: '', label: '全部狀態' },
  { value: 'PENDING_ACTIVATION', label: '待啟用' },
  { value: 'ACTIVE', label: '已啟用' },
  { value: 'SUSPENDED', label: '已停用' },
]
const ROLE_OPTS = [
  { value: 'BANK_STAFF', label: '銀行人員' },
  { value: 'PLATFORM_AUDITOR', label: '平台稽核檢視者' },
  { value: 'ADMIN', label: '平台管理員' },
]

export function AdminUsersPage() {
  const toast = useToast()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [banks, setBanks] = useState<Bank[]>([])
  const [resetRequests, setResetRequests] = useState<ResetReq[]>([])
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)

  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState({ email: '', name: '', bankCode: '', role: 'BANK_STAFF', department: '', title: '' })
  const [codeResult, setCodeResult] = useState<{ title: string; code: string } | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      apiFetch<{ users: AdminUser[] }>(`/api/users${status ? `?status=${status}` : ''}`),
      apiFetch<{ banks: Bank[] }>('/api/banks?activeOnly=1'),
      apiFetch<{ requests: ResetReq[] }>('/api/password-reset-requests'),
    ])
      .then(([u, b, rr]) => { setUsers(u.users); setBanks(b.banks); setResetRequests(rr.requests) })
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false))
  }, [status]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(load, [load])

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try { await fn(); toast.success(msg); load() } catch (e) { toast.error((e as Error).message) }
  }
  const copy = (t: string) => { navigator.clipboard?.writeText(t); toast.success('已複製') }

  const createUser = async () => {
    if (!form.email || !form.name || !form.bankCode) { toast.error('請填 Email、姓名與銀行'); return }
    try {
      const r = await apiFetch<{ activationCode: string }>('/api/users', {
        method: 'POST',
        body: JSON.stringify({ email: form.email, name: form.name, bankCode: form.bankCode, role: form.role, department: form.department || undefined, title: form.title || undefined }),
      })
      setCodeResult({ title: '帳號已建立，請交付啟用碼（一次性、效期 3 天）', code: r.activationCode })
      load()
    } catch (e) { toast.error((e as Error).message) }
  }
  const resetCreate = () => { setCreateOpen(false); setCodeResult(null); setForm({ email: '', name: '', bankCode: '', role: 'BANK_STAFF', department: '', title: '' }) }

  const showCode = async (path: string, title: string, key: 'activationCode' | 'resetCode') => {
    try {
      const r = await apiFetch<Record<string, string>>(path, { method: 'POST' })
      setCodeResult({ title, code: r[key] })
      setCreateOpen(true)
      load()
    } catch (e) { toast.error((e as Error).message) }
  }

  const locked = (u: AdminUser) => u.lockedUntil && new Date(u.lockedUntil).getTime() > Date.now()

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900">使用者與權限管理</h1>
        <div className="flex items-center gap-3">
          <div className="w-40"><SelectField label="" placeholder="全部狀態" value={status} onChange={(e) => setStatus(e.target.value)} options={STATUS_FILTERS} /></div>
          <Button onClick={() => setCreateOpen(true)}>＋ 建立帳號</Button>
        </div>
      </div>

      {/* 密碼重置申請 */}
      {resetRequests.length > 0 && (
        <section className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">密碼重置申請（待處理 {resetRequests.length}）</h2>
          <div className="flex flex-col gap-2">
            {resetRequests.map((r) => (
              <div key={r.requestId} className="flex items-center justify-between rounded-xl border border-surface-border bg-surface-raised px-3 py-2 text-sm">
                <span className="text-slate-900">{r.name}<span className="ml-2 text-xs text-slate-500">{r.email}</span></span>
                <Button size="sm" onClick={() => showCode(`/api/password-reset-requests/${r.requestId}/issue`, '重置碼已核發（效期 3 天）', 'resetCode')}>核發重置碼</Button>
              </div>
            ))}
          </div>
        </section>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">載入中…</p>
      ) : users.length === 0 ? (
        <EmptyState icon="👤" title="沒有符合的使用者" description="調整篩選條件或建立新帳號。" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-surface-border bg-surface-raised shadow-card">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-surface-border text-left text-xs text-slate-500">
                <th className="p-3">姓名</th><th className="p-3">Email</th><th className="p-3">所屬機構</th><th className="p-3">角色</th><th className="p-3">狀態</th><th className="p-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.userId} className="border-b border-surface-border last:border-0">
                  <td className="p-3 text-slate-900">{u.name}</td>
                  <td className="p-3 text-slate-700">{u.email}</td>
                  <td className="p-3 text-slate-700">{formatBankLabel(u.bankCode, u.bankName)}</td>
                  <td className="p-3 text-slate-700">{ROLE_LABELS[u.role as keyof typeof ROLE_LABELS] ?? u.role}</td>
                  <td className="p-3 text-slate-700">
                    {ACCOUNT_STATUS_LABELS[u.accountStatus as keyof typeof ACCOUNT_STATUS_LABELS] ?? u.accountStatus}
                    {locked(u) && <span className="ml-2 rounded-full bg-rose-500/15 px-2 py-0.5 text-xs text-rose-700">🔒 鎖定中</span>}
                  </td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-2">
                      {locked(u) && <Button size="sm" onClick={() => act(() => apiFetch(`/api/users/${u.userId}/unlock`, { method: 'POST' }), '已解鎖')}>解鎖</Button>}
                      {u.accountStatus === 'PENDING_ACTIVATION' && <Button size="sm" variant="secondary" onClick={() => showCode(`/api/users/${u.userId}/issue-activation`, '啟用碼已重新核發（效期 3 天）', 'activationCode')}>重發啟用碼</Button>}
                      {u.accountStatus === 'ACTIVE' && <Button size="sm" variant="secondary" onClick={() => showCode(`/api/users/${u.userId}/issue-reset`, '重置碼已核發（效期 3 天）', 'resetCode')}>發重置碼</Button>}
                      {u.accountStatus === 'ACTIVE' && <Button size="sm" variant="danger" onClick={() => act(() => apiFetch(`/api/users/${u.userId}/suspend`, { method: 'POST' }), '已停用')}>停用</Button>}
                      {u.accountStatus === 'SUSPENDED' && <Button size="sm" onClick={() => act(() => apiFetch(`/api/users/${u.userId}/reactivate`, { method: 'POST' }), '已復用')}>復用</Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 建立帳號 / 顯示碼 Modal */}
      <Modal open={createOpen} onClose={resetCreate} title={codeResult?.title ?? '建立帳號'}
        footer={codeResult ? <Button onClick={resetCreate}>完成</Button> : <><Button variant="secondary" onClick={resetCreate}>取消</Button><Button onClick={createUser}>建立並產生啟用碼</Button></>}>
        {codeResult ? (
          <div className="flex flex-col gap-3 text-sm">
            <p className="text-slate-700">請將以下<b>一次性代碼</b>經你們的管道交付本人，於登入頁「密碼欄」輸入以完成啟用／重設：</p>
            <div className="rounded-xl border border-surface-border bg-surface-muted/40 p-3">
              <p className="break-all text-lg font-mono text-slate-900">{codeResult.code}</p>
              <button className="mt-1 text-xs text-brand-700" onClick={() => copy(codeResult.code)}>複製代碼</button>
            </div>
            <p className="text-xs text-slate-500">⚠️ 代碼僅顯示這一次，關閉後無法再查看，請先複製保存。</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <TextField label="Email" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="user@bank.local" />
            <TextField label="姓名" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="承辦姓名" />
            <SelectField label="所屬機構" placeholder="選擇機構" value={form.bankCode} onChange={(e) => setForm((f) => ({ ...f, bankCode: e.target.value }))} options={banks.map((b) => ({ value: b.bankCode, label: formatBankLabel(b.bankCode, b.bankName) }))} />
            <SelectField label="角色" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} options={ROLE_OPTS} />
            <div className="grid grid-cols-2 gap-3">
              <TextField label="部門（選填）" value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))} />
              <TextField label="職稱（選填）" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
