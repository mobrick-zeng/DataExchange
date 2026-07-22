import type { InputHTMLAttributes } from 'react'
import { useId, useState } from 'react'

interface PasswordFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string
  error?: string
  hint?: string
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.8} stroke="currentColor" className="h-5 w-5">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 12s3.75-7.5 9.75-7.5 9.75 7.5 9.75 7.5-3.75 7.5-9.75 7.5S2.25 12 2.25 12Z"
      />
      <circle cx="12" cy="12" r="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.8} stroke="currentColor" className="h-5 w-5">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.24 4.24M6.53 6.53C4.36 8 2.7 10 2.25 12c0 0 3.75 7.5 9.75 7.5 2.02 0 3.76-.5 5.22-1.28M9.88 4.7A10.6 10.6 0 0 1 12 4.5c6 0 9.75 7.5 9.75 7.5-.4.8-1 1.77-1.8 2.72"
      />
    </svg>
  )
}

export function PasswordField({ label, error, hint, id, className = '', ...rest }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false)
  const autoId = useId()
  const fieldId = id ?? autoId

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={fieldId} className="text-sm font-medium text-slate-700">
        {label}
      </label>
      <div className="relative">
        <input
          id={fieldId}
          type={visible ? 'text' : 'password'}
          className={`w-full rounded-xl border bg-surface-muted px-3.5 py-2.5 pr-11 text-sm text-slate-900 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500/60 ${
            error ? 'border-rose-500/70' : 'border-surface-border'
          } ${className}`}
          aria-invalid={!!error}
          aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
          {...rest}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-500 hover:text-slate-900"
          aria-label={visible ? '隱藏密碼' : '顯示密碼'}
          title={visible ? '隱藏密碼' : '顯示密碼'}
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
      {error ? (
        <p id={`${fieldId}-error`} className="text-xs text-rose-400">
          {error}
        </p>
      ) : hint ? (
        <p id={`${fieldId}-hint`} className="text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
