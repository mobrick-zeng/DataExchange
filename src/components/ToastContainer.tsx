import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useToastStore, type ToastItem, type ToastVariant } from '@/stores/toastStore'

const VARIANT_CLASS: Record<ToastVariant, string> = {
  success: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  error: 'border-rose-500/40 bg-rose-500/10 text-rose-200',
  info: 'border-brand-500/40 bg-brand-500/10 text-brand-200',
}

const VARIANT_ICON: Record<ToastVariant, string> = {
  success: '✓',
  error: '⚠',
  info: 'ℹ',
}

function ToastCard({ toast }: { toast: ToastItem }) {
  const dismiss = useToastStore((s) => s.dismiss)

  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(toast.id), 4500)
    return () => window.clearTimeout(timer)
  }, [toast.id, dismiss])

  return (
    <div
      role="status"
      className={`flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm shadow-card backdrop-blur ${VARIANT_CLASS[toast.variant]}`}
    >
      <span aria-hidden="true">{VARIANT_ICON[toast.variant]}</span>
      <span className="flex-1">{toast.message}</span>
      <button
        type="button"
        onClick={() => dismiss(toast.id)}
        className="text-current opacity-60 hover:opacity-100"
        aria-label="關閉提示"
      >
        ✕
      </button>
    </div>
  )
}

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts)

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto w-full max-w-sm">
          <ToastCard toast={t} />
        </div>
      ))}
    </div>,
    document.body,
  )
}
