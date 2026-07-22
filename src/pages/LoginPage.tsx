import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiFetch } from '@/services/api'
import { apiLogin, apiActivate } from '@/services/apiAuth'
import { useAuthStore } from '@/stores/authStore'
import { useToast } from '@/hooks/useToast'
import { Button } from '@/components/Button'
import { SelectField } from '@/components/SelectField'
import { TextField } from '@/components/TextField'
import { PasswordField } from '@/components/PasswordField'
import { Checkbox } from '@/components/Checkbox'
import { AccountHelpModal } from '@/components/AccountHelpModal'

const REMEMBER_KEY = 'mediation-platform:remember-login'
interface BankOpt { bankCode: string; bankName: string }

export function LoginPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const setCurrentUser = useAuthStore((s) => s.setCurrentUser)

  const [banks, setBanks] = useState<BankOpt[]>([])
  const [bankCode, setBankCode] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(false)
  const [formError, setFormError] = useState<string | undefined>()
  const [submitting, setSubmitting] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)

  // 啟用模式（待啟用帳號輸入啟用碼後切換）
  const [activation, setActivation] = useState<{ code: string; name: string } | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [consent, setConsent] = useState(false)

  useEffect(() => {
    apiFetch<{ banks: BankOpt[] }>('/api/auth/active-banks').then((r) => setBanks(r.banks)).catch(() => {})
    const raw = window.localStorage.getItem(REMEMBER_KEY)
    if (raw) {
      try {
        const r = JSON.parse(raw) as { bankCode: string; email: string }
        setBankCode(r.bankCode); setEmail(r.email); setRememberMe(true)
      } catch { window.localStorage.removeItem(REMEMBER_KEY) }
    }
  }, [])

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault()
    setFormError(undefined)
    if (!bankCode || !email.trim() || !password) {
      setFormError('請選擇銀行／機構並輸入帳號與密碼（或啟用碼）。')
      return
    }
    setSubmitting(true)
    const result = await apiLogin(bankCode, email, password)
    setSubmitting(false)

    switch (result.status) {
      case 'SUCCESS':
        if (rememberMe) window.localStorage.setItem(REMEMBER_KEY, JSON.stringify({ bankCode, email }))
        else window.localStorage.removeItem(REMEMBER_KEY)
        setCurrentUser(result.user)
        toast.success(`登入成功，歡迎回來，${result.user.name}`)
        navigate('/dashboard', { replace: true })
        return
      case 'ACTIVATION_REQUIRED':
        setActivation({ code: password, name: result.name })
        setFormError(undefined)
        return
      case 'INVALID_CREDENTIALS':
        setFormError('銀行／帳號／密碼不正確，請確認後再試一次。')
        return
      default:
        setFormError(result.status === 'ERROR' && result.message ? result.message : '無法連線伺服器，請確認後端服務是否啟動。')
        return
    }
  }

  const handleActivate = async (e: FormEvent) => {
    e.preventDefault()
    setFormError(undefined)
    if (newPassword.length < 8) return setFormError('新密碼至少 8 碼。')
    if (newPassword !== confirmPassword) return setFormError('兩次輸入的密碼不一致。')
    if (!consent) return setFormError('請勾選個資蒐集／利用同意後再啟用。')
    setSubmitting(true)
    const r = await apiActivate({ bankCode, email, code: activation!.code, password: newPassword, consent: true })
    setSubmitting(false)
    if (r.status === 'SUCCESS') {
      setCurrentUser(r.user)
      toast.success('帳號啟用成功，已為您登入')
      navigate('/dashboard', { replace: true })
    } else {
      setFormError(r.message ?? '啟用失敗')
    }
  }

  if (activation) {
    return (
      <form onSubmit={handleActivate} noValidate className="flex flex-col gap-5">
        <div>
          <h2 className="text-base font-semibold text-slate-900">啟用帳號</h2>
          <p className="mt-1 text-xs text-slate-500">{activation.name}，請設定登入密碼並確認個資同意，即可完成啟用。</p>
        </div>
        {formError && <div role="alert" className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-600">{formError}</div>}
        <PasswordField label="新密碼（至少 8 碼）" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        <PasswordField label="再次輸入新密碼" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
        <Checkbox label="我已閱讀並同意個人資料之蒐集與利用（個資使用同意書）" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <Button type="submit" fullWidth loading={submitting}>完成啟用並登入</Button>
        <button type="button" className="text-center text-sm text-slate-500 hover:text-slate-900" onClick={() => { setActivation(null); setPassword('') }}>返回登入</button>
      </form>
    )
  }

  return (
    <>
      <form onSubmit={handleLogin} noValidate className="flex flex-col gap-5">
        <div>
          <h2 className="text-base font-semibold text-slate-900">登入</h2>
          <p className="mt-1 text-xs text-slate-500">請選擇所屬銀行／機構並輸入帳號密碼；待啟用帳號請於密碼欄輸入啟用碼。</p>
        </div>

        {formError && <div role="alert" className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-600"><p>{formError}</p></div>}

        <SelectField
          label="銀行／機構"
          placeholder="請選擇銀行／機構"
          value={bankCode}
          onChange={(e) => setBankCode(e.target.value)}
          options={banks.map((b) => ({ value: b.bankCode, label: b.bankCode === 'PLATFORM' ? b.bankName : `${b.bankName}（${b.bankCode}）` }))}
        />
        <TextField label="Email" type="text" autoComplete="username" placeholder="請輸入 Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <PasswordField label="密碼／啟用碼" autoComplete="current-password" placeholder="請輸入密碼，或首次登入的啟用碼" value={password} onChange={(e) => setPassword(e.target.value)} />

        <Checkbox label="記住我的銀行／機構與帳號（不會保存密碼）" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
        <Button type="submit" fullWidth loading={submitting}>登入</Button>

        <div className="flex items-center justify-end text-sm">
          <div className="flex items-center gap-4">
            <Link to="/forgot-password" className="text-slate-500 hover:text-slate-900">忘記密碼</Link>
            <button type="button" onClick={() => setHelpOpen(true)} className="text-slate-500 hover:text-slate-900">帳號協助</button>
          </div>
        </div>
      </form>
      <AccountHelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </>
  )
}
