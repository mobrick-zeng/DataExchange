import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../prisma.js'
import { writeAudit } from '../lib/audit.js'
import { notifyBankUsers } from '../lib/notify.js'

const createCaseSchema = z.object({
  courtCode: z.string().min(1),
  docNumber: z.string().min(1).max(100),
  receiptDate: z.string().optional(),
  mediationDate: z.string().optional(),
  mediationTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: '調解時間格式須為 HH:mm' }).optional(),
  mediationPlace: z.string().max(200).optional(),
  interestCutoffDate: z.string().optional(),
  note: z.string().max(500).optional(),
})

/** 可異動欄位分兩層：識別欄位僅草稿可改；資訊欄位於非終態皆可由主辦補填／更正。 */
const updateCaseSchema = z.object({
  // 識別欄位（影響業務唯一鍵）→ 僅 DRAFT
  courtCode: z.string().min(1).optional(),
  docNumber: z.string().min(1).max(100).optional(),
  // 資訊欄位 → 非終態皆可改；null 代表清空
  receiptDate: z.string().nullish(),
  mediationDate: z.string().nullish(),
  mediationTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: '調解時間格式須為 HH:mm' }).nullish(),
  mediationPlace: z.string().max(200).nullish(),
  interestCutoffDate: z.string().nullish(),
  note: z.string().max(500).nullish(),
})

/**
 * 收文日檢核（玉山建議 14）：不得晚於今日，且須在一年內，避免誤選極端值。
 * 回傳錯誤訊息，通過則回 null。
 */
function checkReceiptDate(v?: string | null): string | null {
  if (!v) return null
  const d = new Date(v)
  if (isNaN(d.getTime())) return '收文日格式不正確'
  const today = new Date(); today.setHours(23, 59, 59, 999)
  if (d > today) return '收文日不得晚於今日'
  const oneYearAgo = new Date(); oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
  if (d < oneYearAgo) return '收文日僅容許一年內，請確認是否誤填'
  return null
}

// 金額上限：最多 9 位數（非無限大），避免誤輸極端值
const MAX_AMOUNT = 999_999_999
const amount = () => z.number().nonnegative().max(MAX_AMOUNT, { message: `金額不得超過 ${MAX_AMOUNT}（9 位數）` }).default(0)

const itemSchema = z
  .object({
    claimType: z.enum(['CREDIT_CARD', 'CASH_CARD', 'CREDIT_LOAN', 'GUARANTEE', 'INHERITANCE', 'OTHER']),
    // 債權種類為「其他」時，需填寫債權內容（如：勞工紓困貸款）
    claimTypeOther: z.string().trim().max(100).optional(),
    principal: amount(),
    interest: amount(),
    penalty: amount(),
    otherFee: amount(),
    // 對內債權（僅本行/稽核可見）
    internalPrincipal: amount(),
    internalInterest: amount(),
    note: z.string().optional(),
  })
  // 防呆：對內不得大於對外
  .refine((it) => it.internalPrincipal <= it.principal, {
    message: '對內本金不得大於對外本金',
    path: ['internalPrincipal'],
  })
  .refine((it) => it.internalInterest <= it.interest, {
    message: '對內利息不得大於對外利息',
    path: ['internalInterest'],
  })
  // 防呆：違約金不得大於本金＋利息
  .refine((it) => it.penalty <= it.principal + it.interest, {
    message: '違約金不得大於本金＋利息',
    path: ['penalty'],
  })
  // 「其他」必須說明債權內容
  .refine((it) => it.claimType !== 'OTHER' || !!it.claimTypeOther, {
    message: '債權種類為「其他」時，請填寫債權內容',
    path: ['claimTypeOther'],
  })

// 一類一筆：同一次申報內，同一債權種類不得重複（同類金額請該行自行合計）
const myItemsSchema = z.object({
  items: z.array(itemSchema).refine(
    (arr) => new Set(arr.map((it) => it.claimType)).size === arr.length,
    { message: '同一債權種類僅能填報一列，請將同類金額合計後填報' },
  ),
})

function d(s?: string): Date | undefined {
  return s ? new Date(s) : undefined
}
const num = (v: Prisma.Decimal | null | undefined) => (v == null ? 0 : Number(v))
const itemExternalTotal = (it: { principal: any; interest: any; penalty: any; otherFee: any }) =>
  num(it.principal) + num(it.interest) + num(it.penalty) + num(it.otherFee)

// ---- 序列化契約（見交付包 docs/serialization.md）----
// 金額一律以「字串」輸出，絕不輸出 JSON 數字。儲存欄位由 Prisma 的 Decimal 天然
// 輸出字串；但「計算出來的」合計欄位若直接回傳，會變成 JS 浮點數——同一個概念的
// 金額因而有兩種 JSON 型別，且把 Decimal 的精度保證丟回浮點數。
// 小數位數不保證（'100000' 與 '100000.0000' 皆合法）；客戶端須以十進位解析，
// 不得對金額做字串比對。
const moneyOut = (n: number): string => String(n)
// 純日期概念（收文日／庭期／利息截止日／通報日）以 YYYY-MM-DD 輸出。
// 若原樣輸出 DateTime，會變成 UTC 午夜的時間戳，在 UTC 以西的時區會被解讀成前一天。
const dateOut = (d: Date | null | undefined): string | null =>
  d == null ? null : d.toISOString().slice(0, 10)

// 已揭露（已產出彙整表）：待回報或已結案
const DISCLOSED: string[] = ['PENDING_OUTCOME', 'ESTABLISHED', 'NOT_ESTABLISHED']
const isDisclosed = (status: string) => DISCLOSED.includes(status)
const isTerminal = (status: string) => status === 'ESTABLISHED' || status === 'NOT_ESTABLISHED'

// ============ 案件列表查詢（篩選／排序／分頁） ============
const CASE_STATUSES = ['DRAFT', 'PENDING_CONFIRMATION', 'PENDING_OUTCOME', 'ESTABLISHED', 'NOT_ESTABLISHED'] as const
const OPEN_STATUSES = ['DRAFT', 'PENDING_CONFIRMATION', 'PENDING_OUTCOME'] as const
const CLOSED_STATUSES = ['ESTABLISHED', 'NOT_ESTABLISHED'] as const
// 排序欄位白名單：絕不把使用者傳入的字串直接交給 orderBy
const SORT_FIELDS = ['updatedAt', 'receiptDate', 'docNumber', 'status', 'mainBankCode'] as const

const caseQuerySchema = z.object({
  tab: z.enum(['open', 'closed', 'all']).default('open'),
  status: z.array(z.enum(CASE_STATUSES)).max(5).optional(),
  court: z.array(z.string().min(1).max(20)).max(30).optional(),
  main: z.string().min(1).max(10).optional(),
  // role／myConf 指「本行在該案」的角色與確認狀態（由 JWT 的 bankCode 推導，不可指定他行）
  role: z.enum(['MAIN', 'CO_BANK']).optional(),
  myConf: z.enum(['PENDING', 'CONFIRMED']).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // 公文文號搜尋。刻意以 POST body 傳遞（不置於 URL），避免寫入反向代理／瀏覽器紀錄
  q: z.string().trim().min(1).max(60).optional(),
  sort: z.enum(SORT_FIELDS).default('updatedAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
  page: z.number().int().min(1).max(10000).default(1),
  size: z.number().int().min(1).max(100).default(50),
})

/** 列表單列的共用映射（GET / 與 POST /query 共用，確保欄位一致） */
function mapCaseRow(
  c: {
    caseId: string; courtCode: string; docNumber: string; mainBankCode: string; status: string
    consolidatedTotal: Prisma.Decimal | null; receiptDate: Date | null; mediationDate: Date | null; updatedAt: Date
    court: { courtName: string }; mainBank: { bankName: string }
    participants: { bankCode: string; roleInCase: string; confirmationStatus: string; removedAt: Date | null }[]
  },
  role: string,
  bankCode: string,
) {
  const active = c.participants.filter((p) => !p.removedAt)
  const mine = active.find((p) => p.bankCode === bankCode)
  return {
    caseId: c.caseId,
    courtCode: c.courtCode,
    courtName: c.court.courtName,
    docNumber: c.docNumber,
    mainBankCode: c.mainBankCode,
    mainBankName: c.mainBank.bankName,
    status: c.status,
    receiptDate: dateOut(c.receiptDate),
    mediationDate: dateOut(c.mediationDate),
    updatedAt: c.updatedAt,
    // 平台管理員不見金額
    consolidatedTotal: role === 'ADMIN' ? null : c.consolidatedTotal,
    participantCount: active.length,
    confirmedCount: active.filter((p) => p.confirmationStatus === 'CONFIRMED').length,
    myRoleInCase: mine?.roleInCase ?? null,
    myConfirmationStatus: mine?.confirmationStatus ?? null,
  }
}

function relationTo(user: { role: string; bankCode: string }, mainBankCode: string, participantBankCodes: string[]) {
  const isAdmin = user.role === 'ADMIN'
  const isAuditor = user.role === 'PLATFORM_AUDITOR'
  const isMain = user.bankCode === mainBankCode
  const isParticipant = participantBankCodes.includes(user.bankCode)
  return { isAdmin, isAuditor, isMain, isParticipant, canAccess: isAdmin || isAuditor || isMain || isParticipant }
}

export async function caseRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)

  // GET /api/cases — 依角色列出可見案件
  app.get('/', async (req) => {
    const { role, bankCode } = req.user
    const isPlatform = role === 'ADMIN' || role === 'PLATFORM_AUDITOR'
    const where = isPlatform
      ? {}
      : { OR: [{ mainBankCode: bankCode }, { participants: { some: { bankCode, removedAt: null } } }] }

    const cases = await prisma.case.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        court: { select: { courtName: true } },
        mainBank: { select: { bankName: true } },
        participants: { select: { bankCode: true, roleInCase: true, confirmationStatus: true, removedAt: true } },
      },
    })

    return {
      cases: cases.map((c) => {
        const active = c.participants.filter((p) => !p.removedAt)
        const mine = active.find((p) => p.bankCode === bankCode)
        const confirmedCount = active.filter((p) => p.confirmationStatus === 'CONFIRMED').length
        return {
          caseId: c.caseId,
          courtCode: c.courtCode,
          courtName: c.court.courtName,
          docNumber: c.docNumber,
          mainBankCode: c.mainBankCode,
          mainBankName: c.mainBank.bankName,
          status: c.status,
          // 平台管理員不見金額：僅回傳進度與狀態
          consolidatedTotal: role === 'ADMIN' ? null : c.consolidatedTotal,
          participantCount: active.length,
          confirmedCount,
          myRoleInCase: mine?.roleInCase ?? null,
          myConfirmationStatus: mine?.confirmationStatus ?? null,
        }
      }),
    }
  })

  // POST /api/cases/query — 列表查詢（篩選／排序／分頁）
  // 以 POST 傳遞條件：搜尋字串等內容不進入 URL，因此不會落入反向代理存取日誌或瀏覽器紀錄。
  app.post('/query', async (req, reply) => {
    const { role, bankCode } = req.user
    const parsed = caseQuerySchema.safeParse(req.body ?? {})
    if (!parsed.success) return reply.code(400).send({ message: '查詢條件不正確', issues: parsed.error.issues })
    const f = parsed.data
    const isPlatform = role === 'ADMIN' || role === 'PLATFORM_AUDITOR'

    // 基礎可視範圍一律由 JWT 決定；以下所有條件只能在此基礎上「收窄」，不得放寬
    const base: Prisma.CaseWhereInput = isPlatform
      ? {}
      : { OR: [{ mainBankCode: bankCode }, { participants: { some: { bankCode, removedAt: null } } }] }
    const and: Prisma.CaseWhereInput[] = [base]

    if (f.tab === 'open') and.push({ status: { in: [...OPEN_STATUSES] } })
    else if (f.tab === 'closed') and.push({ status: { in: [...CLOSED_STATUSES] } })
    if (f.status?.length) and.push({ status: { in: f.status } })
    if (f.court?.length) and.push({ courtCode: { in: f.court } })
    if (f.main) and.push({ mainBankCode: f.main })
    if (!isPlatform && f.role) and.push({ participants: { some: { bankCode, removedAt: null, roleInCase: f.role } } })
    if (!isPlatform && f.myConf) and.push({ participants: { some: { bankCode, removedAt: null, confirmationStatus: f.myConf } } })
    if (f.from) and.push({ receiptDate: { gte: new Date(`${f.from}T00:00:00.000Z`) } })
    if (f.to) and.push({ receiptDate: { lte: new Date(`${f.to}T23:59:59.999Z`) } })
    if (f.q) and.push({ docNumber: { contains: f.q, mode: 'insensitive' } })

    const where: Prisma.CaseWhereInput = { AND: and }
    // 加 caseId 決勝鍵：避免 offset 分頁在資料變動時順序不穩，導致重複或漏列
    const orderBy = [{ [f.sort]: f.order }, { caseId: 'desc' }] as Prisma.CaseOrderByWithRelationInput[]

    const [total, rows] = await Promise.all([
      prisma.case.count({ where }),
      prisma.case.findMany({
        where,
        orderBy,
        skip: (f.page - 1) * f.size,
        take: f.size,
        include: {
          court: { select: { courtName: true } },
          mainBank: { select: { bankName: true } },
          participants: { select: { bankCode: true, roleInCase: true, confirmationStatus: true, removedAt: true } },
        },
      }),
    ])

    return { cases: rows.map((c) => mapCaseRow(c, role, bankCode)), total, page: f.page, size: f.size }
  })

  // POST /api/cases — 建立案件（僅銀行人員；建立者所屬銀行即最大債權行/主辦）
  app.post('/', async (req, reply) => {
    const { role, bankCode, userId } = req.user
    if (role !== 'BANK_STAFF' || bankCode === 'PLATFORM') {
      return reply.code(403).send({ message: '僅銀行人員可建立案件' })
    }
    const parsed = createCaseSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ message: '輸入格式不正確', issues: parsed.error.issues })
    const b = parsed.data

    const badDate = checkReceiptDate(b.receiptDate)
    if (badDate) return reply.code(400).send({ message: badDate })

    const court = await prisma.court.findUnique({ where: { courtCode: b.courtCode } })
    if (!court || !court.isActive) return reply.code(400).send({ message: '法院不存在或未啟用' })

    const dup = await prisma.case.findUnique({ where: { courtCode_docNumber: { courtCode: b.courtCode, docNumber: b.docNumber } } })
    if (dup) return reply.code(409).send({ message: '此法院＋公文文號已建立過案件（結案後亦不得以同文號新建）' })

    const created = await prisma.$transaction(async (tx) => {
      const c = await tx.case.create({
        data: {
          courtCode: b.courtCode,
          docNumber: b.docNumber,
          mainBankCode: bankCode,
          receiptDate: d(b.receiptDate),
          mediationDate: d(b.mediationDate),
          mediationTime: b.mediationTime,
          mediationPlace: b.mediationPlace,
          interestCutoffDate: d(b.interestCutoffDate),
          note: b.note,
          status: 'DRAFT',
          createdBy: userId,
        },
      })
      // 主辦自身為參與行（角色 MAIN）；主辦亦需自填並自我確認
      await tx.caseParticipantBank.create({
        data: { caseId: c.caseId, bankCode, roleInCase: 'MAIN', confirmationStatus: 'PENDING' },
      })
      return c
    })

    await writeAudit({ actionType: 'CASE_CREATED', userId, bankCode, targetType: 'CASE', targetId: created.caseId, req })
    return { caseId: created.caseId }
  })

  // PATCH /api/cases/:caseId — 主辦異動案件（識別欄位僅草稿可改；資訊欄位非終態皆可）
  app.patch('/:caseId', async (req: FastifyRequest<{ Params: { caseId: string } }>, reply) => {
    const { caseId } = req.params
    const { bankCode, userId } = req.user
    const c = await prisma.case.findUnique({ where: { caseId } })
    if (!c) return reply.code(404).send({ message: '找不到案件' })
    if (c.mainBankCode !== bankCode) return reply.code(403).send({ message: '僅主辦（最大債權行）可異動案件' })
    if (isTerminal(c.status)) return reply.code(409).send({ message: '案件已結案（終態），不可異動' })

    const parsed = updateCaseSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      return reply.code(400).send({ message: first?.message ?? '輸入格式不正確', issues: parsed.error.issues })
    }
    const b = parsed.data

    // 識別欄位僅草稿可改
    const identityChange =
      (b.courtCode != null && b.courtCode !== c.courtCode) || (b.docNumber != null && b.docNumber !== c.docNumber)
    if (identityChange && c.status !== 'DRAFT') {
      return reply.code(409).send({ message: '案件已發布，法院與公文文號不可再變更（如需更正請以疑義流程處理）' })
    }
    if (identityChange) {
      const nextCourt = b.courtCode ?? c.courtCode
      const nextDoc = b.docNumber ?? c.docNumber
      const court = await prisma.court.findUnique({ where: { courtCode: nextCourt } })
      if (!court || !court.isActive) return reply.code(400).send({ message: '法院不存在或未啟用' })
      const dup = await prisma.case.findUnique({ where: { courtCode_docNumber: { courtCode: nextCourt, docNumber: nextDoc } } })
      if (dup && dup.caseId !== caseId) return reply.code(409).send({ message: '此法院＋公文文號已建立過案件' })
    }
    if (b.receiptDate !== undefined) {
      const badDate = checkReceiptDate(b.receiptDate)
      if (badDate) return reply.code(400).send({ message: badDate })
    }

    // 只寫入本次確實有帶的欄位；null 代表清空
    const data: Prisma.CaseUpdateInput = {}
    if (identityChange) {
      if (b.courtCode != null) data.court = { connect: { courtCode: b.courtCode } }
      if (b.docNumber != null) data.docNumber = b.docNumber
    }
    if (b.receiptDate !== undefined) data.receiptDate = b.receiptDate ? new Date(b.receiptDate) : null
    if (b.mediationDate !== undefined) data.mediationDate = b.mediationDate ? new Date(b.mediationDate) : null
    if (b.mediationTime !== undefined) data.mediationTime = b.mediationTime ?? null
    if (b.mediationPlace !== undefined) data.mediationPlace = b.mediationPlace ?? null
    if (b.interestCutoffDate !== undefined) data.interestCutoffDate = b.interestCutoffDate ? new Date(b.interestCutoffDate) : null
    if (b.note !== undefined) data.note = b.note ?? null
    if (Object.keys(data).length === 0) return { ok: true, changed: false }

    await prisma.case.update({ where: { caseId }, data })
    await writeAudit({
      actionType: 'CASE_UPDATED', userId, bankCode, targetType: 'CASE', targetId: caseId,
      detail: `更新欄位：${Object.keys(data).join(', ')}`, req,
    })
    return { ok: true, changed: true }
  })

  // DELETE /api/cases/:caseId — 刪除草稿（僅主辦、僅 DRAFT；文號誤植的救援途徑）
  app.delete('/:caseId', async (req: FastifyRequest<{ Params: { caseId: string } }>, reply) => {
    const { caseId } = req.params
    const { bankCode, userId } = req.user
    const c = await prisma.case.findUnique({ where: { caseId } })
    if (!c) return reply.code(404).send({ message: '找不到案件' })
    if (c.mainBankCode !== bankCode) return reply.code(403).send({ message: '僅主辦（最大債權行）可刪除案件' })
    if (c.status !== 'DRAFT') return reply.code(409).send({ message: '僅「草稿」案件可刪除；已發布案件請改以回報不成立結案' })

    // 先寫稽核再刪除（刪除後 targetId 不再存在，故於 detail 保留法院＋文號可追溯）
    await writeAudit({
      actionType: 'CASE_DELETED', userId, bankCode, targetType: 'CASE', targetId: caseId,
      detail: `刪除草稿：${c.courtCode} / ${c.docNumber}`, req,
    })
    await prisma.case.delete({ where: { caseId } }) // participants／items／snapshots 由 onDelete: Cascade 連帶刪除
    return { ok: true }
  })

  // GET /api/cases/:caseId — 案件詳情（套用可視範圍）
  app.get('/:caseId', async (req: FastifyRequest<{ Params: { caseId: string } }>, reply) => {
    const { caseId } = req.params
    const { role, bankCode } = req.user

    const c = await prisma.case.findUnique({
      where: { caseId },
      include: {
        court: { select: { courtName: true } },
        mainBank: { select: { bankName: true } },
        participants: { include: { bank: { select: { bankName: true } }, items: true }, orderBy: { invitedAt: 'asc' } },
        doubts: { orderBy: { createdAt: 'desc' } },
      },
    })
    if (!c) return reply.code(404).send({ message: '找不到案件' })

    const activeBankCodes = c.participants.filter((p) => !p.removedAt).map((p) => p.bankCode)
    const rel = relationTo({ role, bankCode }, c.mainBankCode, activeBankCodes)
    if (!rel.canAccess) return reply.code(403).send({ message: '權限不足' })

    const disclosed = isDisclosed(c.status)
    // 可見數字者：稽核＝全部；參與行＝自己的，揭露後＝全部；平台管理員＝永不見數字
    const canSeeAmounts = !rel.isAdmin
    const seeAllItems = rel.isAuditor || (disclosed && rel.isParticipant)

    const participants = c.participants.map((p) => {
      const canSeeThis = !rel.isAdmin && (seeAllItems || p.bankCode === bankCode)
      // 對內債權（C-1）：僅該行本身或稽核可見，永不對他行揭露
      const canSeeInternal = !rel.isAdmin && (rel.isAuditor || p.bankCode === bankCode)
      const liveTotal = p.items.reduce((s, it) => s + itemExternalTotal(it), 0)
      return {
        participantId: p.participantId,
        bankCode: p.bankCode,
        bankName: p.bank.bankName,
        roleInCase: p.roleInCase,
        confirmationStatus: p.confirmationStatus,
        confirmedAt: p.confirmedAt,
        removedAt: p.removedAt,
        removalKind: p.removalKind,
        removalReason: p.removalReason,
        // 數字：平台管理員永遠 null
        confirmedClaimAmount: canSeeAmounts ? p.confirmedClaimAmount : null,
        liveTotal: canSeeThis ? moneyOut(liveTotal) : null,
        canSeeInternal,
        items: canSeeThis
          ? p.items.map((it) => ({
              itemId: it.itemId,
              claimType: it.claimType,
              claimTypeOther: it.claimTypeOther,
              principal: it.principal,
              interest: it.interest,
              penalty: it.penalty,
              otherFee: it.otherFee,
              externalTotal: moneyOut(itemExternalTotal(it)),
              // 對內：僅本行/稽核可見（他行即使揭露後也拿不到）
              ...(canSeeInternal
                ? {
                    internalPrincipal: it.internalPrincipal,
                    internalInterest: it.internalInterest,
                    internalTotal: moneyOut(num(it.internalPrincipal) + num(it.internalInterest)),
                  }
                : {}),
              note: it.note,
            }))
          : null,
      }
    })

    return {
      case: {
        caseId: c.caseId,
        courtCode: c.courtCode,
        courtName: c.court.courtName,
        docNumber: c.docNumber,
        mainBankCode: c.mainBankCode,
        mainBankName: c.mainBank.bankName,
        status: c.status,
        round: c.round,
        receiptDate: dateOut(c.receiptDate),
        mediationDate: dateOut(c.mediationDate),
        mediationTime: c.mediationTime,
        mediationPlace: c.mediationPlace,
        interestCutoffDate: dateOut(c.interestCutoffDate),
        notifiedDate: dateOut(c.notifiedDate),
        disclosedAt: c.disclosedAt,
        consolidatedTotal: rel.isAdmin ? null : c.consolidatedTotal,
        outcomeReportedAt: c.outcomeReportedAt,
        notEstablishedReason: c.notEstablishedReason,
        note: c.note,
      },
      viewer: { isMain: rel.isMain, isParticipant: rel.isParticipant, isAdmin: rel.isAdmin, isAuditor: rel.isAuditor, bankCode },
      participants,
      doubts: c.doubts.map((dd) => ({
        doubtId: dd.doubtId,
        round: dd.round,
        raisedByBankCode: dd.raisedByBankCode,
        reason: dd.reason,
        pointerBankCode: dd.pointerBankCode,
        createdAt: dd.createdAt,
      })),
    }
  })

  // 共用：主辦 + 尚可編輯結構（DRAFT 或 PENDING_CONFIRMATION，且非終態）
  async function assertMainEditable(req: FastifyRequest, reply: FastifyReply, caseId: string) {
    const c = await prisma.case.findUnique({ where: { caseId } })
    if (!c) {
      reply.code(404).send({ message: '找不到案件' })
      return null
    }
    if (c.mainBankCode !== req.user.bankCode) {
      reply.code(403).send({ message: '只有最大債權行（主辦）可執行此操作' })
      return null
    }
    if (isTerminal(c.status)) {
      reply.code(409).send({ message: '案件已結案（終態），不可再變更' })
      return null
    }
    return c
  }

  // POST /api/cases/:caseId/participants — 邀請其他債權行（含重新邀請已移出者）
  app.post('/:caseId/participants', async (req: FastifyRequest<{ Params: { caseId: string }; Body: { bankCode: string } }>, reply) => {
    const { caseId } = req.params
    const c = await assertMainEditable(req, reply, caseId)
    if (!c) return
    if (isDisclosed(c.status)) return reply.code(409).send({ message: '已揭露，如需增減參與行請先由疑義退回重新確認' })
    const parsed = z.object({ bankCode: z.string().min(1) }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ message: '請提供 bankCode' })
    const inviteBank = parsed.data.bankCode
    if (inviteBank === c.mainBankCode) return reply.code(400).send({ message: '主辦銀行已是參與者' })
    const bank = await prisma.bank.findUnique({ where: { bankCode: inviteBank } })
    if (!bank || !bank.isActive) return reply.code(400).send({ message: '銀行不存在或未啟用' })

    const existing = await prisma.caseParticipantBank.findUnique({ where: { caseId_bankCode: { caseId, bankCode: inviteBank } } })
    if (existing) {
      if (!existing.removedAt) return reply.code(409).send({ message: '該銀行已受邀' })
      // 重新邀請：清空移出紀錄、回到待確認。
      // 明細「保留」不刪——誤移出後重邀時資料仍在，該行可直接確認或修改；
      // 因 confirmationStatus 已重置，舊數字不會自動生效、也不會自動觸發揭露。
      await prisma.caseParticipantBank.update({
        where: { participantId: existing.participantId },
        data: { removedAt: null, removalKind: null, removalReason: null, confirmationStatus: 'PENDING', confirmedAt: null, confirmedBy: null, confirmedClaimAmount: null },
      })
    } else {
      await prisma.caseParticipantBank.create({
        data: { caseId, bankCode: inviteBank, roleInCase: 'CO_BANK', confirmationStatus: 'PENDING' },
      })
    }
    await notifyBankUsers({
      bankCode: inviteBank,
      type: 'CASE_INVITATION',
      message: existing
        ? `您再次受邀參與案件（${c.docNumber}）。您先前填報的明細仍保留，請確認或更新後再次確認。`
        : `您受邀參與案件（${c.docNumber}）`,
      relatedCaseId: caseId,
    })
    await writeAudit({ actionType: 'PARTICIPANT_INVITED', userId: req.user.userId, bankCode: req.user.bankCode, targetType: 'CASE', targetId: caseId, detail: `invite ${inviteBank}`, req })
    return { ok: true }
  })

  // PUT /api/cases/:caseId/my-items — 各行自填「自己的」債權明細（含主辦；非代填）
  app.put('/:caseId/my-items', async (req: FastifyRequest<{ Params: { caseId: string } }>, reply) => {
    const { caseId } = req.params
    const { bankCode, userId } = req.user
    const parsed = myItemsSchema.safeParse(req.body)
    if (!parsed.success) {
      // 回傳第一個具體訊息，讓前端能直接顯示；issues 內含 path 供標紅對應列/欄
      const first = parsed.error.issues[0]
      return reply.code(400).send({ message: first?.message ?? '輸入格式不正確', issues: parsed.error.issues })
    }

    const c = await prisma.case.findUnique({ where: { caseId } })
    if (!c) return reply.code(404).send({ message: '找不到案件' })
    if (isDisclosed(c.status)) return reply.code(409).send({ message: '已揭露，如需修改請先由疑義退回重新確認' })
    if (c.status !== 'DRAFT' && c.status !== 'PENDING_CONFIRMATION') return reply.code(409).send({ message: '此階段不可申報' })

    const part = await prisma.caseParticipantBank.findUnique({ where: { caseId_bankCode: { caseId, bankCode } } })
    if (!part || part.removedAt) return reply.code(403).send({ message: '您不是此案件的（有效）參與行' })
    if (part.confirmationStatus === 'CONFIRMED') return reply.code(409).send({ message: '您已確認，請先撤回確認再修改' })

    const itemsData = parsed.data.items.map((it) => ({
      participantId: part.participantId,
      claimType: it.claimType,
      principal: new Prisma.Decimal(it.principal),
      interest: new Prisma.Decimal(it.interest),
      penalty: new Prisma.Decimal(it.penalty),
      otherFee: new Prisma.Decimal(it.otherFee),
      internalPrincipal: new Prisma.Decimal(it.internalPrincipal),
      internalInterest: new Prisma.Decimal(it.internalInterest),
      claimTypeOther: it.claimType === 'OTHER' ? it.claimTypeOther : null,
      note: it.note,
    }))

    await prisma.$transaction([
      prisma.creditItem.deleteMany({ where: { participantId: part.participantId } }),
      ...(itemsData.length ? [prisma.creditItem.createMany({ data: itemsData })] : []),
    ])
    const total = parsed.data.items.reduce((s, it) => s + it.principal + it.interest + it.penalty + it.otherFee, 0)
    await writeAudit({ actionType: 'DECLARATION_SUBMITTED', userId, bankCode, targetType: 'CASE', targetId: caseId, detail: `self items (${bankCode})`, req })
    return { ok: true, total }
  })

  // POST /api/cases/:caseId/publish — 發布（DRAFT → PENDING_CONFIRMATION，開放封閉申報）
  app.post('/:caseId/publish', async (req: FastifyRequest<{ Params: { caseId: string } }>, reply) => {
    const { caseId } = req.params
    const c = await assertMainEditable(req, reply, caseId)
    if (!c) return
    if (c.status !== 'DRAFT') return reply.code(409).send({ message: '僅草稿案件可發布' })

    const active = await prisma.caseParticipantBank.findMany({ where: { caseId, removedAt: null } })
    const coBanks = active.filter((p) => p.roleInCase === 'CO_BANK')
    if (coBanks.length === 0) return reply.code(400).send({ message: '請先邀請至少一家其他債權行再發布' })

    await prisma.case.update({ where: { caseId }, data: { status: 'PENDING_CONFIRMATION' } })
    for (const cb of coBanks) {
      await notifyBankUsers({ bankCode: cb.bankCode, type: 'CASE_PUBLISHED', message: `案件（${c.docNumber}）已發布，請填報並確認您的債權`, relatedCaseId: caseId })
    }
    await writeAudit({ actionType: 'CASE_PUBLISHED', userId: req.user.userId, bankCode: req.user.bankCode, targetType: 'CASE', targetId: caseId, req })
    return { ok: true }
  })
}
