import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/Button'
import { TextField } from '@/components/TextField'
import { SelectField } from '@/components/SelectField'
import { isValidEmail } from '@/utils/validators'
import { apiFetch } from '@/services/api'
import { BANK_CODES } from '@/types'
import { formatBankLabel } from '@/utils/labels'
import type { BankCode } from '@/types'

/**
 * 申請密碼重置（邀請制、免寄信）：
 * 送出後由平台管理員在後台核發一次性重置碼，再交給本人使用。
 */
export function ForgotPasswordPage() {
  const [bankCode, setBankCode] = useState<BankCode | ''>('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(undefined)
    if (!bankCode) return setError('請選擇銀行／機構')
    if (!isValidEmail(email)) return setError('Email 格式不正確')

    setSubmitting(true)
    try {
      await apiFetch('/api/auth/request-password-reset', { method: 'POST', body: JSON.stringify({ bankCode, email }) })
      setDone(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="flex flex-col gap-5">
        <h2 className="text-base font-semibold text-slate-900">已送出密碼重置申請</h2>
        <p className="text-sm text-slate-600">
          若此帳號存在，平台管理員將收到您的申請並核發一次性重置碼；請向管理員索取重置碼／連結後，
          於註冊頁輸入以設定新密碼。
        </p>
        <Link to="/login" className="text-sm text-brand-700 hover:text-brand-500">返回登入</Link>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
      <div>
        <h2 className="text-base font-semibold text-slate-900">申請密碼重置</h2>
        <p className="mt-1 text-xs text-slate-500">選擇您的機構並輸入 Email，送出後由平台管理員核發重置碼。</p>
      </div>

      {error && <div role="alert" className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-600">{error}</div>}

      <SelectField
        label="銀行／機構"
        placeholder="請選擇銀行／機構"
        value={bankCode}
        onChange={(e) => setBankCode(e.target.value as BankCode)}
        options={BANK_CODES.map((code) => ({ value: code, label: formatBankLabel(code) }))}
      />
      <TextField label="Email" type="email" autoComplete="email" placeholder="請輸入 Email" value={email} onChange={(e) => setEmail(e.target.value)} />

      <Button type="submit" fullWidth loading={submitting}>送出申請</Button>
      <p className="text-center text-sm text-slate-500">
        已記得密碼？<Link to="/login" className="text-brand-700 hover:text-brand-500">返回登入</Link>
      </p>
    </form>
  )
}
