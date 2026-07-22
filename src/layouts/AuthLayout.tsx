import type { ReactNode } from 'react'

interface AuthLayoutProps {
  children: ReactNode
  maxWidthClassName?: string
}

/** 未登入頁面共用版型：置中卡片式版面，適用登入／註冊／OTP驗證／忘記密碼等頁面 */
export function AuthLayout({ children, maxWidthClassName = 'max-w-md' }: AuthLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-4 py-10">
      <div className={`w-full ${maxWidthClassName}`}>
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600/20 ring-1 ring-inset ring-brand-500/40">
            <svg viewBox="0 0 32 32" className="h-7 w-7" fill="none" aria-hidden="true">
              <path
                d="M8 20L16 8L24 20"
                stroke="#60a5fa"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="16" cy="23" r="2" fill="#60a5fa" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-900">集中式金融資料交換平台</h1>
            <p className="text-sm text-slate-500">前置調解債權申報系統</p>
          </div>
        </div>

        <div className="rounded-2xl border border-surface-border bg-surface-raised p-6 shadow-card sm:p-8">
          {children}
        </div>

        <p className="mt-6 text-center text-xs text-slate-600">
          Demo／POC 版本，使用測試與去識別化資料，非正式銀行等級安全系統
        </p>
      </div>
    </div>
  )
}
