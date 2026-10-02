/**
 * 示範案件管理 —— 清理測試殘留、補足案件數至目標值。
 *
 * 為什麼走 HTTP API 而非直接改資料庫
 * ----------------------------------
 * 這套系統的價值建立在「每個寫入都留痕」與「狀態轉換受不變量約束」上。
 * 直接下 SQL 會同時失去兩者：沒有稽核紀錄、也不會檢查揭露條件、一類一筆、
 * 金額防呆等規則。本腳本走與真人完全相同的路徑，因此產生的資料與真實操作
 * 無法區分——這正是示範環境該有的性質。
 *
 * 用法
 * ----
 *   BASE_URL=https://... npx tsx scripts/demo-cases.ts --status
 *   BASE_URL=https://... npx tsx scripts/demo-cases.ts --cleanup            # 預設僅列出
 *   BASE_URL=https://... npx tsx scripts/demo-cases.ts --cleanup --yes      # 實際刪除
 *   BASE_URL=https://... npx tsx scripts/demo-cases.ts --fill 30            # 補到 30 件
 *   BASE_URL=https://... npx tsx scripts/demo-cases.ts --fill 30 --yes
 *
 * ⚠️ 破壞性操作（--cleanup --yes）預設關閉，且只會刪除同時滿足三個條件的草稿：
 *    狀態為 DRAFT、僅有主辦自己一個參與行、零債權明細。
 *    有實質內容的案件（即使文號看起來像測試）一律不碰。
 */

const BASE_URL = (process.env.BASE_URL ?? 'http://localhost:4000').replace(/\/$/, '')
const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo@1234'

const ACTORS = {
  fubon: { bankCode: '012', email: 'fubon.main@bank.local' },
  esun: { bankCode: '808', email: 'esun.co@bank.local' },
  taishin: { bankCode: '812', email: 'taishin.co@bank.local' },
  // 稽核：唯讀但可見全平台。盤點與清理判定一律用它——
  // 以銀行帳號查詢會被可視範圍收窄（INV VIS-07），看不到自己沒參與的案件，
  // 導致統計少算、也找不到他行的殘留草稿。
  auditor: { bankCode: 'PLATFORM', email: 'auditor@platform-demo.local' },
} as const
type ActorKey = keyof typeof ACTORS
/** 可擔任主辦的銀行（稽核不能建案） */
const BANK_ACTORS = ['fubon', 'esun', 'taishin'] as const satisfies readonly ActorKey[]

// ---------------------------------------------------------------- HTTP

const tokens = new Map<ActorKey, string>()

async function send(method: string, path: string, body?: unknown, token?: string) {
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  // 流量限制退避：示範資料的建立會連續打上百次請求，而正式環境的上限刻意不調高
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (res.status !== 429 || attempt === 3) {
      const text = await res.text()
      let parsed: any = text
      try { parsed = JSON.parse(text) } catch { /* 非 JSON 就原樣回傳 */ }
      return { status: res.status, body: parsed }
    }
    const wait = Math.min(Number(res.headers.get('retry-after') ?? 60), 65) + 1
    console.log(`  [流量限制] 等待 ${wait}s 後重試：${method} ${path}`)
    await new Promise((r) => setTimeout(r, wait * 1000))
  }
  throw new Error('unreachable')
}

async function login(actor: ActorKey): Promise<string> {
  const cached = tokens.get(actor)
  if (cached) return cached
  const a = ACTORS[actor]
  const { status, body } = await send('POST', '/api/auth/login', {
    bankCode: a.bankCode, email: a.email, password: PASSWORD,
  })
  if (status !== 200 || !body?.token) throw new Error(`以 ${actor} 登入失敗：${status} ${JSON.stringify(body)}`)
  tokens.set(actor, body.token)
  return body.token
}

async function call(actor: ActorKey, method: string, path: string, body?: unknown, expect = 200) {
  const token = await login(actor)
  const res = await send(method, path, body, token)
  if (res.status !== expect) {
    throw new Error(`${method} ${path} 預期 ${expect}，實際 ${res.status}：${JSON.stringify(res.body)}`)
  }
  return res.body
}

// ---------------------------------------------------------------- 示範資料

/**
 * 取得目標環境**實際已啟用**的法院。
 *
 * 不可寫死：各環境的啟用狀態不同（staging 已開 22 所、本機 seed 預設只有 2 所），
 * 寫死會在法院未啟用的環境噴「法院不存在或未啟用」。
 */
async function activeCourts(): Promise<string[]> {
  const { courts } = await call('auditor', 'GET', '/api/courts?activeOnly=1')
  const codes = courts.map((c: any) => c.courtCode)
  if (codes.length === 0) throw new Error('目標環境沒有任何已啟用的法院')
  if (codes.length < 3) {
    console.log(`  ⚠️ 僅 ${codes.length} 所法院已啟用，案件會集中於少數法院，「法院」篩選的示範效果有限`)
  }
  return codes
}

/** 債權種類與各自的典型金額級距（元）。不含個資，金額為模擬值。 */
const CLAIM_PROFILES = [
  { claimType: 'CREDIT_CARD', base: 180_000 },
  { claimType: 'CASH_CARD', base: 90_000 },
  { claimType: 'CREDIT_LOAN', base: 650_000 },
  { claimType: 'GUARANTEE', base: 1_200_000 },
  { claimType: 'INHERITANCE', base: 420_000 },
] as const

/**
 * 產生一家銀行的債權明細。
 * 遵守：一類一筆、對內不得大於對外、違約金不得大於本息、金額 ≤ 9 位數。
 */
function makeItems(seed: number, count: number) {
  const picked = CLAIM_PROFILES.slice(0, Math.max(1, Math.min(count, CLAIM_PROFILES.length)))
  return picked.map((p, i) => {
    const principal = p.base + ((seed * 7919 + i * 131) % 50_000)
    const interest = Math.round(principal * 0.08)
    const penalty = Math.round(principal * 0.02)          // ≤ 本金＋利息
    const otherFee = 1_500 + ((seed + i) % 500)
    return {
      claimType: p.claimType,
      principal,
      interest,
      penalty,
      otherFee,
      // 對內債權：僅該行與稽核可見，不計入彙整表。刻意小於對外。
      internalPrincipal: Math.round(principal * 0.15),
      internalInterest: Math.round(interest * 0.1),
    }
  })
}

const pad3 = (n: number) => String(n).padStart(3, '0')
const DOC_PREFIX = '115年度司消債調字第'
const DOC_SUFFIX = '號'

/**
 * 由既有文號續號，使腳本可重複執行而不撞上唯一鍵
 * （法院＋文號唯一，且結案後亦不得以同文號新建）。
 */
function nextSeq(existing: any[]): number {
  const used = existing
    .map((c) => c.docNumber as string)
    .filter((d) => d.startsWith(DOC_PREFIX) && d.endsWith(DOC_SUFFIX))
    .map((d) => Number(d.slice(DOC_PREFIX.length, -DOC_SUFFIX.length)))
    .filter((n) => Number.isFinite(n))
  return used.length === 0 ? 500 : Math.max(...used) + 1
}

/** 目標狀態分佈——讓 Dashboard 的佇列、期限卡、列表頁簽與篩選都有東西可看 */
type TargetStatus = 'DRAFT' | 'PENDING_CONFIRMATION' | 'PENDING_OUTCOME' | 'ESTABLISHED' | 'NOT_ESTABLISHED'
const DESIRED: Record<TargetStatus, number> = {
  DRAFT: 4,
  PENDING_CONFIRMATION: 12,
  PENDING_OUTCOME: 6,
  ESTABLISHED: 5,
  NOT_ESTABLISHED: 3,
}

function daysFromNow(n: number) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

function daysAgo(n: number) {
  return daysFromNow(-n)
}

// ---------------------------------------------------------------- 流程

interface Plan {
  index: number
  court: string
  docNumber: string
  main: ActorKey
  cobanks: ActorKey[]
  target: TargetStatus
  /** 距今幾天的調解庭期；null 表示不設 */
  mediationInDays: number | null
  /** 是否在揭露後標記疑義（使輪次 +1，供稽核的「疑義熱點」有資料） */
  raiseDoubt: boolean
}

/** 依 plan 一路推進到目標狀態；每一步都是真人會走的路徑 */
async function buildCase(p: Plan) {
  const body: Record<string, unknown> = {
    courtCode: p.court,
    docNumber: p.docNumber,
    receiptDate: daysAgo(10 + (p.index % 20)),
  }
  if (p.mediationInDays !== null) {
    body.mediationDate = daysFromNow(p.mediationInDays)
    body.mediationTime = ['09:30', '10:00', '14:00', '14:30', '15:30'][p.index % 5]
    body.mediationPlace = `第 ${(p.index % 4) + 1} 調解室`
    body.interestCutoffDate = daysFromNow(p.mediationInDays + 5)
  }
  const { caseId } = await call(p.main, 'POST', '/api/cases', body)

  for (const co of p.cobanks) {
    await call(p.main, 'POST', `/api/cases/${caseId}/participants`, { bankCode: ACTORS[co].bankCode })
  }
  if (p.target === 'DRAFT') return { caseId, stopped: 'DRAFT' }

  await call(p.main, 'POST', `/api/cases/${caseId}/publish`)

  // 各行自填自己的明細（主辦也必須自填，非代填）
  await call(p.main, 'PUT', `/api/cases/${caseId}/my-items`, { items: makeItems(p.index, 3) })
  for (const [i, co] of p.cobanks.entries()) {
    await call(co, 'PUT', `/api/cases/${caseId}/my-items`, { items: makeItems(p.index + i + 1, 2) })
  }

  if (p.target === 'PENDING_CONFIRMATION') {
    // 刻意讓部分參與行先確認，使「待我確認」與「待各行確認」兩種佇列都有資料
    if (p.index % 3 === 0 && p.cobanks.length > 0) {
      await call(p.cobanks[0], 'POST', `/api/cases/${caseId}/confirm`)
    }
    return { caseId, stopped: 'PENDING_CONFIRMATION' }
  }

  // 全員確認 → 最後一家確認時自動揭露
  for (const co of p.cobanks) await call(co, 'POST', `/api/cases/${caseId}/confirm`)
  await call(p.main, 'POST', `/api/cases/${caseId}/confirm`)

  if (p.raiseDoubt && p.cobanks.length > 0) {
    // 退回重新確認（輪次 +1），再全員確認一次重新揭露
    await call(p.cobanks[0], 'POST', `/api/cases/${caseId}/doubt`, { reason: '本行帳載金額與彙整表不符，請重新核對' })
    for (const co of p.cobanks) await call(co, 'POST', `/api/cases/${caseId}/confirm`)
    await call(p.main, 'POST', `/api/cases/${caseId}/confirm`)
  }

  if (p.target === 'PENDING_OUTCOME') return { caseId, stopped: 'PENDING_OUTCOME' }

  const established = p.target === 'ESTABLISHED'
  await call(p.main, 'POST', `/api/cases/${caseId}/report`, {
    established,
    confirm: true,
    ...(established ? {} : { reason: '債務人未出席調解，協商未能達成共識' }),
  })
  return { caseId, stopped: p.target }
}

// ---------------------------------------------------------------- 指令

/** 以稽核身分取得全平台案件——銀行身分會被可視範圍收窄 */
async function fetchAll() {
  return (await call('auditor', 'POST', '/api/cases/query', { tab: 'all', size: 100 })).cases as any[]
}

async function cmdStatus() {
  const cases = await fetchAll()
  const byStatus: Record<string, number> = {}
  const byBank: Record<string, number> = {}
  for (const c of cases) {
    byStatus[c.status] = (byStatus[c.status] ?? 0) + 1
    byBank[c.mainBankCode] = (byBank[c.mainBankCode] ?? 0) + 1
  }
  console.log(`\n案件總數：${cases.length}`)
  console.log('依狀態：', byStatus)
  console.log('依主辦：', byBank)
  console.log('法院數：', new Set(cases.map((c) => c.courtCode)).size)
}

/**
 * 測試殘留 = 草稿 ＋ 僅有主辦一個參與行 ＋ 零債權明細。
 * 三個條件同時成立才算；有實質內容者一律保留。
 */
async function cmdCleanup(apply: boolean) {
  const cases = await fetchAll()
  const candidates: any[] = []
  for (const c of cases) {
    if (c.status !== 'DRAFT') continue
    if (c.participantCount > 1) continue
    // 逐案取詳情確認明細為空（列表不含明細）
    const owner = BANK_ACTORS.find((k) => ACTORS[k].bankCode === c.mainBankCode)
    if (!owner) {
      console.log(`  （略過 ${c.docNumber}：主辦 ${c.mainBankCode} 無可用帳號）`)
      continue
    }
    // 以稽核讀取明細（全見），避免主辦帳號的可視範圍影響判定
    const d = await call('auditor', 'GET', `/api/cases/${c.caseId}`)
    const items = d.participants.reduce((n: number, p: any) => n + (p.items?.length ?? 0), 0)
    if (items === 0) candidates.push({ ...c, owner })
  }

  console.log(`\n符合「測試殘留」判準的草稿：${candidates.length} 件`)
  for (const c of candidates) console.log(`  ${c.courtCode}  ${c.docNumber}  (主辦 ${c.mainBankCode})`)
  if (!apply) {
    console.log('\n（僅列出，未刪除。確認無誤後加上 --yes 實際執行）')
    return
  }
  for (const c of candidates) {
    await call(c.owner, 'DELETE', `/api/cases/${c.caseId}`)
    console.log(`  已刪除：${c.docNumber}`)
  }
}

async function cmdFill(target: number, apply: boolean) {
  const cases = await fetchAll()
  const byStatus: Record<string, number> = {}
  for (const c of cases) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1

  const courts = await activeCourts()
  const need: Plan[] = []
  const seq = nextSeq(cases)
  let idx = 0
  for (const [status, want] of Object.entries(DESIRED) as [TargetStatus, number][]) {
    const have = byStatus[status] ?? 0
    for (let i = 0; i < Math.max(0, want - have); i++) {
      if (cases.length + need.length >= target) break
      const mains: ActorKey[] = [...BANK_ACTORS]
      const main = mains[idx % 3]
      const others = mains.filter((m) => m !== main)
      need.push({
        index: idx,
        court: courts[idx % courts.length],
        docNumber: `${DOC_PREFIX}${pad3(seq + idx)}${DOC_SUFFIX}`,
        main,
        cobanks: idx % 4 === 0 ? others : [others[idx % 2]],
        target: status,
        // 前幾件給近期庭期，讓「期限將至」有資料
        mediationInDays: idx < 4 ? [2, 5, 9, 13][idx] : (idx % 3 === 0 ? 20 + idx : null),
        raiseDoubt: status !== 'DRAFT' && status !== 'PENDING_CONFIRMATION' && idx % 5 === 0,
      })
      idx++
    }
  }

  console.log(`\n目前 ${cases.length} 件，目標 ${target} 件 → 需新增 ${need.length} 件`)
  const summary: Record<string, number> = {}
  for (const p of need) summary[p.target] = (summary[p.target] ?? 0) + 1
  console.log('新增的狀態分佈：', summary)
  console.log('涵蓋法院：', [...new Set(need.map((p) => p.court))].join(', '), `（環境共 ${courts.length} 所已啟用）`)
  console.log('文號區間：', need.length ? `${need[0].docNumber} … ${need[need.length - 1].docNumber}` : '—')
  console.log('含疑義退回（輪次 2）：', need.filter((p) => p.raiseDoubt).length, '件')
  if (!apply) {
    console.log('\n（僅規劃，未建立。確認無誤後加上 --yes 實際執行）')
    return
  }
  for (const p of need) {
    const r = await buildCase(p)
    console.log(`  ✓ ${p.court} ${p.docNumber} → ${r.stopped}（主辦 ${ACTORS[p.main].bankCode}）`)
  }
  await cmdStatus()
}

// ---------------------------------------------------------------- 進入點

async function main() {
  const args = process.argv.slice(2)
  const apply = args.includes('--yes')
  console.log(`目標環境：${BASE_URL}`)

  if (args.includes('--status')) return cmdStatus()
  if (args.includes('--cleanup')) return cmdCleanup(apply)
  const fillIdx = args.indexOf('--fill')
  if (fillIdx >= 0) return cmdFill(Number(args[fillIdx + 1] ?? 30), apply)

  console.log(`
用法：
  --status                   顯示目前案件統計
  --cleanup [--yes]          清理測試殘留草稿（預設僅列出）
  --fill <N> [--yes]         補足案件數至 N（預設僅規劃）
`)
}

main().catch((e) => {
  console.error('\n✗', e.message)
  process.exit(1)
})
