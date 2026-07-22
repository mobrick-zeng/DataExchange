import { useCallback, useEffect, useState } from 'react'
import { useToast } from '@/hooks/useToast'
import { apiFetch } from '@/services/api'
import { Button } from '@/components/Button'

interface Bank { bankCode: string; bankName: string; type: string; isActive: boolean }
interface Court { courtCode: string; courtName: string; courtType: string | null; isActive: boolean }

/** 機構啟用管理：切換銀行／法院是否可用（可用者才會出現在登入下拉、建案選單） */
export function AdminInstitutionsPage() {
  const toast = useToast()
  const [banks, setBanks] = useState<Bank[]>([])
  const [courts, setCourts] = useState<Court[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'banks' | 'courts'>('banks')

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([apiFetch<{ banks: Bank[] }>('/api/banks'), apiFetch<{ courts: Court[] }>('/api/courts')])
      .then(([b, c]) => { setBanks(b.banks); setCourts(c.courts) })
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(load, [load])

  const toggleBank = (b: Bank) =>
    apiFetch(`/api/banks/${b.bankCode}`, { method: 'PATCH', body: JSON.stringify({ isActive: !b.isActive }) })
      .then(() => { toast.success(`${b.bankName} 已${b.isActive ? '停用' : '啟用'}`); load() })
      .catch((e) => toast.error((e as Error).message))
  const toggleCourt = (c: Court) =>
    apiFetch(`/api/courts/${c.courtCode}`, { method: 'PATCH', body: JSON.stringify({ isActive: !c.isActive }) })
      .then(() => { toast.success(`${c.courtName} 已${c.isActive ? '停用' : '啟用'}`); load() })
      .catch((e) => toast.error((e as Error).message))

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6">
      <h1 className="text-xl font-semibold text-slate-900">機構啟用管理</h1>
      <p className="text-sm text-slate-500">僅「啟用」的機構會出現在登入下拉與建立案件的選單中。完整代碼清單已預先建檔，於此切換可用範圍。</p>

      <div className="flex gap-2 text-sm">
        <button onClick={() => setTab('banks')} className={`rounded-lg px-3 py-1.5 ${tab === 'banks' ? 'bg-brand-600/15 text-brand-700' : 'text-slate-500'}`}>金融機構（{banks.filter((b) => b.isActive).length}/{banks.length} 啟用）</button>
        <button onClick={() => setTab('courts')} className={`rounded-lg px-3 py-1.5 ${tab === 'courts' ? 'bg-brand-600/15 text-brand-700' : 'text-slate-500'}`}>法院（{courts.filter((c) => c.isActive).length}/{courts.length} 啟用）</button>
      </div>

      {loading ? <p className="text-sm text-slate-500">載入中…</p> : (
        <div className="overflow-x-auto rounded-2xl border border-surface-border bg-surface-raised shadow-card">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-surface-border text-left text-xs text-slate-500">
                <th className="p-3">代碼</th><th className="p-3">名稱</th><th className="p-3">狀態</th><th className="p-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {tab === 'banks' ? banks.map((b) => (
                <tr key={b.bankCode} className="border-b border-surface-border last:border-0">
                  <td className="p-3 font-mono text-slate-700">{b.bankCode}</td>
                  <td className="p-3 text-slate-900">{b.bankName}{b.type === 'PLATFORM' && <span className="ml-2 text-xs text-slate-500">平台</span>}</td>
                  <td className="p-3">{b.isActive ? <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-700">啟用</span> : <span className="rounded-full bg-neutral-500/15 px-2 py-0.5 text-xs text-neutral-600">停用</span>}</td>
                  <td className="p-3 text-right">{b.type !== 'PLATFORM' && <Button size="sm" variant={b.isActive ? 'danger' : 'primary'} onClick={() => toggleBank(b)}>{b.isActive ? '停用' : '啟用'}</Button>}</td>
                </tr>
              )) : courts.map((c) => (
                <tr key={c.courtCode} className="border-b border-surface-border last:border-0">
                  <td className="p-3 font-mono text-slate-700">{c.courtCode}</td>
                  <td className="p-3 text-slate-900">{c.courtName}</td>
                  <td className="p-3">{c.isActive ? <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-700">啟用</span> : <span className="rounded-full bg-neutral-500/15 px-2 py-0.5 text-xs text-neutral-600">停用</span>}</td>
                  <td className="p-3 text-right"><Button size="sm" variant={c.isActive ? 'danger' : 'primary'} onClick={() => toggleCourt(c)}>{c.isActive ? '停用' : '啟用'}</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
