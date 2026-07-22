import type { InputHTMLAttributes, ReactNode } from 'react'
import { useId } from 'react'

interface CheckboxProps extends InputHTMLAttributes<HTMLInputElement> {
  label: ReactNode
  error?: string
}

export function Checkbox({ label, error, id, className = '', ...rest }: CheckboxProps) {
  const autoId = useId()
  const fieldId = id ?? autoId

  return (
    <div>
      <label htmlFor={fieldId} className="flex cursor-pointer items-start gap-2.5 text-sm text-slate-700">
        <input
          id={fieldId}
          type="checkbox"
          className={`mt-0.5 h-4 w-4 shrink-0 rounded border-surface-border bg-surface-muted text-brand-600 focus:ring-2 focus:ring-brand-500/60 ${className}`}
          {...rest}
        />
        <span>{label}</span>
      </label>
      {error && <p className="mt-1 text-xs text-rose-400">{error}</p>}
    </div>
  )
}
