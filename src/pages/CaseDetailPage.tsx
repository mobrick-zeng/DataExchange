import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useToast } from '@/hooks/useToast'
import { apiFetch } from '@/services/api'
import { Button } from '@/components/Button'
import { Modal } from '@/components/Modal'
import { TextField } from '@/components/TextField'
import { SelectField } from '@/components/SelectField'
import { CLAIM_TYPE_LABELS } from '@/utils/labels'
import { CASE_STATUS_LABELS, CONFIRM_STATUS_LABELS, money } from './CasesPage'

const CLAIM_TYPES = ['CREDIT_LOAN', 'CREDIT_CARD', 'GUARANTEE', 'OTHER'] as const

interface Item {
  itemId?: string
  claimType: string
  externalPrincipal: number | string
  externalInterest: number | string
  externalPenalty: number | string
  externalOtherFee: number | string
  externalTotal?: string
  internalTotal?: number | string
  note?: string
}
interface Declaration { declarationId: string; bankCode: string; bankName: string; totalAmount: string; items: Item[] | null }
interface Participant { bankCode: string; bankName: string; roleInCase: string; confirmationStatus: string; confirmedAt: string | null; disputeReason: string | null }
interface CaseDetail {
  case: {
    caseId: string; caseNumber: string; debtorId: string; debtorName: string; mainBankCode: string; mainBankName: string
    status: string; declarationDeadline: string; totalDebtAmount: string | null; note: string | null
    terminationReason: string | null
  }
  viewer: { isMain: boolean; isParticipant: boolean; isAdmin: boolean; isAuditor: boolean; bankCode: string | null }
  participants: Participant[]
  declarations: Declaration[]
}
interface RepaymentRow { recordId: string; bankCode: string; period: string; periodRepaid: string; outstandingBalance: string }
interface Bank { bankCode: string; bankName: string }

export function CaseDetailPage() {
  const { caseId } = useParams()
  const toast = useToast()
  const [data, setData] = useState<CaseDetail | null>(null)
  const [repayments, setRepayments] = useState<RepaymentRow[]>([])
  const [banks, setBanks] = useState<Bank[]>([])
  const [loading, setLoading] = useState(true)

  // modal 狀態
  const [inviteBank, setInviteBank] = useState('')
  const [fillFor, setFillFor] = useState<Declaration | null>(null)
  const [fillItems, setFillItems] = useState<Item[]>([])
  const [disputeOpen, setDisputeOpen] = useState(false)
  const [disputeReason, setDisputeReason] = useState('')
  const [repayOpen, setRepayOpen] = useState(false)
  const [repayPeriod, setRepayPeriod] = useState(new Date().toISOString().slice(0, 7))
  const [repayRows, setRepayRows] = useState<Record<string, { paid: string; balance: string }>>({})
  const [terminateOpen, setTerminateOpen] = useState(false)
  const [terminateReason, setTerminateReason] = useState('')

  const load = useCallback(() => {
    if (!caseId) return
    setLoading(true)
    Promise.all([
      apiFetch<CaseDetail>(`/api/cases/${caseId}`),
      apiFetch<{ records: RepaymentRow[] }>(`/api/cases/${caseId}/repayments`),
      apiFetch<{ banks: Bank[] }>('/api/banks'),
    ])
      .then(([d, r, b]) => { setData(d); setRepayments(r.records); setBanks(b.banks) })
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false))
  }, [caseId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(load, [load])

  if (loading || !data) return <p className="p-6 text-sm text-slate-500">載入中…</p>
  const { case: c, viewer, participants, declarations } = data
  const isMain = viewer.isMain
  const myPart = participants.find((p) => p.bankCode === viewer.bankCode && p.roleInCase === 'CO_BANK')

  const act = async (fn: () => Promise<unknown>, okMsg: string) => {
    try { await fn(); toast.success(okMsg); load() } catch (e) { toast.error((e as Error).message) }
  }

  // 可邀請的銀行（尚未參與、且非本行）
  const invitable = banks.filter((b) => b.bankCode !== 'PLATFORM' && !participants.some((p) => p.bankCode === b.bankCode))

  const openFill = (decl: Declaration) => {
    setFillFor(decl)
    setFillItems(decl.items && decl.items.length ? decl.items.map((i) => ({ ...i })) : [{ claimType: 'CREDIT_LOAN', externalPrincipal: '', externalInterest: '', externalPenalty: '', externalOtherFee: '', internalTotal: '', note: '' }])
  }
  const saveFill = async () => {
    if (!fillFor) return
    const items = fillItems.map((i) => ({
      claimType: i.claimType,
      externalPrincipal: Number(i.externalPrincipal) || 0,
      externalInterest: Number(i.externalInterest) || 0,
      externalPenalty: Number(i.externalPenalty) || 0,
      externalOtherFee: Number(i.externalOtherFee) || 0,
      internalTotal: Number(i.internalTotal) || 0,
      note: i.note || undefined,
    }))
    await act(() => apiFetch(`/api/cases/${caseId}/declarations/${fillFor.bankCode}`, { method: 'PUT', body: JSON.stringify({ items }) }), '債權明細已儲存')
    setFillFor(null)
  }

  const openRepay = () => {
    const init: Record<string, { paid: string; balance: string }> = {}
    participants.forEach((p) => { init[p.bankCode] = { paid: '', balance: '' } })
    setRepayRows(init)
    setRepayOpen(true)
  }
  const saveRepay = async () => {
    const records = participants.map((p) => ({ bankCode: p.bankCode, periodRepaid: Number(repayRows[p.bankCode]?.paid) || 0, outstandingBalance: Number(repayRows[p.bankCode]?.balance) || 0 }))
    await act(() => apiFetch(`/api/cases/${caseId}/repayments`, { method: 'POST', body: JSON.stringify({ period: repayPeriod, records }) }), '本期還款已登記')
    setRepayOpen(false)
  }

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6">
      <Link to="/cases" className="text-sm text-slate-500 hover:text-slate-900">← 案件列表</Link>

      {/* 標題與狀態 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{c.caseNumber}</h1>
          <p className="mt-1 text-sm text-slate-500">債務人 {c.debtorName}．最大債權行 {c.mainBankName}</p>
        </div>
        <span className="rounded-full bg-brand-600/10 px-3 py-1 text-sm font-medium text-brand-700">{CASE_STATUS_LABELS[c.status] ?? c.status}</span>
      </div>
      {c.status === 'TERMINATED' && c.terminationReason && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm text-rose-700">終止原因：{c.terminationReason}</div>
      )}

      {/* 其他債權行：確認 / 異議 */}
      {myPart && (myPart.confirmationStatus === 'PENDING' || myPart.confirmationStatus === 'DISPUTED') && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3">
          <p className="text-sm text-amber-800">
            您是此案的其他債權行，目前：{CONFIRM_STATUS_LABELS[myPart.confirmationStatus]}。請檢視本行債權後確認或回報異議。
          </p>
          <div className="ml-auto flex gap-2">
            <Button size="sm" onClick={() => act(() => apiFetch(`/api/cases/${caseId}/confirm`, { method: 'POST' }), '已確認')}>確認無誤</Button>
            <Button size="sm" variant="secondary" onClick={() => setDisputeOpen(true)}>回報異議</Button>
          </div>
        </div>
      )}

      {/* 參與銀行與確認進度 */}
      <section className="rounded-2xl border border-surface-border bg-surface-raised p-5 shadow-card">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">參與銀行與確認進度</h2>
        <div className="flex flex-col gap-2">
          {participants.map((p) => (
            <div key={p.bankCode} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-surface-border px-3 py-2 text-sm">
              <span className="text-slate-900">{p.bankName}<span className="ml-2 text-xs text-slate-500">{p.roleInCase === 'MAIN' ? '最大債權行' : '其他債權行'}</span></span>
              <span className="text-slate-700">
                {CONFIRM_STATUS_LABELS[p.confirmationStatus] ?? p.confirmationStatus}
                {p.disputeReason && <span className="ml-2 text-rose-600">（異議：{p.disputeReason}）</span>}
              </span>
            </div>
          ))}
        </div>
        {/* 主辦 + 草稿：邀請其他債權行 */}
        {isMain && c.status === 'DRAFT' && (
          <div className="mt-4 flex items-end gap-3">
            <div className="w-64"><SelectField label="邀請其他債權行" placeholder="選擇銀行" value={inviteBank} onChange={(e) => setInviteBank(e.target.value)} options={invitable.map((b) => ({ value: b.bankCode, label: b.bankName }))} /></div>
            <Button size="sm" disabled={!inviteBank} onClick={() => act(() => apiFetch(`/api/cases/${caseId}/participants`, { method: 'POST', body: JSON.stringify({ bankCode: inviteBank }) }).then(() => setInviteBank('')), '已邀請')}>邀請</Button>
          </div>
        )}
      </section>

      {/* 各行債權 */}
      <section className="rounded-2xl border border-surface-border bg-surface-raised p-5 shadow-card">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">各行債權</h2>
        <div className="flex flex-col gap-3">
          {declarations.map((d) => {
            const part = participants.find((p) => p.bankCode === d.bankCode)
            const canFill = isMain && (c.status === 'DRAFT' || part?.confirmationStatus === 'DISPUTED')
            return (
              <div key={d.declarationId} className="rounded-xl border border-surface-border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-900">{d.bankName}</span>
                  <span className="text-sm text-slate-700">總額 {money(d.totalAmount)}</span>
                </div>
                {d.items === null ? (
                  <p className="mt-1 text-xs text-slate-500">（其他銀行明細不開放檢視，僅顯示總額）</p>
                ) : (
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full min-w-[480px] text-xs">
                      <thead><tr className="text-left text-slate-500"><th className="py-1">類型</th><th className="py-1 text-right">本金</th><th className="py-1 text-right">利息</th><th className="py-1 text-right">違約金</th><th className="py-1 text-right">其他</th><th className="py-1 text-right">小計</th></tr></thead>
                      <tbody>
                        {d.items.map((it, idx) => (
                          <tr key={idx} className="text-slate-700">
                            <td className="py-1">{CLAIM_TYPE_LABELS[it.claimType as keyof typeof CLAIM_TYPE_LABELS] ?? it.claimType}</td>
                            <td className="py-1 text-right">{money(String(it.externalPrincipal))}</td>
                            <td className="py-1 text-right">{money(String(it.externalInterest))}</td>
                            <td className="py-1 text-right">{money(String(it.externalPenalty))}</td>
                            <td className="py-1 text-right">{money(String(it.externalOtherFee))}</td>
                            <td className="py-1 text-right font-medium text-slate-900">{money(it.externalTotal)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {canFill && <Button size="sm" variant="secondary" className="mt-2" onClick={() => openFill(d)}>代填 / 修正債權</Button>}
              </div>
            )
          })}
        </div>
      </section>

      {/* 還款紀錄 */}
      {(c.status === 'IN_REPAYMENT' || c.status === 'SETTLED' || repayments.length > 0) && (
        <section className="rounded-2xl border border-surface-border bg-surface-raised p-5 shadow-card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">還款紀錄</h2>
            {isMain && c.status === 'IN_REPAYMENT' && <Button size="sm" onClick={openRepay}>登記本期還款</Button>}
          </div>
          {repayments.length === 0 ? <p className="text-sm text-slate-500">尚無還款紀錄。</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead><tr className="text-left text-xs text-slate-500"><th className="p-2">期別</th><th className="p-2">銀行</th><th className="p-2 text-right">本期受償</th><th className="p-2 text-right">剩餘債權</th></tr></thead>
                <tbody>
                  {repayments.map((r) => (
                    <tr key={r.recordId} className="border-t border-surface-border text-slate-700">
                      <td className="p-2">{r.period}</td><td className="p-2">{r.bankCode}</td>
                      <td className="p-2 text-right">{money(r.periodRepaid)}</td><td className="p-2 text-right">{money(r.outstandingBalance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* 主辦操作區 */}
      {isMain && (
        <div className="flex flex-wrap gap-3">
          {c.status === 'DRAFT' && <Button onClick={() => act(() => apiFetch(`/api/cases/${caseId}/publish`, { method: 'POST' }), '案件已發布，已通知其他債權行')}>發布案件</Button>}
          {c.status === 'IN_REPAYMENT' && <Button variant="secondary" onClick={() => act(() => apiFetch(`/api/cases/${caseId}/settle`, { method: 'POST' }), '案件已結清')}>結清案件</Button>}
          {c.status === 'IN_REPAYMENT' && <Button variant="danger" onClick={() => setTerminateOpen(true)}>毀諾／終止</Button>}
        </div>
      )}

      {/* ---- Modals ---- */}
      <Modal open={!!fillFor} onClose={() => setFillFor(null)} title={`代填債權 — ${fillFor?.bankName ?? ''}`} widthClassName="max-w-2xl"
        footer={<><Button variant="secondary" onClick={() => setFillFor(null)}>取消</Button><Button onClick={saveFill}>儲存</Button></>}>
        <div className="flex flex-col gap-3">
          {fillItems.map((it, idx) => (
            <div key={idx} className="grid grid-cols-2 gap-2 rounded-xl border border-surface-border p-3 sm:grid-cols-3">
              <SelectField label="類型" value={it.claimType} options={CLAIM_TYPES.map((t) => ({ value: t, label: CLAIM_TYPE_LABELS[t] }))} onChange={(e) => setFillItems((a) => a.map((x, i) => i === idx ? { ...x, claimType: e.target.value } : x))} />
              <TextField label="本金" type="number" value={String(it.externalPrincipal)} onChange={(e) => setFillItems((a) => a.map((x, i) => i === idx ? { ...x, externalPrincipal: e.target.value } : x))} />
              <TextField label="利息" type="number" value={String(it.externalInterest)} onChange={(e) => setFillItems((a) => a.map((x, i) => i === idx ? { ...x, externalInterest: e.target.value } : x))} />
              <TextField label="違約金" type="number" value={String(it.externalPenalty)} onChange={(e) => setFillItems((a) => a.map((x, i) => i === idx ? { ...x, externalPenalty: e.target.value } : x))} />
              <TextField label="其他費用" type="number" value={String(it.externalOtherFee)} onChange={(e) => setFillItems((a) => a.map((x, i) => i === idx ? { ...x, externalOtherFee: e.target.value } : x))} />
              <TextField label="內部帳列(僅稽核可見)" type="number" value={String(it.internalTotal ?? '')} onChange={(e) => setFillItems((a) => a.map((x, i) => i === idx ? { ...x, internalTotal: e.target.value } : x))} />
              <button type="button" className="col-span-full text-left text-xs text-rose-600" onClick={() => setFillItems((a) => a.filter((_, i) => i !== idx))}>移除此列</button>
            </div>
          ))}
          <button type="button" className="text-sm text-brand-700" onClick={() => setFillItems((a) => [...a, { claimType: 'CREDIT_LOAN', externalPrincipal: '', externalInterest: '', externalPenalty: '', externalOtherFee: '', internalTotal: '', note: '' }])}>+ 新增一列</button>
        </div>
      </Modal>

      <Modal open={disputeOpen} onClose={() => setDisputeOpen(false)} title="回報異議"
        footer={<><Button variant="secondary" onClick={() => setDisputeOpen(false)}>取消</Button><Button variant="danger" disabled={!disputeReason} onClick={() => { act(() => apiFetch(`/api/cases/${caseId}/dispute`, { method: 'POST', body: JSON.stringify({ reason: disputeReason }) }), '已回報異議'); setDisputeOpen(false); setDisputeReason('') }}>送出異議</Button></>}>
        <TextField label="異議原因" value={disputeReason} onChange={(e) => setDisputeReason(e.target.value)} placeholder="請說明資料有誤之處" />
      </Modal>

      <Modal open={repayOpen} onClose={() => setRepayOpen(false)} title="登記本期還款" widthClassName="max-w-lg"
        footer={<><Button variant="secondary" onClick={() => setRepayOpen(false)}>取消</Button><Button onClick={saveRepay}>儲存</Button></>}>
        <div className="flex flex-col gap-3">
          <TextField label="期別 (YYYY-MM)" value={repayPeriod} onChange={(e) => setRepayPeriod(e.target.value)} placeholder="2026-07" />
          {participants.map((p) => (
            <div key={p.bankCode} className="grid grid-cols-2 gap-2 rounded-xl border border-surface-border p-2">
              <p className="col-span-2 text-sm text-slate-900">{p.bankName}</p>
              <TextField label="本期受償" type="number" value={repayRows[p.bankCode]?.paid ?? ''} onChange={(e) => setRepayRows((r) => ({ ...r, [p.bankCode]: { ...r[p.bankCode], paid: e.target.value } }))} />
              <TextField label="剩餘債權" type="number" value={repayRows[p.bankCode]?.balance ?? ''} onChange={(e) => setRepayRows((r) => ({ ...r, [p.bankCode]: { ...r[p.bankCode], balance: e.target.value } }))} />
            </div>
          ))}
        </div>
      </Modal>

      <Modal open={terminateOpen} onClose={() => setTerminateOpen(false)} title="毀諾／終止案件"
        footer={<><Button variant="secondary" onClick={() => setTerminateOpen(false)}>取消</Button><Button variant="danger" disabled={!terminateReason} onClick={() => { act(() => apiFetch(`/api/cases/${caseId}/terminate`, { method: 'POST', body: JSON.stringify({ reason: terminateReason }) }), '案件已終止'); setTerminateOpen(false); setTerminateReason('') }}>確認終止</Button></>}>
        <TextField label="終止原因" value={terminateReason} onChange={(e) => setTerminateReason(e.target.value)} placeholder="例如：債務人連續三期未依方案還款" />
      </Modal>
    </div>
  )
}
