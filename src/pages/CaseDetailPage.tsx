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
  note?: string
}
interface Participant {
  participantId: string
  bankCode: string
  bankName: string
  roleInCase: string
  confirmationStatus: string
  confirmedAt: string | null
  removedAt: string | null
  removalKind: string | null
  removalReason: string | null
  confirmedClaimAmount: string | null
  liveTotal: number | null
  items: Item[] | null
}
interface Doubt {
  doubtId: string
  round: number
  raisedByBankCode: string
  reason: string
  pointerBankCode: string | null
  createdAt: string
}
interface CaseDetail {
  case: {
    caseId: string; courtCode: string; courtName: string; docNumber: string
    mainBankCode: string; mainBankName: string; status: string; round: number
    receiptDate: string | null; disclosedAt: string | null
    consolidatedTotal: string | null; outcomeReportedAt: string | null
    notEstablishedReason: string | null; note: string | null
  }
  viewer: { isMain: boolean; isParticipant: boolean; isAdmin: boolean; isAuditor: boolean; bankCode: string | null }
  participants: Participant[]
  doubts: Doubt[]
}
interface BankOpt { bankCode: string; bankName: string }

const DISCLOSED = ['PENDING_OUTCOME', 'ESTABLISHED', 'NOT_ESTABLISHED']
const num = (v: number | string | null | undefined) => (v == null ? 0 : Number(v) || 0)
const emptyItem = (): Item => ({ claimType: 'CREDIT_LOAN', principal: '', interest: '', penalty: '', otherFee: '', note: '' })

export function CaseDetailPage() {
  const { caseId } = useParams()
  const toast = useToast()
  const [data, setData] = useState<CaseDetail | null>(null)
  const [banks, setBanks] = useState<BankOpt[]>([])
  const [loading, setLoading] = useState(true)

  const [inviteBank, setInviteBank] = useState('')
  const [fillOpen, setFillOpen] = useState(false)
  const [fillItems, setFillItems] = useState<Item[]>([])
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [doubtOpen, setDoubtOpen] = useState(false)
  const [doubtReason, setDoubtReason] = useState('')
  const [doubtPointer, setDoubtPointer] = useState('')
  const [reportEstablished, setReportEstablished] = useState<boolean | null>(null)
  const [reportReason, setReportReason] = useState('')
  const [reportAck, setReportAck] = useState(false)

  const load = useCallback(() => {
    if (!caseId) return
    setLoading(true)
    Promise.all([
      apiFetch<CaseDetail>(`/api/cases/${caseId}`),
      apiFetch<{ banks: BankOpt[] }>('/api/banks?activeOnly=1'),
    ])
      .then(([d, b]) => { setData(d); setBanks(b.banks) })
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false))
  }, [caseId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(load, [load])

  if (loading || !data) return <p className="p-6 text-sm text-slate-500">載入中…</p>
  const { case: c, viewer, participants, doubts } = data
  const isMain = viewer.isMain
  const disclosed = DISCLOSED.includes(c.status)
  const terminal = c.status === 'ESTABLISHED' || c.status === 'NOT_ESTABLISHED'
  const active = participants.filter((p) => !p.removedAt)
  const removed = participants.filter((p) => p.removedAt)
  const myPart = active.find((p) => p.bankCode === viewer.bankCode)
  const confirmedCount = active.filter((p) => p.confirmationStatus === 'CONFIRMED').length

  const act = async (fn: () => Promise<unknown>, okMsg: string) => {
    try { await fn(); toast.success(okMsg); load() } catch (e) { toast.error((e as Error).message) }
  }

  const invitable = banks.filter((b) => b.bankCode !== 'PLATFORM' && !active.some((p) => p.bankCode === b.bankCode))

  const openFill = () => {
    const mine = myPart?.items
    setFillItems(mine && mine.length ? mine.map((i) => ({ ...i })) : [emptyItem()])
    setFillOpen(true)
  }
  const saveFill = async () => {
    const items = fillItems.map((i) => ({
      claimType: i.claimType,
      principal: num(i.principal),
      interest: num(i.interest),
      penalty: num(i.penalty),
      otherFee: num(i.otherFee),
      note: i.note || undefined,
    }))
    await act(() => apiFetch(`/api/cases/${caseId}/my-items`, { method: 'PUT', body: JSON.stringify({ items }) }), '本行債權明細已儲存')
    setFillOpen(false)
  }

  const submitReport = async () => {
    if (reportEstablished == null) return
    await act(
      () => apiFetch(`/api/cases/${caseId}/report`, {
        method: 'POST',
        body: JSON.stringify({ established: reportEstablished, reason: reportReason || undefined, confirm: true }),
      }),
      reportEstablished ? '已回報：案件成立' : '已回報：案件不成立',
    )
    setReportEstablished(null); setReportReason(''); setReportAck(false)
  }

  // 債權彙整表（揭露後）：各行四分項加總
  const consolidated = active.map((p) => {
    const its = p.items ?? []
    const sum = (k: keyof Item) => its.reduce((s, it) => s + num(it[k] as any), 0)
    return {
      bankCode: p.bankCode,
      bankName: p.bankName,
      roleInCase: p.roleInCase,
      principal: sum('principal'),
      interest: sum('interest'),
      penalty: sum('penalty'),
      otherFee: sum('otherFee'),
      total: num(p.confirmedClaimAmount) || its.reduce((s, it) => s + num(it.principal) + num(it.interest) + num(it.penalty) + num(it.otherFee), 0),
      hasItems: p.items !== null,
    }
  })
  const grand = consolidated.reduce(
    (a, r) => ({ principal: a.principal + r.principal, interest: a.interest + r.interest, penalty: a.penalty + r.penalty, otherFee: a.otherFee + r.otherFee, total: a.total + r.total }),
    { principal: 0, interest: 0, penalty: 0, otherFee: 0, total: 0 },
  )

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6">
      <Link to="/cases" className="text-sm text-slate-500 hover:text-slate-900">← 案件列表</Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{c.docNumber}</h1>
          <p className="mt-1 text-sm text-slate-500">{c.courtName}．主辦（最大債權行）{c.mainBankName}
            {c.round > 1 && <span className="ml-2">第 {c.round} 輪確認</span>}
            {c.receiptDate && <span className="ml-2">收文日 {c.receiptDate.slice(0, 10)}</span>}
          </p>
        </div>
        <span className="rounded-full bg-brand-600/10 px-3 py-1 text-sm font-medium text-brand-700">{CASE_STATUS_LABELS[c.status] ?? c.status}</span>
      </div>

      {/* 終態橫幅 */}
      {c.status === 'ESTABLISHED' && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-700">
          本案已由主辦回報「成立」，債權彙整表已鎖定為正式紀錄。此為終態，不可再變更。
        </div>
      )}
      {c.status === 'NOT_ESTABLISHED' && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm text-rose-700">
          本案已由主辦回報「不成立」。{c.notEstablishedReason && <>理由：{c.notEstablishedReason}</>}此為終態，不可再變更。
        </div>
      )}

      {/* 彙整總額（揭露後、非平台管理員） */}
      {disclosed && !viewer.isAdmin && (
        <div className="flex flex-wrap gap-4 rounded-2xl border border-surface-border bg-surface-raised p-4 text-sm shadow-card">
          <span>全案債權總額 <b className="text-slate-900">{money(c.consolidatedTotal)}</b></span>
          <span>參與行 <b className="text-slate-900">{active.length}</b></span>
          {c.disclosedAt && <span>揭露時間 <b className="text-slate-900">{c.disclosedAt.slice(0, 10)}</b></span>}
        </div>
      )}

      {/* 我的操作 */}
      {myPart && !viewer.isAdmin && !terminal && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3">
          {c.status === 'PENDING_CONFIRMATION' && (
            <>
              <p className="text-sm text-amber-800">
                您是本案{myPart.roleInCase === 'MAIN' ? '主辦' : '參與'}行，目前：{CONFIRM_STATUS_LABELS[myPart.confirmationStatus]}。
                {myPart.confirmationStatus === 'PENDING' ? '請填報本行債權並確認（確認前僅您看得到自己的數字）。' : '如需修改請先撤回確認。'}
              </p>
              <div className="ml-auto flex flex-wrap gap-2">
                {myPart.confirmationStatus === 'PENDING' ? (
                  <>
                    <Button size="sm" variant="secondary" onClick={openFill}>填報本行債權</Button>
                    <Button size="sm" onClick={() => act(() => apiFetch(`/api/cases/${caseId}/confirm`, { method: 'POST' }), '已確認本行債權')}>確認無誤</Button>
                  </>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => act(() => apiFetch(`/api/cases/${caseId}/withdraw`, { method: 'POST' }), '已撤回確認')}>撤回確認</Button>
                )}
                {myPart.roleInCase === 'CO_BANK' && <Button size="sm" variant="danger" onClick={() => setRejectOpen(true)}>非本案債權人</Button>}
              </div>
            </>
          )}
          {c.status === 'PENDING_OUTCOME' && (
            <>
              <p className="text-sm text-amber-800">已全員確認並揭露，可檢視債權彙整表。如發現數字有疑義，可標記後退回全員重新確認。</p>
              <div className="ml-auto"><Button size="sm" variant="secondary" onClick={() => setDoubtOpen(true)}>標記疑義</Button></div>
            </>
          )}
        </div>
      )}

      {/* 參與銀行與確認進度 */}
      <section className="rounded-2xl border border-surface-border bg-surface-raised p-5 shadow-card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">參與銀行與確認進度（{confirmedCount}/{active.length}）</h2>
        </div>
        <div className="flex flex-col gap-2">
          {active.map((p) => (
            <div key={p.participantId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-surface-border px-3 py-2 text-sm">
              <span className="text-slate-900">{p.bankName}
                <span className="ml-2 text-xs text-slate-500">{p.roleInCase === 'MAIN' ? '主辦（最大債權行）' : '其他債權行'}</span>
              </span>
              <span className="flex items-center gap-2 text-slate-700">
                <span className={p.confirmationStatus === 'CONFIRMED' ? 'text-emerald-700' : 'text-amber-700'}>
                  {CONFIRM_STATUS_LABELS[p.confirmationStatus] ?? p.confirmationStatus}
                </span>
                {isMain && !disclosed && p.roleInCase === 'CO_BANK' && (
                  <button type="button" className="text-xs text-rose-600 hover:underline"
                    onClick={() => act(() => apiFetch(`/api/cases/${caseId}/participants/${p.bankCode}/remove`, { method: 'POST', body: JSON.stringify({ reason: '主辦移出' }) }), '已移出該行')}>移出</button>
                )}
              </span>
            </div>
          ))}
          {removed.map((p) => (
            <div key={p.participantId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-surface-border px-3 py-2 text-sm opacity-70">
              <span className="text-slate-500 line-through">{p.bankName}</span>
              <span className="text-xs text-slate-500">
                {p.removalKind === 'REJECTED_SELF' ? '自行拒絕參與' : '主辦移出'}
                {p.removalReason && <>：{p.removalReason}</>}
                {isMain && !disclosed && (
                  <button type="button" className="ml-2 text-brand-700 hover:underline"
                    onClick={() => act(() => apiFetch(`/api/cases/${caseId}/participants`, { method: 'POST', body: JSON.stringify({ bankCode: p.bankCode }) }), '已重新邀請')}>重新邀請</button>
                )}
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

      {/* 債權：揭露前各自封閉；揭露後為債權彙整表 */}
      <section className="rounded-2xl border border-surface-border bg-surface-raised p-5 shadow-card">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">{disclosed ? '債權彙整表' : '各行債權（封閉申報中）'}</h2>
        {viewer.isAdmin ? (
          <p className="text-sm text-slate-500">平台管理員僅可檢視案件狀態與進度，不開放檢視任何金額。</p>
        ) : disclosed ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="p-2">參與行</th><th className="p-2 text-right">本金</th><th className="p-2 text-right">利息</th>
                  <th className="p-2 text-right">違約金</th><th className="p-2 text-right">其他費用</th><th className="p-2 text-right">該行債權總額</th>
                </tr>
              </thead>
              <tbody>
                {consolidated.map((r) => (
                  <tr key={r.bankCode} className="border-t border-surface-border text-slate-700">
                    <td className="p-2 text-slate-900">{r.bankName}<span className="ml-1 text-xs text-slate-500">{r.roleInCase === 'MAIN' ? '主辦' : ''}</span></td>
                    {r.hasItems ? (
                      <>
                        <td className="p-2 text-right">{money(String(r.principal))}</td>
                        <td className="p-2 text-right">{money(String(r.interest))}</td>
                        <td className="p-2 text-right">{money(String(r.penalty))}</td>
                        <td className="p-2 text-right">{money(String(r.otherFee))}</td>
                        <td className="p-2 text-right font-medium text-slate-900">{money(String(r.total))}</td>
                      </>
                    ) : (
                      <td className="p-2 text-right text-slate-400" colSpan={5}>（不開放檢視）</td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-surface-border font-semibold text-slate-900">
                  <td className="p-2">總計</td>
                  <td className="p-2 text-right">{money(String(grand.principal))}</td>
                  <td className="p-2 text-right">{money(String(grand.interest))}</td>
                  <td className="p-2 text-right">{money(String(grand.penalty))}</td>
                  <td className="p-2 text-right">{money(String(grand.otherFee))}</td>
                  <td className="p-2 text-right">{money(c.consolidatedTotal ?? String(grand.total))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {active.map((p) => {
              const mine = p.bankCode === viewer.bankCode
              return (
                <div key={p.participantId} className="rounded-xl border border-surface-border p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-900">{p.bankName}
                      {mine && <span className="ml-2 rounded bg-brand-600/10 px-1.5 py-0.5 text-xs text-brand-700">本行</span>}
                    </span>
                    {p.items !== null && <span className="text-sm text-slate-700">目前加總 {money(String(p.liveTotal ?? 0))}</span>}
                  </div>
                  {p.items === null ? (
                    <p className="mt-1 text-xs text-slate-500">封閉申報中，其他行數字於全員確認、揭露後才可見。</p>
                  ) : p.items.length === 0 ? (
                    <p className="mt-1 text-xs text-slate-500">{mine ? '尚未填報，請點上方「填報本行債權」。' : '該行尚未填報。'}</p>
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
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* 疑義紀錄 */}
      {doubts.length > 0 && (
        <section className="rounded-2xl border border-surface-border bg-surface-raised p-5 shadow-card">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">疑義紀錄</h2>
          <div className="flex flex-col gap-2">
            {doubts.map((d) => (
              <div key={d.doubtId} className="rounded-lg border border-surface-border px-3 py-2 text-sm text-slate-700">
                <span className="text-xs text-slate-500">第 {d.round} 輪．{d.createdAt.slice(0, 10)}．由 {d.raisedByBankCode} 提出{d.pointerBankCode && `（指向 ${d.pointerBankCode}）`}</span>
                <p className="mt-0.5">{d.reason}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 主辦操作 */}
      {isMain && !terminal && (
        <div className="flex flex-wrap gap-3">
          {c.status === 'DRAFT' && <Button onClick={() => act(() => apiFetch(`/api/cases/${caseId}/publish`, { method: 'POST' }), '案件已發布，已通知其他債權行')}>發布案件（開放封閉申報）</Button>}
          {c.status === 'PENDING_OUTCOME' && <Button onClick={() => { setReportEstablished(true); setReportReason(''); setReportAck(false) }}>回報成立</Button>}
          {(c.status === 'PENDING_OUTCOME' || c.status === 'PENDING_CONFIRMATION') && (
            <Button variant="danger" onClick={() => { setReportEstablished(false); setReportReason(''); setReportAck(false) }}>回報不成立</Button>
          )}
        </div>
      )}

      {/* ---- Modals ---- */}
      <Modal open={fillOpen} onClose={() => setFillOpen(false)} title="填報本行債權" widthClassName="max-w-2xl"
        footer={<><Button variant="secondary" onClick={() => setFillOpen(false)}>取消</Button><Button onClick={saveFill}>儲存</Button></>}>
        <div className="flex flex-col gap-3">
          {fillItems.map((it, idx) => (
            <div key={idx} className="grid grid-cols-2 gap-2 rounded-xl border border-surface-border p-3 sm:grid-cols-3">
              <SelectField label="類型" value={it.claimType} options={CLAIM_TYPES.map((t) => ({ value: t, label: CLAIM_TYPE_LABELS[t] }))} onChange={(e) => setFillItems((a) => a.map((x, i) => i === idx ? { ...x, claimType: e.target.value } : x))} />
              <TextField label="本金" type="number" value={String(it.principal)} onChange={(e) => setFillItems((a) => a.map((x, i) => i === idx ? { ...x, principal: e.target.value } : x))} />
              <TextField label="利息" type="number" value={String(it.interest)} onChange={(e) => setFillItems((a) => a.map((x, i) => i === idx ? { ...x, interest: e.target.value } : x))} />
              <TextField label="違約金" type="number" value={String(it.penalty)} onChange={(e) => setFillItems((a) => a.map((x, i) => i === idx ? { ...x, penalty: e.target.value } : x))} />
              <TextField label="其他費用" type="number" value={String(it.otherFee)} onChange={(e) => setFillItems((a) => a.map((x, i) => i === idx ? { ...x, otherFee: e.target.value } : x))} />
              <button type="button" className="col-span-full text-left text-xs text-rose-600" onClick={() => setFillItems((a) => a.filter((_, i) => i !== idx))}>移除此列</button>
            </div>
          ))}
          <button type="button" className="text-sm text-brand-700" onClick={() => setFillItems((a) => [...a, emptyItem()])}>+ 新增一列</button>
          <p className="text-xs text-slate-500">僅您本行可填報／修改本行數字，全員確認前其他行看不到。</p>
        </div>
      </Modal>

      <Modal open={rejectOpen} onClose={() => setRejectOpen(false)} title="拒絕參與（非本案債權人）"
        footer={<><Button variant="secondary" onClick={() => setRejectOpen(false)}>取消</Button><Button variant="danger" disabled={!rejectReason} onClick={() => { act(() => apiFetch(`/api/cases/${caseId}/reject`, { method: 'POST', body: JSON.stringify({ reason: rejectReason }) }), '已退出本案'); setRejectOpen(false); setRejectReason('') }}>確認退出</Button></>}>
        <TextField label="理由" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="例如：本行帳載查無此案，非本案債權人" />
        <p className="mt-2 text-xs text-slate-500">拒絕後即自行移出本案（留稽核）。主辦如認為誤拒可再邀請您。</p>
      </Modal>

      <Modal open={doubtOpen} onClose={() => setDoubtOpen(false)} title="標記疑義（將退回全員重新確認）"
        footer={<><Button variant="secondary" onClick={() => setDoubtOpen(false)}>取消</Button><Button variant="danger" disabled={!doubtReason} onClick={() => { act(() => apiFetch(`/api/cases/${caseId}/doubt`, { method: 'POST', body: JSON.stringify({ reason: doubtReason, pointerBankCode: doubtPointer || undefined }) }), '已標記疑義，案件退回重新確認'); setDoubtOpen(false); setDoubtReason(''); setDoubtPointer('') }}>送出疑義</Button></>}>
        <div className="flex flex-col gap-3">
          <TextField label="疑義理由 *" value={doubtReason} onChange={(e) => setDoubtReason(e.target.value)} placeholder="請說明有疑義之處" />
          <SelectField label="指向某參與行（選填）" placeholder="不指定" value={doubtPointer} onChange={(e) => setDoubtPointer(e.target.value)} options={active.map((p) => ({ value: p.bankCode, label: p.bankName }))} />
          <p className="text-xs text-slate-500">送出後案件退回封閉申報，全員確認狀態全部重置，需再次全員確認。</p>
        </div>
      </Modal>

      <Modal open={reportEstablished != null} onClose={() => setReportEstablished(null)}
        title={reportEstablished ? '回報：案件成立' : '回報：案件不成立'} widthClassName="max-w-md"
        footer={<><Button variant="secondary" onClick={() => setReportEstablished(null)}>取消</Button>
          <Button variant={reportEstablished ? 'primary' : 'danger'} disabled={!reportAck || (!reportEstablished && !reportReason.trim())} onClick={submitReport}>
            確認回報「{reportEstablished ? '成立' : '不成立'}」
          </Button></>}>
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-slate-700">您即將回報本案結果為 <b className={reportEstablished ? 'text-emerald-700' : 'text-rose-700'}>{reportEstablished ? '成立' : '不成立'}</b>。此為主辦線下與債務人確認後之結果登錄（系統存證、非系統裁定）。</p>
          {!reportEstablished && (
            <TextField label="不成立理由 *" value={reportReason} onChange={(e) => setReportReason(e.target.value)} placeholder="請填寫不成立的原因" />
          )}
          <label className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-rose-700">
            <input type="checkbox" checked={reportAck} onChange={(e) => setReportAck(e.target.checked)} className="mt-0.5" />
            <span>我確認結果為「{reportEstablished ? '成立' : '不成立'}」，並了解結案後為<b>終態、不可回復、不得以同文號新建</b>。</span>
          </label>
        </div>
      </Modal>
    </div>
  )
}
