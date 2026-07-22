import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { apiFetch } from '@/services/api'
import { useToast } from '@/hooks/useToast'
import { Button } from '@/components/Button'
import { TextField } from '@/components/TextField'
import { PasswordField } from '@/components/PasswordField'
import { ROLE_LABELS, formatBankLabel } from '@/utils/labels'
import type { BankCode, Role } from '@/types'

interface InviteInfo { email: string; bankCode: string; bankName: string; role: Role; purpose: 'NEW_ACCOUNT' | 'PASSWORD_RESET' }

/**
 * 邀請碼流程（一次性、效期 3 天）：
 * - 用途 NEW_ACCOUNT：設定姓名與密碼完成註冊
 * - 用途 PASSWORD_RESET：僅設定新密碼（既有帳號）
 * 支援網址 ?code= 自動帶入。
 */
export function RegisterPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const [params] = useSearchParams()

  const [code, setCode] = useState('')
  const [info, setInfo] = useState<InviteInfo | null>(null)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)

  const isReset = info?.purpose === 'PASSWORD_RESET'

  const validate = async (raw: string) => {
    setError(undefined)
    setBusy(true)
    try {
      const r = await apiFetch<InviteInfo>('/api/invitations/validate', { method: 'POST', body: JSON.stringify({ code: raw }) })
      setInfo(r)
    } catch (e) {
      setInfo(null)
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    const c = params.get('code')
    if (c) { setCode(c); validate(c) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submitCode = (e: FormEvent) => {
    e.preventDefault()
    if (code.trim()) validate(code.trim())
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(undefined)
    if (!isReset && !name.trim()) return setError('請輸入姓名')
    if (password.length < 8) return setError('密碼至少 8 碼')
    setBusy(true)
    try {
      if (isReset) {
        await apiFetch('/api/invitations/reset-password', { method: 'POST', body: JSON.stringify({ code: code.trim(), password }) })
        toast.success('密碼已重設，請用新密碼登入')
      } else {
        await apiFetch('/api/invitations/accept', { method: 'POST', body: JSON.stringify({ code: code.trim(), name, password }) })
        toast.success('註冊完成，請登入')
      }
      navigate('/login', { replace: true })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-base font-semibold text-slate-900">{isReset ? '重設密碼' : '邀請制註冊'}</h2>
        <p className="mt-1 text-xs text-slate-500">
          {info ? (isReset ? '請設定您的新密碼。' : '請設定姓名與密碼完成註冊。') : '請輸入平台管理員提供的邀請碼（效期 3 天）。'}
        </p>
      </div>

      {error && <div role="alert" className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-600">{error}</div>}

      {!info ? (
        <form onSubmit={submitCode} className="flex flex-col gap-4">
          <TextField label="邀請碼" value={code} onChange={(e) => setCode(e.target.value)} placeholder="貼上邀請碼或開啟邀請連結" />
          <Button type="submit" fullWidth loading={busy}>驗證邀請碼</Button>
        </form>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="rounded-xl border border-surface-border bg-surface-muted/40 p-3 text-sm text-slate-700">
            <p>Email：<span className="text-slate-900">{info.email}</span></p>
            <p>銀行／機構：<span className="text-slate-900">{formatBankLabel(info.bankCode as BankCode)}</span></p>
            <p>角色：<span className="text-slate-900">{ROLE_LABELS[info.role] ?? info.role}</span></p>
          </div>
          {!isReset && <TextField label="姓名" value={name} onChange={(e) => setName(e.target.value)} placeholder="請輸入您的姓名" />}
          <PasswordField label={isReset ? '新密碼（至少 8 碼）' : '設定密碼（至少 8 碼）'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          <Button type="submit" fullWidth loading={busy}>{isReset ? '重設密碼' : '完成註冊'}</Button>
        </form>
      )}

      <div className="text-sm"><Link to="/login" className="text-brand-700 hover:text-brand-500">返回登入</Link></div>
    </div>
  )
}
