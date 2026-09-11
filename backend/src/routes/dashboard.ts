import type { FastifyInstance } from 'fastify'
import { prisma } from '../prisma.js'

const OPEN_STATUSES = ['DRAFT', 'PENDING_CONFIRMATION', 'PENDING_OUTCOME'] as const

/** 行動佇列的類型；陣列順序即顯示優先序（愈前面愈需要先處理） */
const QUEUE_KINDS = ['DECLARE', 'CONFIRM', 'REPORT', 'PUBLISH', 'REVIEW'] as const
type QueueKind = (typeof QUEUE_KINDS)[number]

/** 平台治理類（供管理員「最近治理事件」用；刻意不含案件流程動作，維持平台全盲） */
const GOVERNANCE_ACTIONS = [
  'ACCOUNT_CREATED', 'ACCOUNT_ACTIVATED', 'ACCOUNT_SUSPENDED', 'ACCOUNT_REACTIVATED',
  'ACCOUNT_LOCKED', 'ACCOUNT_UNLOCKED', 'PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET_ISSUED',
  'BANK_ACTIVATED', 'BANK_DEACTIVATED', 'COURT_ACTIVATED', 'COURT_DEACTIVATED',
] as const

const DEADLINE_WINDOW_DAYS = 14
const QUEUE_PREVIEW = 6
const LIST_PREVIEW = 6

async function casesByStatus(where: object): Promise<Record<string, number>> {
  const rows = await prisma.case.groupBy({ by: ['status'], where, _count: { _all: true } })
  const out: Record<string, number> = {}
  for (const r of rows) out[r.status] = r._count._all
  return out
}

/** 純日期以 YYYY-MM-DD 輸出（序列化契約，與 cases.ts 的 dateOut 一致）。
 *  原樣輸出 DateTime 會變成 UTC 午夜時間戳，在 UTC 以西的時區會被解讀成前一天。 */
const dateOut = (d: Date | null | undefined): string | null =>
  d == null ? null : d.toISOString().slice(0, 10)

/** 今日 00:00（伺服器時區）；期限倒數以「天」為單位，故一律歸零到日界 */
function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000)
}

/** 由 targetId 反查案件文號，供稽核／治理事件流顯示（找不到則略過文號） */
async function docNumbersOf(ids: (string | null | undefined)[]): Promise<Record<string, string>> {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))]
  if (uniq.length === 0) return {}
  const rows = await prisma.case.findMany({ where: { caseId: { in: uniq } }, select: { caseId: true, docNumber: true } })
  return Object.fromEntries(rows.map((r) => [r.caseId, r.docNumber]))
}

export async function dashboardRoutes(app: FastifyInstance) {
  // GET /api/dashboard/summary — 依角色回傳個人化待辦、期限、統計與動態
  // 刻意不做輪詢：前端僅於進頁與使用者手動重新整理時取用（F5 語意）
  app.get('/summary', { preHandler: [app.authenticate] }, async (req) => {
    const { userId, role, bankCode } = req.user

    const unreadNotifications = await prisma.notification.count({ where: { userId, isRead: false } })
    const summary: Record<string, unknown> = { role, bankCode, unreadNotifications, generatedAt: new Date().toISOString() }

    // ---------- 銀行人員 ----------
    if (role === 'BANK_STAFF' && bankCode) {
      // 一次撈出「本行仍在進行中的所有參與關係」，行動佇列、期限與 KPI 皆由此推導，避免多次往返
      const parts = await prisma.caseParticipantBank.findMany({
        where: { bankCode, removedAt: null, case: { status: { in: [...OPEN_STATUSES] } } },
        include: {
          case: {
            select: {
              caseId: true, docNumber: true, status: true, round: true, mainBankCode: true,
              mediationDate: true, mediationTime: true, interestCutoffDate: true, createdAt: true,
              court: { select: { courtName: true } },
              mainBank: { select: { bankName: true } },
            },
          },
          _count: { select: { items: true } },
        },
      })

      // --- 行動佇列：只列「輪到本行動作」的案件 ---
      type QueueRow = {
        caseId: string; docNumber: string; courtName: string
        mainBankCode: string; mainBankName: string; roleInCase: string
        status: string; round: number; kind: QueueKind
        mediationDate: Date | null; mediationTime: string | null
        createdAt: Date
      }
      const queue: QueueRow[] = []
      for (const p of parts) {
        const c = p.case
        let kind: QueueKind | null = null
        if (c.status === 'PENDING_CONFIRMATION' && p.confirmationStatus === 'PENDING') {
          // 尚未填任何明細＝待填報；已有明細但未確認＝待確認
          kind = p._count.items === 0 ? 'DECLARE' : 'CONFIRM'
        } else if (c.status === 'PENDING_OUTCOME') {
          kind = p.roleInCase === 'MAIN' ? 'REPORT' : 'REVIEW'
        } else if (c.status === 'DRAFT' && p.roleInCase === 'MAIN') {
          kind = 'PUBLISH'
        }
        if (!kind) continue
        queue.push({
          caseId: c.caseId, docNumber: c.docNumber, courtName: c.court.courtName,
          mainBankCode: c.mainBankCode, mainBankName: c.mainBank.bankName, roleInCase: p.roleInCase,
          status: c.status, round: c.round, kind,
          mediationDate: c.mediationDate, mediationTime: c.mediationTime, createdAt: c.createdAt,
        })
      }
      // 排序：動作類型優先序 → 庭期近者優先（無庭期排後）→ 建立時間早者優先
      queue.sort((a, b) => {
        const k = QUEUE_KINDS.indexOf(a.kind) - QUEUE_KINDS.indexOf(b.kind)
        if (k !== 0) return k
        const am = a.mediationDate ? a.mediationDate.getTime() : Number.MAX_SAFE_INTEGER
        const bm = b.mediationDate ? b.mediationDate.getTime() : Number.MAX_SAFE_INTEGER
        if (am !== bm) return am - bm
        return a.createdAt.getTime() - b.createdAt.getTime()
      })

      // --- 期限將至：庭期／利息截止日，取未來 14 天內者 ---
      const today = startOfToday()
      const limit = new Date(today.getTime() + DEADLINE_WINDOW_DAYS * 86_400_000)
      const deadlines: {
        caseId: string; docNumber: string; kind: 'MEDIATION' | 'INTEREST_CUTOFF'
        date: Date; time: string | null; daysLeft: number
      }[] = []
      for (const p of parts) {
        const c = p.case
        const push = (kind: 'MEDIATION' | 'INTEREST_CUTOFF', date: Date | null, time: string | null) => {
          if (!date || date < today || date > limit) return
          deadlines.push({ caseId: c.caseId, docNumber: c.docNumber, kind, date, time, daysLeft: daysBetween(today, date) })
        }
        push('MEDIATION', c.mediationDate, c.mediationTime)
        push('INTEREST_CUTOFF', c.interestCutoffDate, null)
      }
      deadlines.sort((a, b) => a.date.getTime() - b.date.getTime())

      // --- 雙軌 KPI ---
      // 「本行待填報」＝本行主辦、尚未結案、且本行自己還沒確認（含草稿階段）
      const selfPending = parts.filter(
        (p) => p.roleInCase === 'MAIN' && p.confirmationStatus === 'PENDING'
          && (p.case.status === 'DRAFT' || p.case.status === 'PENDING_CONFIRMATION'),
      ).length
      const toConfirm = parts.filter(
        (p) => p.roleInCase === 'CO_BANK' && p.confirmationStatus === 'PENDING' && p.case.status === 'PENDING_CONFIRMATION',
      ).length

      const [mainByStatus, coBankByStatus] = await Promise.all([
        casesByStatus({ mainBankCode: bankCode }),
        casesByStatus({ participants: { some: { bankCode, roleInCase: 'CO_BANK', removedAt: null } } }),
      ])

      // --- 最近動態：以本人通知為來源，天然只含與本行相關的案件 ---
      const notes = await prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: LIST_PREVIEW,
        select: { notificationId: true, type: true, message: true, isRead: true, relatedCaseId: true, createdAt: true },
      })
      const docMap = await docNumbersOf(notes.map((n) => n.relatedCaseId))

      // 輸出時才轉字串：排序邏輯仍以 Date 比較，見上方 queue.sort
      summary.actionQueue = queue.slice(0, QUEUE_PREVIEW).map((q) => ({
        ...q, mediationDate: dateOut(q.mediationDate),
      }))
      summary.actionQueueTotal = queue.length
      summary.deadlines = deadlines.slice(0, 5).map((d) => ({ ...d, date: dateOut(d.date) }))
      summary.deadlineWindowDays = DEADLINE_WINDOW_DAYS
      summary.asMain = { selfPending, byStatus: mainByStatus }
      summary.asCoBank = { toConfirm, byStatus: coBankByStatus }
      summary.recent = notes.map((n) => ({ ...n, docNumber: n.relatedCaseId ? docMap[n.relatedCaseId] ?? null : null }))
    }

    // ---------- 平台稽核（全案唯讀） ----------
    if (role === 'PLATFORM_AUDITOR') {
      summary.allCasesByStatus = await casesByStatus({})
      summary.totalCases = await prisma.case.count()

      // 疑義熱點：輪次 ≥ 2 代表曾被退回重新確認，輪次愈高協商僵局愈明顯
      const hot = await prisma.case.findMany({
        where: { round: { gte: 2 } },
        orderBy: [{ round: 'desc' }, { updatedAt: 'desc' }],
        take: 5,
        select: {
          caseId: true, docNumber: true, round: true, status: true,
          mainBank: { select: { bankCode: true, bankName: true } },
          doubts: { orderBy: { createdAt: 'desc' }, take: 1, select: { raisedByBankCode: true, createdAt: true } },
        },
      })
      summary.doubtHotspots = hot.map((c) => ({
        caseId: c.caseId, docNumber: c.docNumber, round: c.round, status: c.status,
        mainBankCode: c.mainBank.bankCode, mainBankName: c.mainBank.bankName,
        lastDoubtBankCode: c.doubts[0]?.raisedByBankCode ?? null,
        lastDoubtAt: c.doubts[0]?.createdAt ?? null,
      }))

      // 本月監督指標
      const monthStart = new Date()
      monthStart.setDate(1)
      monthStart.setHours(0, 0, 0, 0)
      const [disclosedCases, doubtCount, closedCount] = await Promise.all([
        prisma.case.findMany({ where: { disclosedAt: { gte: monthStart } }, select: { createdAt: true, disclosedAt: true } }),
        prisma.caseDoubt.count({ where: { createdAt: { gte: monthStart } } }),
        prisma.case.count({ where: { outcomeReportedAt: { gte: monthStart } } }),
      ])
      // 平均全員確認天數＝建案到揭露的實際歷時（含疑義重跑的輪次）
      const avgDays = disclosedCases.length === 0
        ? null
        : Math.round(
            (disclosedCases.reduce((s, c) => s + (c.disclosedAt!.getTime() - c.createdAt.getTime()), 0)
              / disclosedCases.length / 86_400_000) * 10,
          ) / 10
      summary.monthly = { disclosedCount: disclosedCases.length, doubtCount, closedCount, avgConfirmDays: avgDays, since: monthStart.toISOString() }

      const logs = await prisma.auditLog.findMany({
        where: { targetType: 'CASE' },
        orderBy: { createdAt: 'desc' },
        take: LIST_PREVIEW,
        select: { logId: true, actionType: true, bankCode: true, targetId: true, detail: true, createdAt: true },
      })
      const logDocs = await docNumbersOf(logs.map((l) => l.targetId))
      summary.recentAudit = logs.map((l) => ({ ...l, docNumber: l.targetId ? logDocs[l.targetId] ?? null : null }))
    }

    // ---------- 平台管理員（全盲：僅狀態與治理，無任何金額） ----------
    if (role === 'ADMIN') {
      const [pendingUserActivations, pendingResetRequests, activeBanks, activeCourts, totalCases] = await Promise.all([
        prisma.user.count({ where: { accountStatus: 'PENDING_ACTIVATION' } }),
        prisma.passwordResetRequest.count({ where: { status: 'PENDING' } }),
        prisma.bank.count({ where: { isActive: true } }),
        prisma.court.count({ where: { isActive: true } }),
        prisma.case.count(),
      ])
      summary.pendingUserActivations = pendingUserActivations
      summary.pendingResetRequests = pendingResetRequests
      summary.activeBanks = activeBanks
      summary.activeCourts = activeCourts
      summary.totalCases = totalCases
      summary.allCasesByStatus = await casesByStatus({})

      // 機構起案活躍度（近 30 天，僅件數，不涉金額）
      const since = new Date(Date.now() - 30 * 86_400_000)
      const grouped = await prisma.case.groupBy({
        by: ['mainBankCode'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      })
      grouped.sort((a, b) => b._count._all - a._count._all)
      const top = grouped.slice(0, 5)
      const banks = await prisma.bank.findMany({
        where: { bankCode: { in: top.map((g) => g.mainBankCode) } },
        select: { bankCode: true, bankName: true },
      })
      const bankMap = Object.fromEntries(banks.map((b) => [b.bankCode, b.bankName]))
      summary.bankActivity = top.map((g) => ({
        bankCode: g.mainBankCode, bankName: bankMap[g.mainBankCode] ?? g.mainBankCode, count: g._count._all,
      }))
      summary.bankActivityDays = 30

      summary.recentGovernance = await prisma.auditLog.findMany({
        where: { actionType: { in: [...GOVERNANCE_ACTIONS] } },
        orderBy: { createdAt: 'desc' },
        take: LIST_PREVIEW,
        select: { logId: true, actionType: true, bankCode: true, targetType: true, detail: true, createdAt: true },
      })
    }

    return summary
  })
}
