import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { BankCode } from '@/types'
import { BANK_CODES } from '@/types'
import { formatBankLabel } from '@/utils/labels'
import { apiLogin } from '@/services/apiAuth'
import { useAuthStore } from '@/stores/authStore'
import { useToast } from '@/hooks/useToast'
import { Button } from '@/components/Button'
import { SelectField } from '@/components/SelectField'
import { TextField } from '@/components/TextField'
import { PasswordField } from '@/components/PasswordField'
import { Checkbox } from '@/components/Checkbox'
import { AccountHelpModal } from '@/components/AccountHelpModal'

const REMEMBER_KEY = 'mediation-platform-demo:remember-login'

interface RememberedLogin {
  bankCode: BankCode
  email: string
}

export function LoginPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const setCurrentUser = useAuthStore((s) => s.setCurrentUser)

  const [bankCode, setBankCode] = useState<BankCode | ''>('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(false)
  const [bankError, setBankError] = useState<string | undefined>()
  const [emailError, setEmailError] = useState<string | undefined>()
  const [passwordError, setPasswordError] = useState<string | undefined>()
  const [formError, setFormError] = useState<string | undefined>()
  const [submitting, setSubmitting] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)

  useEffect(() => {
    const raw = window.localStorage.getItem(REMEMBER_KEY)
    if (!raw) return
    try {
      const remembered = JSON.parse(raw) as RememberedLogin
      setBankCode(remembered.bankCode)
      setEmail(remembered.email)
      setRememberMe(true)
    } catch {
      window.localStorage.removeItem(REMEMBER_KEY)
    }
  }, [])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setBankError(undefined)
    setEmailError(undefined)
    setPasswordError(undefined)
    setFormError(undefined)

    let hasError = false
    if (!bankCode) {
      setBankError('請先選擇登入銀行／機構。')
      hasError = true
    }
    if (!email.trim()) {
      setEmailError('請輸入使用者帳號或 Email')
      hasError = true
    }
    if (!password) {
      setPasswordError('請輸入密碼')
      hasError = true
    }
    if (hasError) return

    setSubmitting(true)
    const result = await apiLogin(bankCode as BankCode, email, password)
    setSubmitting(false)

    switch (result.status) {
      case 'SUCCESS': {
        if (rememberMe) {
          window.localStorage.setItem(REMEMBER_KEY, JSON.stringify({ bankCode, email }))
        } else {
          window.localStorage.removeItem(REMEMBER_KEY)
        }
        setCurrentUser(result.user)
        toast.success(`登入成功，歡迎回來，${result.user.name}`)
        navigate('/dashboard', { replace: true })
        return
      }
      case 'INVALID_CREDENTIALS':
        setFormError('銀行／帳號／密碼不正確，請確認後再試一次。')
        return
      case 'ERROR':
      default:
        setFormError(result.status === 'ERROR' && result.message ? result.message : '無法連線伺服器，請確認後端服務是否啟動後再試一次。')
        return
    }
  }

  return (
    <>
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
        <div>
          <h2 className="text-base font-semibold text-slate-900">登入</h2>
          <p className="mt-1 text-xs text-slate-500">請選擇您所屬的銀行／機構並輸入帳號密碼</p>
        </div>

        {formError && (
          <div
            role="alert"
            className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300"
          >
            <p>{formError}</p>
          </div>
        )}

        <SelectField
          label="銀行／機構"
          placeholder="請選擇銀行／機構"
          value={bankCode}
          onChange={(e) => setBankCode(e.target.value as BankCode)}
          options={BANK_CODES.map((code) => ({ value: code, label: formatBankLabel(code) }))}
          error={bankError}
        />

        <TextField
          label="使用者帳號 / Email"
          type="text"
          autoComplete="username"
          placeholder="請輸入帳號或 Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={emailError}
        />

        <PasswordField
          label="密碼"
          autoComplete="current-password"
          placeholder="請輸入密碼"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={passwordError}
        />

        <Checkbox
          label="記住我的銀行／機構與帳號（不會保存密碼）"
          checked={rememberMe}
          onChange={(e) => setRememberMe(e.target.checked)}
        />

        <Button type="submit" fullWidth loading={submitting}>
          登入
        </Button>

        <div className="flex items-center justify-between text-sm">
          <Link to="/register" className="text-brand-400 hover:text-brand-300">
            前往註冊
          </Link>
          <div className="flex items-center gap-4">
            <Link to="/forgot-password" className="text-slate-500 hover:text-slate-900">
              忘記密碼
            </Link>
            <button type="button" onClick={() => setHelpOpen(true)} className="text-slate-500 hover:text-slate-900">
              帳號協助
            </button>
          </div>
        </div>
      </form>

      <AccountHelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </>
  )
}
