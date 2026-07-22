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
  principal: number | string
  interest: number | string
  penalty: number | string
  otherFee: number | string
  externalTotal?: string
  internalTotal?: number | string
  note?: string
}
interface Participant {
  participantId: string
  bankCode: string
  bankName: string
  roleInCase: string
  planRatio: string
  confirmationStatus: string
  confirmedAt: string | null
  confirmedClaimAmount: string | null
  disputeReason: string | null
  liveTotal: number
  items: Item[] | null
}
interface CaseDetail {
  case: {
    caseId: string; courtCode: string; courtName: string; docNumber: string
    mainBankCode: string; mainBankName: string; status: string
    confirmationDeadline: string | null; monthlyInstallment: string | null; planInstallments: number | null; planStartDate: string | null
    totalDebtAmount: string | null; note: string | null; terminationReason: string | null
  }
  viewer: { isMain: boolean; isParticipant: boolean; isAdmin: boolean; isAuditor: boolean; bankCode: string | null }
  participants: Participant[]
}
interface Alloc { bankCode: string; plannedAmount: string; actualAmount: string; roundingAdjustment: string }
interface Period { period: string; actualReceivedTotal: string; hasRoundingAdjust: boolean; recordedAt: string; note: string | null; allocations: Alloc[] }
interface SummaryRow {
  bankCode: string; bankName: string; roleInCase: string; planRatio: string; confirmedClaimAmount: string | null
  cumulativePlanned: number; cumulativeActual: number; outstanding: number; planCompletionPct: number | null; debtRecoveryPct: number | null
}
interface BankOpt { bankCode: string; bankName: string }

const pct = (v: number | null) => (v == null ? '—' : `${v.toFixed(1)}%`)

export function CaseDetailPage() {
  const { caseId } = useParams()
  const toast = useToast()
  const [data, setData] = useState<CaseDetail | null>(null)
  const [periods, setPeriods] = useState<Period[]>([])
  const [summary, setSummary] = useState<SummaryRow[]>([])
  const [banks, setBanks] = useState<BankOpt[]>([])
  const [loading, setLoading] = useState(true)

  const [inviteBank, setInviteBank] = useState('')
  const [fillFor, setFillFor] = useState<Participant | null>(null)
  const [fillItems, setFillItems] = useState<Item[]>([])
  const [disputeOpen, setDisputeOpen] = useState(false)
  const [disputeReason, setDisputeReason] = useState('')
  const [repayOpen, setRepayOpen] = useState(false)
  const [repayPeriod, setRepayPeriod] = useState(new Date().toISOString().slice(0, 7))
  const [repayTotal, setRepayTotal] = useState('')
  const [terminateOpen, setTerminateOpen] = useState(false)
  const [terminateReason, setTerminateReason] = useState('')
  const [planOpen, setPlanOpen] = useState(false)
  const [planForm, setPlanForm] = useState({ monthlyInstallment: '', planInstallments: '', planStartDate: '' })
  const [planRatios, setPlanRatios] = useState<Record<string, string>>({})

  const load = useCallback(() => {
    if (!caseId) return
    setLoading(true)
    Promise.all([
      apiFetch<CaseDetail>(`/api/cases/${caseId}`),
      apiFetch<{ periods: Period[]; summary: SummaryRow[] }>(`/api/cases/${caseId}/repayments`),
      apiFetch<{ banks: BankOpt[] }>('/api/banks?activeOnly=1'),
    ])
      .then(([d, r, b]) => { setData(d); setPeriods(r.periods); setSummary(r.summary); setBanks(b.banks) })
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false))
  }, [caseId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(load, [load])

  if (loading || !data) return <p className="p-6 text-sm text-slate-500">載入中…</p>
  const { case: c, viewer, participants } = data
  const isMain = viewer.isMain
  const myPart = participants.find((p) => p.bankCode === viewer.bankCode && p.roleInCase === 'CO_BANK')

  const act = async (fn: () => Promise<unknown>, okMsg: string) => {
    try { await fn(); toast.success(okMsg); load() } catch (e) { toast.error((e as Error).message) }
  }

  const invitable = banks.filter((b) => b.bankCode !== 'PLATFORM' && !participants.some((p) => p.bankCode === b.bankCode))

  const openFill = (p: Participant) => {
    setFillFor(p)
    setFillItems(p.items && p.items.length ? p.items.map((i) => ({ ...i })) : [{ claimType: 'CREDIT_LOAN', principal: '', interest: '', penalty: '', otherFee: '', internalTotal: '', note: '' }])
  }
  const saveFill = async () => {
    if (!fillFor) return
    const items = fillItems.map((i) => ({
      claimType: i.claimType,
      principal: Number(i.principal) || 0,
      interest: Number(i.interest) || 0,
      penalty: Number(i.penalty) || 0,
      otherFee: Number(i.otherFee) || 0,
      internalTotal: Number(i.internalTotal) || 0,
      note: i.note || undefined,
    }))
    await act(() => apiFetch(`/api/cases/${caseId}/participants/${fillFor.bankCode}/items`, { method: 'PUT', body: JSON.stringify({ items }) }), '債權明細已儲存')
    setFillFor(null)
  }

  const openPlan = () => {
    setPlanForm({
      monthlyInstallment: c.monthlyInstallment ?? '',
      planInstallments: c.planInstallments?.toString() ?? '',
      planStartDate: c.planStartDate ? c.planStartDate.slice(0, 10) : '',
    })
    const r: Record<string, string> = {}
    participants.forEach((p) => { r[p.bankCode] = p.planRatio ?? '0' })
    setPlanRatios(r)
    setPlanOpen(true)
  }
  const ratioSum = Object.values(planRatios).reduce((s, v) => s + (Number(v) || 0), 0)
  const savePlan = async () => {
    const ratios = participants.map((p) => ({ bankCode: p.bankCode, planRatio: Number(planRatios[p.bankCode]) || 0 }))
    await act(() => apiFetch(`/api/cases/${caseId}/plan`, {
      method: 'PUT',
      body: JSON.stringify({ monthlyInstallment: Number(planForm.monthlyInstallment) || 0, planInstallments: Number(planForm.planInstallments) || 0, planStartDate: planForm.planStartDate, ratios }),
    }), '還款計畫已設定')
    setPlanOpen(false)
  }

  const saveRepay = async () => {
    await act(() => apiFetch(`/api/cases/${caseId}/repayments`, { method: 'POST', body: JSON.stringify({ period: repayPeriod, actualReceivedTotal: Number(repayTotal) || 0 }) }), '本期還款已登記')
    setRepayOpen(false); setRepayTotal('')
  }

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6">
      <Link to="/cases" className="text-sm text-slate-500 hover:text-slate-900">← 案件列表</Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{c.docNumber}</h1>
          <p className="mt-1 text-sm text-slate-500">{c.courtName}．最大債權行 {c.mainBankName}
            {c.confirmationDeadline && <span className="ml-2">確認期限 {c.confirmationDeadline.slice(0, 10)}</span>}
          </p>
        </div>
        <span className="rounded-full bg-brand-600/10 px-3 py-1 text-sm font-medium text-brand-700">{CASE_STATUS_LABELS[c.status] ?? c.status}</span>
      </div>
      {c.status === 'TERMINATED' && c.terminationReason && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm text-rose-700">終止原因：{c.terminationReason}</div>
      )}

      {/* 還款計畫摘要 */}
      {(c.monthlyInstallment || c.totalDebtAmount) && (
        <div className="flex flex-wrap gap-4 rounded-2xl border border-surface-border bg-surface-raised p-4 text-sm shadow-card">
          <span>總債權額 <b className="text-slate-900">{money(c.totalDebtAmount)}</b></span>
          <span>每月應還 <b className="text-slate-900">{money(c.monthlyInstallment)}</b></span>
          <span>期數 <b className="text-slate-900">{c.planInstallments ?? '—'}</b></span>
          <span>起始月 <b className="text-slate-900">{c.planStartDate ? c.planStartDate.slice(0, 7) : '—'}</b></span>
        </div>
      )}

      {/* 其他債權行：確認 / 異議 */}
      {myPart && (myPart.confirmationStatus === 'PENDING' || myPart.confirmationStatus === 'DISPUTED') && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3">
          <p className="text-sm text-amber-800">您是此案的其他債權行，目前：{CONFIRM_STATUS_LABELS[myPart.confirmationStatus]}。請檢視本行債權後確認或回報異議。</p>
          <div className="ml-auto flex gap-2">
            <Button size="sm" onClick={() => act(() => apiFetch(`/api/cases/${caseId}/confirm`, { method: 'POST' }), '已確認')}>確認無誤</Button>
            <Button size="sm" variant="secondary" onClick={() => setDisputeOpen(true)}>回報異議</Button>
          </div>
        </div>
      )}

      {/* 參與銀行、計畫比例、確認進度 */}
      <section className="rounded-2xl border border-surface-border bg-surface-raised p-5 shadow-card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">參與銀行與確認進度</h2>
          {isMain && c.status === 'DRAFT' && <Button size="sm" variant="secondary" onClick={openPlan}>設定還款計畫／比例</Button>}
        </div>
        <div className="flex flex-col gap-2">
          {participants.map((p) => (
            <div key={p.participantId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-surface-border px-3 py-2 text-sm">
              <span className="text-slate-900">{p.bankName}
                <span className="ml-2 text-xs text-slate-500">{p.roleInCase === 'MAIN' ? '最大債權行' : '其他債權行'}</span>
                <span className="ml-2 text-xs text-slate-500">計畫比例 {(Number(p.planRatio) * 100).toFixed(2)}%</span>
              </span>
              <span className="text-slate-700">
                {CONFIRM_STATUS_LABELS[p.confirmationStatus] ?? p.confirmationStatus}
                {p.disputeReason && <span className="ml-2 text-rose-600">（異議：{p.disputeReason}）</span>}
              </span>
            </div>
          ))}
        </div>
        {isMain && c.status === 'DRAFT' && (
          <div className="mt-4 flex items-end gap-3">
            <div className="w-64"><SelectField label="邀請其他債權行" placeholder="選擇銀行" value={inviteBank} onChange={(e) => setInviteBank(e.target.value)} options={invitable.map((b) => ({ value: b.bankCode, label: `${b.bankName}（${b.bankCode}）` }))} /></div>
            <Button size="sm" disabled={!inviteBank} onClick={() => act(() => apiFetch(`/api/cases/${caseId}/participants`, { method: 'POST', body: JSON.stringify({ bankCode: inviteBank }) }).then(() => setInviteBank('')), '已邀請')}>邀請</Button>
          </div>
        )}
      </section>

      {/* 各行債權明細 */}
      <section className="rounded-2xl border border-surface-border bg-surface-raised p-5 shadow-card">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">各行債權</h2>
        <div className="flex flex-col gap-3">
          {participants.map((p) => {
            const canFill = isMain && (c.status === 'DRAFT' || p.confirmationStatus === 'DISPUTED')
            const shownTotal = p.confirmedClaimAmount ?? String(p.liveTotal)
            return (
              <div key={p.participantId} className="rounded-xl border border-surface-border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-900">{p.bankName}
                    {p.confirmedClaimAmount && <span className="ml-2 rounded bg-emerald-500/10 px-1.5 py-0.5 text-xs text-emerald-700">已凍結</span>}
                  </span>
                  <span className="text-sm text-slate-700">{p.confirmedClaimAmount ? '確認金額' : '目前加總'} {money(shownTotal)}</span>
                </div>
                {p.items === null ? (
                  <p className="mt-1 text-xs text-slate-500">（其他銀行明細不開放檢視，僅顯示金額）</p>
                ) : (
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full min-w-[480px] text-xs">
                      <thead><tr className="text-left text-slate-500"><th className="py-1">類型</th><th className="py-1 text-right">本金</th><th className="py-1 text-right">利息</th><th className="py-1 text-right">違約金</th><th className="py-1 text-right">其他</th><th className="py-1 text-right">小計</th></tr></thead>
                      <tbody>
                        {p.items.map((it, idx) => (
                          <tr key={idx} className="text-slate-700">
                            <td className="py-1">{CLAIM_TYPE_LABELS[it.claimType as keyof typeof CLAIM_TYPE_LABELS] ?? it.claimType}</td>
                            <td className="py-1 text-right">{money(String(it.principal))}</td>
                            <td className="py-1 text-right">{money(String(it.interest))}</td>
                            <td className="py-1 text-right">{money(String(it.penalty))}</td>
                            <td className="py-1 text-right">{money(String(it.otherFee))}</td>
                            <td className="py-1 text-right font-medium text-slate-900">{money(it.externalTotal)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {canFill && <Button size="sm" variant="secondary" className="mt-2" onClick={() => openFill(p)}>代填 / 修正債權</Button>}
              </div>
            )
          })}
        </div>
      </section>

      {/* 還款對照表 */}
      {(c.status === 'IN_REPAYMENT' || c.status === 'SETTLED' || periods.length > 0) && (
        <section className="rounded-2xl border border-surface-border bg-surface-raised p-5 shadow-card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">還款對照表</h2>
            {isMain && c.status === 'IN_REPAYMENT' && <Button size="sm" onClick={() => setRepayOpen(true)}>登記本期還款</Button>}
          </div>
          {summary.length === 0 ? <p className="text-sm text-slate-500">尚無還款資料。</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500">
                    <th className="p-2">銀行</th><th className="p-2 text-right">確認金額</th><th className="p-2 text-right">累計應還</th>
                    <th className="p-2 text-right">累計實還</th><th className="p-2 text-right">剩餘債務</th><th className="p-2 text-right">計畫完成率</th><th className="p-2 text-right">債權回收率</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((s) => (
                    <tr key={s.bankCode} className="border-t border-surface-border text-slate-700">
                      <td className="p-2 text-slate-900">{s.bankName}<span className="ml-1 text-xs text-slate-500">{s.roleInCase === 'MAIN' ? '主辦' : ''}</span></td>
                      <td className="p-2 text-right">{money(s.confirmedClaimAmount)}</td>
                      <td className="p-2 text-right">{money(String(s.cumulativePlanned))}</td>
                      <td className="p-2 text-right font-medium text-slate-900">{money(String(s.cumulativeActual))}</td>
                      <td className="p-2 text-right">{money(String(s.outstanding))}</td>
                      <td className="p-2 text-right">{pct(s.planCompletionPct)}</td>
                      <td className="p-2 text-right">{pct(s.debtRecoveryPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {periods.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-medium text-slate-500">各期實收</p>
              <div className="flex flex-col gap-1">
                {periods.map((per) => (
                  <div key={per.period} className="flex items-center justify-between rounded-lg border border-surface-border px-3 py-1.5 text-sm">
                    <span className="text-slate-900">{per.period}</span>
                    <span className="text-slate-700">實收 {money(per.actualReceivedTotal)}
                      {per.hasRoundingAdjust && <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-700">⚠ 尾差由主辦吸收</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* 主辦操作 */}
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
              <TextField label="本金" type="number" value={String(it.principal)} onChange={(e) => setFillItems((a) => a.map((x, i) => i === idx ? { ...x, principal: e.target.value } : x))} />
              <TextField label="利息" type="number" value={String(it.interest)} onChange={(e) => setFillItems((a) => a.map((x, i) => i === idx ? { ...x, interest: e.target.value } : x))} />
              <TextField label="違約金" type="number" value={String(it.penalty)} onChange={(e) => setFillItems((a) => a.map((x, i) => i === idx ? { ...x, penalty: e.target.value } : x))} />
              <TextField label="其他費用" type="number" value={String(it.otherFee)} onChange={(e) => setFillItems((a) => a.map((x, i) => i === idx ? { ...x, otherFee: e.target.value } : x))} />
              <TextField label="內部帳列(僅稽核可見)" type="number" value={String(it.internalTotal ?? '')} onChange={(e) => setFillItems((a) => a.map((x, i) => i === idx ? { ...x, internalTotal: e.target.value } : x))} />
              <button type="button" className="col-span-full text-left text-xs text-rose-600" onClick={() => setFillItems((a) => a.filter((_, i) => i !== idx))}>移除此列</button>
            </div>
          ))}
          <button type="button" className="text-sm text-brand-700" onClick={() => setFillItems((a) => [...a, { claimType: 'CREDIT_LOAN', principal: '', interest: '', penalty: '', otherFee: '', internalTotal: '', note: '' }])}>+ 新增一列</button>
        </div>
      </Modal>

      <Modal open={planOpen} onClose={() => setPlanOpen(false)} title="設定還款計畫與各行比例" widthClassName="max-w-lg"
        footer={<><Button variant="secondary" onClick={() => setPlanOpen(false)}>取消</Button><Button disabled={Math.abs(ratioSum - 1) > 0.0001} onClick={savePlan}>儲存</Button></>}>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-2">
            <TextField label="每月應還總額" type="number" value={planForm.monthlyInstallment} onChange={(e) => setPlanForm((f) => ({ ...f, monthlyInstallment: e.target.value }))} />
            <TextField label="期數" type="number" value={planForm.planInstallments} onChange={(e) => setPlanForm((f) => ({ ...f, planInstallments: e.target.value }))} />
            <TextField label="起始月" type="date" value={planForm.planStartDate} onChange={(e) => setPlanForm((f) => ({ ...f, planStartDate: e.target.value }))} />
          </div>
          <p className="text-xs text-slate-500">各行還款計畫比例（與債權占比無關，加總須為 1）：</p>
          {participants.map((p) => (
            <div key={p.bankCode} className="flex items-center gap-2">
              <span className="w-40 text-sm text-slate-900">{p.bankName}</span>
              <input type="number" step="0.0001" className="w-32 rounded-lg border border-surface-border px-2 py-1 text-sm" value={planRatios[p.bankCode] ?? ''} onChange={(e) => setPlanRatios((r) => ({ ...r, [p.bankCode]: e.target.value }))} />
            </div>
          ))}
          <p className={`text-xs ${Math.abs(ratioSum - 1) > 0.0001 ? 'text-rose-600' : 'text-emerald-600'}`}>目前加總：{ratioSum.toFixed(4)}（須為 1）</p>
        </div>
      </Modal>

      <Modal open={disputeOpen} onClose={() => setDisputeOpen(false)} title="回報異議"
        footer={<><Button variant="secondary" onClick={() => setDisputeOpen(false)}>取消</Button><Button variant="danger" disabled={!disputeReason} onClick={() => { act(() => apiFetch(`/api/cases/${caseId}/dispute`, { method: 'POST', body: JSON.stringify({ reason: disputeReason }) }), '已回報異議'); setDisputeOpen(false); setDisputeReason('') }}>送出異議</Button></>}>
        <TextField label="異議原因" value={disputeReason} onChange={(e) => setDisputeReason(e.target.value)} placeholder="請說明資料有誤之處" />
      </Modal>

      <Modal open={repayOpen} onClose={() => setRepayOpen(false)} title="登記本期還款" widthClassName="max-w-md"
        footer={<><Button variant="secondary" onClick={() => setRepayOpen(false)}>取消</Button><Button onClick={saveRepay}>儲存</Button></>}>
        <div className="flex flex-col gap-3">
          <TextField label="期別 (YYYY-MM)" value={repayPeriod} onChange={(e) => setRepayPeriod(e.target.value)} placeholder="2026-07" />
          <TextField label="本期實際收到總額" type="number" value={repayTotal} onChange={(e) => setRepayTotal(e.target.value)} placeholder="由債務人收到的總額，系統自動依比例攤提各行" />
          <p className="text-xs text-slate-500">系統將依各行「還款計畫比例」自動攤提，尾差由主辦吸收。</p>
        </div>
      </Modal>

      <Modal open={terminateOpen} onClose={() => setTerminateOpen(false)} title="毀諾／終止案件"
        footer={<><Button variant="secondary" onClick={() => setTerminateOpen(false)}>取消</Button><Button variant="danger" disabled={!terminateReason} onClick={() => { act(() => apiFetch(`/api/cases/${caseId}/terminate`, { method: 'POST', body: JSON.stringify({ reason: terminateReason }) }), '案件已終止'); setTerminateOpen(false); setTerminateReason('') }}>確認終止</Button></>}>
        <TextField label="終止原因" value={terminateReason} onChange={(e) => setTerminateReason(e.target.value)} placeholder="例如：債務人連續三期未依方案還款" />
      </Modal>
    </div>
  )
}
