import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface px-4 text-center">
      <p className="text-5xl">🧭</p>
      <h1 className="text-lg font-semibold text-slate-900">找不到此頁面</h1>
      <p className="text-sm text-slate-500">您要瀏覽的頁面不存在，或已經被移除。</p>
      <Link to="/dashboard" className="text-brand-400 hover:text-brand-300">
        返回 Dashboard
      </Link>
    </div>
  )
}
