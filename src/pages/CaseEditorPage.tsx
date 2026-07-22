import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useToast } from '@/hooks/useToast'
import { apiFetch } from '@/services/api'
import { Button } from '@/components/Button'
import { TextField } from '@/components/TextField'

/**
 * 建立案件（僅銀行人員；建立者所屬銀行即該案最大債權行）。
 * 建立後導向案件詳情頁，於該頁繼續「邀請其他債權行 → 代填債權 → 發布」。
 */
export function CaseEditorPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({
    caseNumber: '',
    debtorId: '',
    debtorName: '',
    receiptDate: '',
    declarationDeadline: '',
    mediationInstitution: '',
    totalDebtAmount: '',
    monthlyInstallment: '',
    planInstallments: '',
    note: '',
  })
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!form.caseNumber || !form.debtorId || !form.debtorName || !form.receiptDate || !form.declarationDeadline) {
      toast.error('請填寫案號、債務人、收件日與確認期限')
      return
    }
    setSubmitting(true)
    try {
      const body = {
        caseNumber: form.caseNumber,
        debtorId: form.debtorId,
        debtorName: form.debtorName,
        receiptDate: form.receiptDate,
        declarationDeadline: form.declarationDeadline,
        mediationInstitution: form.mediationInstitution || undefined,
        note: form.note || undefined,
        totalDebtAmount: form.totalDebtAmount ? Number(form.totalDebtAmount) : undefined,
        monthlyInstallment: form.monthlyInstallment ? Number(form.monthlyInstallment) : undefined,
        planInstallments: form.planInstallments ? Number(form.planInstallments) : undefined,
      }
      const res = await apiFetch<{ caseId: string }>('/api/cases', { method: 'POST', body: JSON.stringify(body) })
      toast.success('案件已建立，請繼續邀請其他債權行並代填債權')
      navigate(`/cases/${res.caseId}`, { replace: true })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex items-center gap-2">
        <Link to="/cases" className="text-sm text-slate-500 hover:text-slate-900">← 案件列表</Link>
      </div>
      <h1 className="text-xl font-semibold text-slate-900">新增案件</h1>
      <p className="text-sm text-slate-500">您所屬的銀行將成為此案件的「最大債權行」。</p>

      <form onSubmit={submit} className="flex flex-col gap-4 rounded-2xl border border-surface-border bg-surface-raised p-6 shadow-card">
        <TextField label="案號 *" value={form.caseNumber} onChange={set('caseNumber')} placeholder="MED-2026-001" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField label="債務人身分證字號 *" value={form.debtorId} onChange={set('debtorId')} placeholder="A123456789" />
          <TextField label="債務人姓名 *" value={form.debtorName} onChange={set('debtorName')} placeholder="王小明" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField label="收件日 *" type="date" value={form.receiptDate} onChange={set('receiptDate')} />
          <TextField label="確認期限 *" type="date" value={form.declarationDeadline} onChange={set('declarationDeadline')} />
        </div>
        <TextField label="調解機構" value={form.mediationInstitution} onChange={set('mediationInstitution')} placeholder="（選填）" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <TextField label="方案總債權額" type="number" value={form.totalDebtAmount} onChange={set('totalDebtAmount')} placeholder="選填" />
          <TextField label="每期還款額" type="number" value={form.monthlyInstallment} onChange={set('monthlyInstallment')} placeholder="選填" />
          <TextField label="預計期數" type="number" value={form.planInstallments} onChange={set('planInstallments')} placeholder="選填" />
        </div>
        <TextField label="備註" value={form.note} onChange={set('note')} placeholder="（選填）" />
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" type="button" onClick={() => navigate('/cases')}>取消</Button>
          <Button type="submit" loading={submitting}>建立案件</Button>
        </div>
      </form>
    </div>
  )
}
