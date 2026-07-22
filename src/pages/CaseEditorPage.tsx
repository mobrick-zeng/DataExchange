import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useToast } from '@/hooks/useToast'
import { apiFetch } from '@/services/api'
import { Button } from '@/components/Button'
import { TextField } from '@/components/TextField'
import { SelectField } from '@/components/SelectField'

interface CourtOpt { courtCode: string; courtName: string }

/**
 * 建立案件（僅銀行人員；建立者所屬銀行即該案最大債權行）。
 * 以「法院 + 公文文號」辨識，不填債務人個資。建立後於詳情頁繼續代填、設定計畫、邀請、發布。
 */
export function CaseEditorPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const [courts, setCourts] = useState<CourtOpt[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({ courtCode: '', docNumber: '', receiptDate: '', confirmationDeadline: '', note: '' })
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }))

  useEffect(() => { apiFetch<{ courts: CourtOpt[] }>('/api/courts?activeOnly=1').then((r) => setCourts(r.courts)).catch((e) => toast.error((e as Error).message)) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!form.courtCode || !form.docNumber) {
      toast.error('請選擇法院並填寫公文文號')
      return
    }
    setSubmitting(true)
    try {
      const body = {
        courtCode: form.courtCode,
        docNumber: form.docNumber,
        receiptDate: form.receiptDate || undefined,
        confirmationDeadline: form.confirmationDeadline || undefined,
        note: form.note || undefined,
      }
      const res = await apiFetch<{ caseId: string }>('/api/cases', { method: 'POST', body: JSON.stringify(body) })
      toast.success('案件已建立，請繼續代填債權、設定還款計畫並邀請其他債權行')
      navigate(`/cases/${res.caseId}`, { replace: true })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 p-4 sm:p-6">
      <Link to="/cases" className="text-sm text-slate-500 hover:text-slate-900">← 案件列表</Link>
      <h1 className="text-xl font-semibold text-slate-900">新增案件</h1>
      <p className="text-sm text-slate-500">您所屬的銀行將成為此案件的「最大債權行」。本平台不儲存債務人個資，以法院公文文號辨識。</p>

      <form onSubmit={submit} className="flex flex-col gap-4 rounded-2xl border border-surface-border bg-surface-raised p-6 shadow-card">
        <SelectField label="法院 *" placeholder="選擇法院" value={form.courtCode} onChange={set('courtCode')} options={courts.map((c) => ({ value: c.courtCode, label: c.courtName }))} />
        <TextField label="法院公文文號 *" value={form.docNumber} onChange={set('docNumber')} placeholder="例：北院民聲字第1130000123號" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField label="收文日" type="date" value={form.receiptDate} onChange={set('receiptDate')} />
          <TextField label="確認期限" type="date" value={form.confirmationDeadline} onChange={set('confirmationDeadline')} />
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
