import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/Button'
import { TextField } from '@/components/TextField'
import { PasswordField } from '@/components/PasswordField'
import { SelectField } from '@/components/SelectField'
import { isValidEmail } from '@/utils/validators'
import { apiFetch } from '@/services/api'
import { useToast } from '@/hooks/useToast'

interface BankOpt { bankCode: string; bankName: string }

/**
 * 忘記密碼：兩種模式
 * 1) 申請重置：填銀行 + Email，送出後由管理員核發一次性重置碼（外部管道遞送）。
 * 2) 我已有重置碼：填銀行 + Email + 重置碼 + 新密碼，直接設定新密碼。
 */
export function ForgotPasswordPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const [banks, setBanks] = useState<BankOpt[]>([])
  const [mode, setMode] = useState<'request' | 'reset'>('request')
  const [bankCode, setBankCode] = useState('')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => { apiFetch<{ banks: BankOpt[] }>('/api/auth/active-banks').then((r) => setBanks(r.banks)).catch(() => {}) }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(undefined)
    if (!bankCode) return setError('請選擇銀行／機構')
    if (!isValidEmail(email)) return setError('Email 格式不正確')
    setSubmitting(true)
    try {
      if (mode === 'request') {
        await apiFetch('/api/auth/request-password-reset', { method: 'POST', body: JSON.stringify({ bankCode, email }) })
        setDone(true)
      } else {
        if (!code.trim()) { setError('請輸入重置碼'); setSubmitting(false); return }
        if (password.length < 8) { setError('新密碼至少 8 碼'); setSubmitting(false); return }
        await apiFetch('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ bankCode, email, code: code.trim(), password }) })
        toast.success('密碼已重設，請以新密碼登入')
        navigate('/login', { replace: true })
      }
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
        <p className="text-sm text-slate-600">若此帳號存在，平台管理員將核發一次性重置碼並經管道交付予您。取得重置碼後，回到本頁選「我已有重置碼」設定新密碼。</p>
        <button className="text-left text-sm text-brand-700 hover:text-brand-500" onClick={() => { setDone(false); setMode('reset') }}>我已收到重置碼 →</button>
        <Link to="/login" className="text-sm text-slate-500 hover:text-slate-900">返回登入</Link>
      </div>
    )
  }

  const bankSelect = (
    <SelectField
      label="銀行／機構"
      placeholder="請選擇銀行／機構"
      value={bankCode}
      onChange={(e) => setBankCode(e.target.value)}
      options={banks.map((b) => ({ value: b.bankCode, label: b.bankCode === 'PLATFORM' ? b.bankName : `${b.bankName}（${b.bankCode}）` }))}
    />
  )

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <div>
        <h2 className="text-base font-semibold text-slate-900">忘記密碼</h2>
        <div className="mt-2 flex gap-2 text-sm">
          <button type="button" onClick={() => setMode('request')} className={`rounded-lg px-3 py-1 ${mode === 'request' ? 'bg-brand-600/15 text-brand-700' : 'text-slate-500'}`}>申請重置</button>
          <button type="button" onClick={() => setMode('reset')} className={`rounded-lg px-3 py-1 ${mode === 'reset' ? 'bg-brand-600/15 text-brand-700' : 'text-slate-500'}`}>我已有重置碼</button>
        </div>
      </div>

      {error && <div role="alert" className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-600">{error}</div>}

      {bankSelect}
      <TextField label="Email" type="email" autoComplete="email" placeholder="請輸入 Email" value={email} onChange={(e) => setEmail(e.target.value)} />

      {mode === 'reset' && (
        <>
          <TextField label="重置碼" value={code} onChange={(e) => setCode(e.target.value)} placeholder="請輸入管理員核發的重置碼" />
          <PasswordField label="新密碼（至少 8 碼）" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </>
      )}

      <Button type="submit" fullWidth loading={submitting}>{mode === 'request' ? '送出申請' : '設定新密碼'}</Button>
      <p className="text-center text-sm text-slate-500">已記得密碼？<Link to="/login" className="text-brand-700 hover:text-brand-500">返回登入</Link></p>
    </form>
  )
}
