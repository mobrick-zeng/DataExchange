import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useToast } from '@/hooks/useToast'
import { apiFetch } from '@/services/api'
import { Button } from '@/components/Button'
import { TextField } from '@/components/TextField'
import { SelectField } from '@/components/SelectField'

interface CourtOpt { courtCode: string; courtName: string }
interface CaseDetailLite {
  case: {
    courtCode: string; docNumber: string; status: string
    receiptDate: string | null; mediationDate: string | null; mediationTime: string | null
    mediationPlace: string | null; interestCutoffDate: string | null; note: string | null
  }
  viewer: { isMain: boolean }
}

const emptyForm = {
  courtCode: '', docNumber: '', receiptDate: '',
  mediationDate: '', mediationTime: '', mediationPlace: '', interestCutoffDate: '', note: '',
}
const dateOnly = (s: string | null | undefined) => (s ? s.slice(0, 10) : '')

/**
 * 案件建立／異動。
 * - 建立：僅銀行人員；建立者所屬銀行即該案最大債權行。以「法院 + 公文文號」辨識，不填債務人個資。
 * - 異動：僅主辦。法院／公文文號**僅草稿可改**；其餘資訊欄位於非終態皆可補填或更正。
 */
export function CaseEditorPage() {
  const { caseId } = useParams()
  const isEdit = !!caseId
  const navigate = useNavigate()
  const toast = useToast()
  const [courts, setCourts] = useState<CourtOpt[]>([])
  const [loading, setLoading] = useState(isEdit)
  const [submitting, setSubmitting] = useState(false)
  const [status, setStatus] = useState<string>('DRAFT')
  const [form, setForm] = useState(emptyForm)
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const identityLocked = isEdit && status !== 'DRAFT'

  useEffect(() => {
    apiFetch<{ courts: CourtOpt[] }>('/api/courts?activeOnly=1')
      .then((r) => setCourts(r.courts))
      .catch((e) => toast.error((e as Error).message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!caseId) return
    setLoading(true)
    apiFetch<CaseDetailLite>(`/api/cases/${caseId}`)
      .then((d) => {
        if (!d.viewer.isMain) { toast.error('僅主辦可異動案件'); navigate(`/cases/${caseId}`, { replace: true }); return }
        setStatus(d.case.status)
        setForm({
          courtCode: d.case.courtCode,
          docNumber: d.case.docNumber,
          receiptDate: dateOnly(d.case.receiptDate),
          mediationDate: dateOnly(d.case.mediationDate),
          mediationTime: d.case.mediationTime ?? '',
          mediationPlace: d.case.mediationPlace ?? '',
          interestCutoffDate: dateOnly(d.case.interestCutoffDate),
          note: d.case.note ?? '',
        })
      })
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!form.courtCode || !form.docNumber) {
      toast.error('請選擇法院並填寫公文文號')
      return
    }
    setSubmitting(true)
    try {
      if (isEdit) {
        // 只送資訊欄位；識別欄位僅在草稿階段一併送出
        const body: Record<string, unknown> = {
          receiptDate: form.receiptDate || null,
          mediationDate: form.mediationDate || null,
          mediationTime: form.mediationTime || null,
          mediationPlace: form.mediationPlace || null,
          interestCutoffDate: form.interestCutoffDate || null,
          note: form.note || null,
        }
        if (!identityLocked) { body.courtCode = form.courtCode; body.docNumber = form.docNumber }
        await apiFetch(`/api/cases/${caseId}`, { method: 'PATCH', body: JSON.stringify(body) })
        toast.success('案件已更新')
        navigate(`/cases/${caseId}`, { replace: true })
      } else {
        const body = {
          courtCode: form.courtCode,
          docNumber: form.docNumber,
          receiptDate: form.receiptDate || undefined,
          mediationDate: form.mediationDate || undefined,
          mediationTime: form.mediationTime || undefined,
          mediationPlace: form.mediationPlace || undefined,
          interestCutoffDate: form.interestCutoffDate || undefined,
          note: form.note || undefined,
        }
        const res = await apiFetch<{ caseId: string }>('/api/cases', { method: 'POST', body: JSON.stringify(body) })
        toast.success('案件已建立，請填報本行債權、邀請其他債權行後發布')
        navigate(`/cases/${res.caseId}`, { replace: true })
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <p className="p-6 text-sm text-slate-500">載入中…</p>

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 p-4 sm:p-6">
      <Link to={isEdit ? `/cases/${caseId}` : '/cases'} className="text-sm text-slate-500 hover:text-slate-900">
        ← {isEdit ? '返回案件' : '案件列表'}
      </Link>
      <h1 className="text-xl font-semibold text-slate-900">{isEdit ? '異動案件' : '新增案件'}</h1>
      <p className="text-sm text-slate-500">
        {isEdit
          ? '調解庭期、地點等欄位可於案件結案前隨時補填或更正；本平台不儲存債務人個資。'
          : '您所屬的銀行將成為此案件的「最大債權行」。本平台不儲存債務人個資，以法院公文文號辨識。'}
      </p>

      <form onSubmit={submit} className="flex flex-col gap-4 rounded-2xl border border-surface-border bg-surface-raised p-6 shadow-card">
        <SelectField label="法院 *" placeholder="選擇法院" value={form.courtCode} onChange={set('courtCode')}
          disabled={identityLocked} options={courts.map((c) => ({ value: c.courtCode, label: c.courtName }))} />
        <TextField label="法院公文文號 *" value={form.docNumber} onChange={set('docNumber')}
          disabled={identityLocked} placeholder="例：北院民聲字第1130000123號" />
        {identityLocked && (
          <p className="-mt-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700">
            案件已發布，<b>法院與公文文號不可再變更</b>（避免已申報各行的辨識基準改變）。如文號確有誤植，請以疑義流程或回報不成立處理。
          </p>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField label="收文日" type="date" value={form.receiptDate} onChange={set('receiptDate')} />
          <TextField label="利息及違約金計算截止日" type="date" value={form.interestCutoffDate} onChange={set('interestCutoffDate')} />
        </div>
        <p className="-mt-2 text-xs text-slate-400">收文日須為今日以前、且在一年內（避免誤選極端值）。</p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <TextField label="調解庭期（日期）" type="date" value={form.mediationDate} onChange={set('mediationDate')} />
          <TextField label="調解時間" type="time" value={form.mediationTime} onChange={set('mediationTime')} />
          <TextField label="調解地點" value={form.mediationPlace} onChange={set('mediationPlace')} placeholder="例：臺北地院第三調解室" />
        </div>
        <p className="-mt-2 text-xs text-slate-400">
          調解庭期為選填；填寫後系統會在庭期前提示尚未完成申報的案件。
        </p>

        <TextField label="備註" value={form.note} onChange={set('note')} placeholder="（選填）" />

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => navigate(isEdit ? `/cases/${caseId}` : '/cases')}>取消</Button>
          <Button type="submit" disabled={submitting}>{submitting ? '處理中…' : isEdit ? '儲存變更' : '建立案件'}</Button>
        </div>
      </form>
    </div>
  )
}
