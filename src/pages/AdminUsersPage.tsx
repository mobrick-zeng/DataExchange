import { useCallback, useEffect, useState } from 'react'
import { useToast } from '@/hooks/useToast'
import { apiFetch } from '@/services/api'
import { Button } from '@/components/Button'
import { Modal } from '@/components/Modal'
import { TextField } from '@/components/TextField'
import { SelectField } from '@/components/SelectField'
import { EmptyState } from '@/components/EmptyState'
import { ACCOUNT_STATUS_LABELS, ROLE_LABELS, formatBankLabel } from '@/utils/labels'
import type { BankCode } from '@/types'

interface AdminUser {
  userId: string
  name: string
  email: string
  appliedBankCode: string
  approvedBankCode: string | null
  role: string | null
  accountStatus: string
  lockedUntil: string | null
}
interface Bank { bankCode: string; bankName: string }
interface Invitation {
  invitationId: string
  email: string
  bankCode: string
  bankName: string
  role: string
  status: string
  expiresAt: string
  createdAt: string
}

const STATUS_FILTERS = [
  { value: '', label: '全部狀態' },
  { value: 'PENDING_REVIEW', label: '待審核' },
  { value: 'ACTIVE', label: '已啟用' },
  { value: 'REJECTED', label: '已駁回' },
  { value: 'SUSPENDED', label: '已停用' },
]
const INVITE_ROLES = [
  { value: 'BANK_STAFF', label: '銀行人員' },
  { value: 'VIEWER', label: '檢視者' },
  { value: 'PLATFORM_AUDITOR', label: '平台稽核檢視者' },
]
const INVITE_STATUS_LABELS: Record<string, string> = { PENDING: '待使用', ACCEPTED: '已完成註冊', REVOKED: '已撤銷', EXPIRED: '已過期' }
const GENERAL_BANKS = ['012', '807', '812']

export function AdminUsersPage() {
  const toast = useToast()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [banks, setBanks] = useState<Bank[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)

  const [approveFor, setApproveFor] = useState<AdminUser | null>(null)
  const [approveRole, setApproveRole] = useState('BANK_STAFF')
  const [approveBank, setApproveBank] = useState('')
  const [rejectFor, setRejectFor] = useState<AdminUser | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  // 邀請
  const [inviteOpen, setInviteOpen] = useState(false)
  const [invEmail, setInvEmail] = useState('')
  const [invBank, setInvBank] = useState('')
  const [invRole, setInvRole] = useState('BANK_STAFF')
  const [inviteResult, setInviteResult] = useState<{ code: string; link: string; title: string } | null>(null)
  const [resetRequests, setResetRequests] = useState<{ requestId: string; email: string; name: string }[]>([])

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      apiFetch<{ users: AdminUser[] }>(`/api/users${status ? `?status=${status}` : ''}`),
      apiFetch<{ banks: Bank[] }>('/api/banks'),
      apiFetch<{ invitations: Invitation[] }>('/api/invitations'),
      apiFetch<{ requests: { requestId: string; email: string; name: string }[] }>('/api/password-reset-requests'),
    ])
      .then(([u, b, inv, rr]) => { setUsers(u.users); setBanks(b.banks); setInvitations(inv.invitations); setResetRequests(rr.requests) })
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false))
  }, [status]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(load, [load])

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try { await fn(); toast.success(msg); load() } catch (e) { toast.error((e as Error).message) }
  }

  const createInvite = async () => {
    if (!invEmail || !invBank) { toast.error('請填 Email 與銀行'); return }
    try {
      const r = await apiFetch<{ code: string; registerPath: string }>('/api/invitations', { method: 'POST', body: JSON.stringify({ email: invEmail, bankCode: invBank, role: invRole }) })
      setInviteResult({ code: r.code, link: `${window.location.origin}${r.registerPath}`, title: '邀請已建立（效期 3 天）' })
      load()
    } catch (e) { toast.error((e as Error).message) }
  }
  const resetInvite = () => { setInviteOpen(false); setInviteResult(null); setInvEmail(''); setInvBank(''); setInvRole('BANK_STAFF') }
  const copy = (text: string) => { navigator.clipboard?.writeText(text); toast.success('已複製') }

  const showReset = async (path: string) => {
    try {
      const r = await apiFetch<{ code: string; registerPath: string }>(path, { method: 'POST' })
      setInviteResult({ code: r.code, link: `${window.location.origin}${r.registerPath}`, title: '重置碼已核發（效期 3 天）' })
      setInviteOpen(true)
      load()
    } catch (e) { toast.error((e as Error).message) }
  }

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900">使用者與權限管理</h1>
        <div className="flex items-center gap-3">
          <div className="w-40"><SelectField label="" placeholder="全部狀態" value={status} onChange={(e) => setStatus(e.target.value)} options={STATUS_FILTERS} /></div>
          <Button onClick={() => setInviteOpen(true)}>＋ 邀請新帳號</Button>
        </div>
      </div>

      {/* 邀請清單 */}
      <section className="rounded-2xl border border-surface-border bg-surface-raised p-5 shadow-card">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">邀請紀錄</h2>
        {invitations.length === 0 ? (
          <p className="text-sm text-slate-500">尚無邀請。點右上「邀請新帳號」建立。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr className="text-left text-xs text-slate-500"><th className="p-2">Email</th><th className="p-2">銀行</th><th className="p-2">角色</th><th className="p-2">狀態</th><th className="p-2">到期</th><th className="p-2"></th></tr></thead>
              <tbody>
                {invitations.map((i) => (
                  <tr key={i.invitationId} className="border-t border-surface-border text-slate-700">
                    <td className="p-2 text-slate-900">{i.email}</td>
                    <td className="p-2">{i.bankName}</td>
                    <td className="p-2">{ROLE_LABELS[i.role as keyof typeof ROLE_LABELS] ?? i.role}</td>
                    <td className="p-2">{INVITE_STATUS_LABELS[i.status] ?? i.status}</td>
                    <td className="p-2">{new Date(i.expiresAt).toLocaleDateString('zh-TW')}</td>
                    <td className="p-2">{i.status === 'PENDING' && <button className="text-xs text-rose-600" onClick={() => act(() => apiFetch(`/api/invitations/${i.invitationId}/revoke`, { method: 'POST' }), '已撤銷')}>撤銷</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 密碼重置申請 */}
      {resetRequests.length > 0 && (
        <section className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">密碼重置申請（待處理 {resetRequests.length}）</h2>
          <div className="flex flex-col gap-2">
            {resetRequests.map((r) => (
              <div key={r.requestId} className="flex items-center justify-between rounded-xl border border-surface-border bg-surface-raised px-3 py-2 text-sm">
                <span className="text-slate-900">{r.name}<span className="ml-2 text-xs text-slate-500">{r.email}</span></span>
                <Button size="sm" onClick={() => showReset(`/api/password-reset-requests/${r.requestId}/issue`)}>核發重置碼</Button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 使用者清單 */}
      {loading ? (
        <p className="text-sm text-slate-500">載入中…</p>
      ) : users.length === 0 ? (
        <EmptyState icon="👤" title="沒有符合的使用者" description="調整篩選條件再試一次。" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-surface-border bg-surface-raised shadow-card">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-surface-border text-left text-xs text-slate-500">
                <th className="p-3">姓名</th><th className="p-3">Email</th><th className="p-3">核准銀行</th><th className="p-3">角色</th><th className="p-3">狀態</th><th className="p-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.userId} className="border-b border-surface-border last:border-0">
                  <td className="p-3 text-slate-900">{u.name}</td>
                  <td className="p-3 text-slate-700">{u.email}</td>
                  <td className="p-3 text-slate-700">{u.approvedBankCode ? formatBankLabel(u.approvedBankCode as BankCode) : '—'}</td>
                  <td className="p-3 text-slate-700">{u.role ? ROLE_LABELS[u.role as keyof typeof ROLE_LABELS] ?? u.role : '—'}</td>
                  <td className="p-3 text-slate-700">
                    {ACCOUNT_STATUS_LABELS[u.accountStatus as keyof typeof ACCOUNT_STATUS_LABELS] ?? u.accountStatus}
                    {u.lockedUntil && new Date(u.lockedUntil).getTime() > Date.now() && <span className="ml-2 rounded-full bg-rose-500/15 px-2 py-0.5 text-xs text-rose-700">🔒 鎖定中</span>}
                  </td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-2">
                      {u.lockedUntil && new Date(u.lockedUntil).getTime() > Date.now() && (
                        <Button size="sm" onClick={() => act(() => apiFetch(`/api/users/${u.userId}/unlock`, { method: 'POST' }), '已解鎖')}>解鎖</Button>
                      )}
                      {u.accountStatus === 'PENDING_REVIEW' && (
                        <>
                          <Button size="sm" onClick={() => { setApproveFor(u); setApproveRole('BANK_STAFF'); setApproveBank(u.appliedBankCode) }}>核准</Button>
                          <Button size="sm" variant="secondary" onClick={() => { setRejectFor(u); setRejectReason('') }}>駁回</Button>
                        </>
                      )}
                      {u.accountStatus === 'ACTIVE' && <Button size="sm" variant="secondary" onClick={() => showReset(`/api/users/${u.userId}/issue-reset`)}>發重置碼</Button>}
                      {u.accountStatus === 'ACTIVE' && <Button size="sm" variant="danger" onClick={() => act(() => apiFetch(`/api/users/${u.userId}/suspend`, { method: 'POST', body: JSON.stringify({}) }), '已停用')}>停用</Button>}
                      {u.accountStatus === 'SUSPENDED' && <Button size="sm" onClick={() => act(() => apiFetch(`/api/users/${u.userId}/reactivate`, { method: 'POST' }), '已重新啟用')}>重新啟用</Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 邀請 Modal */}
      <Modal open={inviteOpen} onClose={resetInvite} title={inviteResult?.title ?? '邀請新帳號'}
        footer={inviteResult ? <Button onClick={resetInvite}>完成</Button> : <><Button variant="secondary" onClick={resetInvite}>取消</Button><Button onClick={createInvite}>產生邀請碼</Button></>}>
        {inviteResult ? (
          <div className="flex flex-col gap-3 text-sm">
            <p className="text-slate-700">請將以下<b>連結或邀請碼</b>交給對方（一次性、效期 3 天）：</p>
            <div className="rounded-xl border border-surface-border bg-surface-muted/40 p-3">
              <p className="mb-1 text-xs text-slate-500">註冊連結</p>
              <p className="break-all text-slate-900">{inviteResult.link}</p>
              <button className="mt-1 text-xs text-brand-700" onClick={() => copy(inviteResult.link)}>複製連結</button>
            </div>
            <div className="rounded-xl border border-surface-border bg-surface-muted/40 p-3">
              <p className="mb-1 text-xs text-slate-500">邀請碼</p>
              <p className="break-all text-slate-900">{inviteResult.code}</p>
              <button className="mt-1 text-xs text-brand-700" onClick={() => copy(inviteResult.code)}>複製邀請碼</button>
            </div>
            <p className="text-xs text-slate-500">⚠️ 邀請碼僅顯示這一次，關閉後無法再查看，請先複製保存。</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <TextField label="受邀者 Email" type="email" value={invEmail} onChange={(e) => setInvEmail(e.target.value)} placeholder="user@bank.com" />
            <SelectField label="所屬銀行" placeholder="選擇銀行" value={invBank} onChange={(e) => setInvBank(e.target.value)} options={banks.filter((b) => GENERAL_BANKS.includes(b.bankCode)).map((b) => ({ value: b.bankCode, label: b.bankName }))} />
            <SelectField label="角色" value={invRole} onChange={(e) => setInvRole(e.target.value)} options={INVITE_ROLES} />
          </div>
        )}
      </Modal>

      {/* 核准 / 駁回 Modal */}
      <Modal open={!!approveFor} onClose={() => setApproveFor(null)} title={`核准帳號 — ${approveFor?.name ?? ''}`}
        footer={<><Button variant="secondary" onClick={() => setApproveFor(null)}>取消</Button><Button disabled={!approveBank} onClick={() => { act(() => apiFetch(`/api/users/${approveFor!.userId}/approve`, { method: 'POST', body: JSON.stringify({ role: approveRole, approvedBankCode: approveBank }) }), '已核准'); setApproveFor(null) }}>確認核准</Button></>}>
        <div className="flex flex-col gap-3">
          <SelectField label="指派角色" value={approveRole} onChange={(e) => setApproveRole(e.target.value)} options={INVITE_ROLES} />
          <SelectField label="核准所屬銀行" placeholder="選擇銀行" value={approveBank} onChange={(e) => setApproveBank(e.target.value)} options={banks.map((b) => ({ value: b.bankCode, label: b.bankName }))} />
        </div>
      </Modal>
      <Modal open={!!rejectFor} onClose={() => setRejectFor(null)} title={`駁回帳號 — ${rejectFor?.name ?? ''}`}
        footer={<><Button variant="secondary" onClick={() => setRejectFor(null)}>取消</Button><Button variant="danger" disabled={!rejectReason} onClick={() => { act(() => apiFetch(`/api/users/${rejectFor!.userId}/reject`, { method: 'POST', body: JSON.stringify({ reason: rejectReason }) }), '已駁回'); setRejectFor(null) }}>確認駁回</Button></>}>
        <TextField label="駁回原因" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="請說明駁回原因" />
      </Modal>
    </div>
  )
}
