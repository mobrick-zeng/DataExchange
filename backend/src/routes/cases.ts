import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../prisma.js'
import { writeAudit } from '../lib/audit.js'
import { notifyBankUsers } from '../lib/notify.js'

const createCaseSchema = z.object({
  courtCode: z.string().min(1),
  docNumber: z.string().min(1),
  receiptDate: z.string().optional(),
  confirmationDeadline: z.string().optional(),
  note: z.string().optional(),
})

const itemSchema = z.object({
  claimType: z.enum(['CREDIT_LOAN', 'CREDIT_CARD', 'GUARANTEE', 'OTHER']),
  principal: z.number().default(0),
  interest: z.number().default(0),
  penalty: z.number().default(0),
  otherFee: z.number().default(0),
  internalTotal: z.number().default(0),
  note: z.string().optional(),
})

function d(s?: string): Date | undefined {
  return s ? new Date(s) : undefined
}
const num = (v: Prisma.Decimal | null | undefined) => (v == null ? 0 : Number(v))
const itemExternalTotal = (it: { principal: any; interest: any; penalty: any; otherFee: any }) =>
  num(it.principal) + num(it.interest) + num(it.penalty) + num(it.otherFee)

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
      : { OR: [{ mainBankCode: bankCode }, { participants: { some: { bankCode } } }] }

    const cases = await prisma.case.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        court: { select: { courtName: true } },
        mainBank: { select: { bankName: true } },
        participants: { select: { bankCode: true, roleInCase: true, confirmationStatus: true } },
      },
    })

    return {
      cases: cases.map((c) => {
        const mine = c.participants.find((p) => p.bankCode === bankCode)
        return {
          caseId: c.caseId,
          courtCode: c.courtCode,
          courtName: c.court.courtName,
          docNumber: c.docNumber,
          mainBankCode: c.mainBankCode,
          mainBankName: c.mainBank.bankName,
          status: c.status,
          confirmationDeadline: c.confirmationDeadline,
          totalDebtAmount: c.totalDebtAmount,
          participantCount: c.participants.length,
          myRoleInCase: mine?.roleInCase ?? null,
          myConfirmationStatus: mine?.confirmationStatus ?? null,
        }
      }),
    }
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

    const court = await prisma.court.findUnique({ where: { courtCode: b.courtCode } })
    if (!court || !court.isActive) return reply.code(400).send({ message: '法院不存在或未啟用' })

    const dup = await prisma.case.findUnique({ where: { courtCode_docNumber: { courtCode: b.courtCode, docNumber: b.docNumber } } })
    if (dup) return reply.code(409).send({ message: '此法院＋公文文號已建立過案件' })

    const created = await prisma.$transaction(async (tx) => {
      const c = await tx.case.create({
        data: {
          courtCode: b.courtCode,
          docNumber: b.docNumber,
          mainBankCode: bankCode,
          receiptDate: d(b.receiptDate),
          confirmationDeadline: d(b.confirmationDeadline),
          note: b.note,
          status: 'DRAFT',
          createdBy: userId,
        },
      })
      // 主辦自身為參與行（角色 MAIN、無需確認）
      await tx.caseParticipantBank.create({
        data: { caseId: c.caseId, bankCode, roleInCase: 'MAIN', confirmationStatus: 'NOT_REQUIRED' },
      })
      return c
    })

    await writeAudit({ actionType: 'CASE_CREATED', userId, bankCode, targetType: 'CASE', targetId: created.caseId, req })
    return { caseId: created.caseId }
  })

  // GET /api/cases/:caseId — 案件詳情（套用可視範圍）
  app.get('/:caseId', async (req: FastifyRequest<{ Params: { caseId: string } }>, reply) => {
    const { caseId } = req.params
    const { role, bankCode, userId } = req.user

    const c = await prisma.case.findUnique({
      where: { caseId },
      include: {
        court: { select: { courtName: true } },
        mainBank: { select: { bankName: true } },
        participants: { include: { bank: { select: { bankName: true } }, items: true } },
      },
    })
    if (!c) return reply.code(404).send({ message: '找不到案件' })

    const rel = relationTo({ role, bankCode }, c.mainBankCode, c.participants.map((p) => p.bankCode))
    if (!rel.canAccess) return reply.code(403).send({ message: '權限不足' })

    const seeAllItems = rel.isMain || rel.isAdmin || rel.isAuditor
    const seeInternal = rel.isAuditor // 方案B：僅平台稽核可見 internalTotal
    if (seeInternal) {
      await writeAudit({ actionType: 'INTERNAL_TOTAL_VIEWED', userId, bankCode, targetType: 'CASE', targetId: caseId, req })
    }

    const participants = c.participants.map((p) => {
      const canSeeItems = seeAllItems || p.bankCode === bankCode
      const liveTotal = p.items.reduce((s, it) => s + itemExternalTotal(it), 0)
      return {
        participantId: p.participantId,
        bankCode: p.bankCode,
        bankName: p.bank.bankName,
        roleInCase: p.roleInCase,
        planRatio: p.planRatio,
        confirmationStatus: p.confirmationStatus,
        confirmedAt: p.confirmedAt,
        confirmedClaimAmount: p.confirmedClaimAmount,
        disputeReason: p.disputeReason,
        disputedAt: p.disputedAt,
        liveTotal, // 明細即時加總（未凍結前的參考）
        items: canSeeItems
          ? p.items.map((it) => ({
              itemId: it.itemId,
              claimType: it.claimType,
              principal: it.principal,
              interest: it.interest,
              penalty: it.penalty,
              otherFee: it.otherFee,
              externalTotal: itemExternalTotal(it),
              ...(seeInternal ? { internalTotal: it.internalTotal } : {}),
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
        receiptDate: c.receiptDate,
        confirmationDeadline: c.confirmationDeadline,
        monthlyInstallment: c.monthlyInstallment,
        planInstallments: c.planInstallments,
        planStartDate: c.planStartDate,
        totalDebtAmount: c.totalDebtAmount,
        confirmedAt: c.confirmedAt,
        settledAt: c.settledAt,
        terminatedAt: c.terminatedAt,
        terminationReason: c.terminationReason,
        note: c.note,
      },
      viewer: { isMain: rel.isMain, isParticipant: rel.isParticipant, isAdmin: rel.isAdmin, isAuditor: rel.isAuditor, bankCode },
      participants,
    }
  })

  // 共用：主辦 + DRAFT 檢查
  async function assertMainDraft(req: FastifyRequest, reply: FastifyReply, caseId: string) {
    const c = await prisma.case.findUnique({ where: { caseId } })
    if (!c) {
      reply.code(404).send({ message: '找不到案件' })
      return null
    }
    if (c.mainBankCode !== req.user.bankCode) {
      reply.code(403).send({ message: '只有最大債權行（主辦）可執行此操作' })
      return null
    }
    if (c.status !== 'DRAFT') {
      reply.code(409).send({ message: '案件已發布，草稿階段才能編輯' })
      return null
    }
    return c
  }

  // POST /api/cases/:caseId/participants — 邀請其他債權行
  app.post('/:caseId/participants', async (req: FastifyRequest<{ Params: { caseId: string }; Body: { bankCode: string; planRatio?: number } }>, reply) => {
    const { caseId } = req.params
    const c = await assertMainDraft(req, reply, caseId)
    if (!c) return
    const parsed = z.object({ bankCode: z.string().min(1), planRatio: z.number().min(0).max(1).optional() }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ message: '請提供 bankCode' })
    const inviteBank = parsed.data.bankCode
    if (inviteBank === c.mainBankCode) return reply.code(400).send({ message: '主辦銀行已是參與者' })
    const bank = await prisma.bank.findUnique({ where: { bankCode: inviteBank } })
    if (!bank || !bank.isActive) return reply.code(400).send({ message: '銀行不存在或未啟用' })
    const dup = await prisma.caseParticipantBank.findUnique({ where: { caseId_bankCode: { caseId, bankCode: inviteBank } } })
    if (dup) return reply.code(409).send({ message: '該銀行已受邀' })

    await prisma.caseParticipantBank.create({
      data: { caseId, bankCode: inviteBank, roleInCase: 'CO_BANK', confirmationStatus: 'PENDING', planRatio: new Prisma.Decimal(parsed.data.planRatio ?? 0) },
    })
    await writeAudit({ actionType: 'PARTICIPANT_INVITED', userId: req.user.userId, bankCode: req.user.bankCode, targetType: 'CASE', targetId: caseId, detail: `invite ${inviteBank}`, req })
    return { ok: true }
  })

  // PUT /api/cases/:caseId/participants/:bankCode/items — 代填某債權行的債權明細
  app.put('/:caseId/participants/:bankCode/items', async (req: FastifyRequest<{ Params: { caseId: string; bankCode: string } }>, reply) => {
    const { caseId, bankCode: targetBank } = req.params
    const parsed = z.object({ items: z.array(itemSchema) }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ message: '輸入格式不正確', issues: parsed.error.issues })

    const c = await prisma.case.findUnique({ where: { caseId } })
    if (!c) return reply.code(404).send({ message: '找不到案件' })
    if (c.mainBankCode !== req.user.bankCode) return reply.code(403).send({ message: '只有最大債權行（主辦）可編輯債權資料' })

    const part = await prisma.caseParticipantBank.findUnique({ where: { caseId_bankCode: { caseId, bankCode: targetBank } } })
    if (!part) return reply.code(404).send({ message: '該銀行未參與此案件' })
    const isDisputed = part.confirmationStatus === 'DISPUTED'
    if (c.status !== 'DRAFT' && !isDisputed) {
      return reply.code(409).send({ message: '案件已發布，僅能修正被回報異議的資料' })
    }

    const itemsData = parsed.data.items.map((it) => ({
      participantId: part.participantId,
      claimType: it.claimType,
      principal: new Prisma.Decimal(it.principal),
      interest: new Prisma.Decimal(it.interest),
      penalty: new Prisma.Decimal(it.penalty),
      otherFee: new Prisma.Decimal(it.otherFee),
      internalTotal: new Prisma.Decimal(it.internalTotal),
      note: it.note,
    }))

    await prisma.$transaction([
      prisma.creditItem.deleteMany({ where: { participantId: part.participantId } }),
      ...(itemsData.length ? [prisma.creditItem.createMany({ data: itemsData })] : []),
    ])

    // 若原為異議，修正後重設待確認並通知該行
    if (isDisputed) {
      await prisma.caseParticipantBank.update({
        where: { participantId: part.participantId },
        data: { confirmationStatus: 'PENDING', disputeReason: null, disputedAt: null },
      })
      await notifyBankUsers({ bankCode: targetBank, type: 'CASE_INVITATION', message: `案件（${c.docNumber}）已修正，請重新確認`, relatedCaseId: caseId })
    }
    const total = parsed.data.items.reduce((s, it) => s + it.principal + it.interest + it.penalty + it.otherFee, 0)
    await writeAudit({ actionType: 'CASE_UPDATED', userId: req.user.userId, bankCode: req.user.bankCode, targetType: 'CASE', targetId: caseId, detail: `fill items for ${targetBank}`, req })
    return { ok: true, total }
  })

  // PUT /api/cases/:caseId/plan — 設定還款計畫與各行比例（僅 DRAFT、主辦）
  app.put('/:caseId/plan', async (req: FastifyRequest<{ Params: { caseId: string } }>, reply) => {
    const { caseId } = req.params
    const c = await assertMainDraft(req, reply, caseId)
    if (!c) return
    const parsed = z
      .object({
        monthlyInstallment: z.number().nonnegative(),
        planInstallments: z.number().int().positive(),
        planStartDate: z.string().min(1),
        ratios: z.array(z.object({ bankCode: z.string(), planRatio: z.number().min(0).max(1) })).min(1),
      })
      .safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ message: '輸入格式不正確', issues: parsed.error.issues })
    const { monthlyInstallment, planInstallments, planStartDate, ratios } = parsed.data

    const sum = ratios.reduce((s, r) => s + r.planRatio, 0)
    if (Math.abs(sum - 1) > 0.0001) return reply.code(400).send({ message: `各行還款計畫比例加總須為 1（目前 ${sum}）` })

    const parts = await prisma.caseParticipantBank.findMany({ where: { caseId } })
    const partByBank = new Map(parts.map((p) => [p.bankCode, p]))
    for (const r of ratios) if (!partByBank.has(r.bankCode)) return reply.code(400).send({ message: `${r.bankCode} 非本案參與行` })

    await prisma.$transaction([
      prisma.case.update({
        where: { caseId },
        data: { monthlyInstallment: new Prisma.Decimal(monthlyInstallment), planInstallments, planStartDate: new Date(planStartDate) },
      }),
      ...ratios.map((r) =>
        prisma.caseParticipantBank.update({
          where: { caseId_bankCode: { caseId, bankCode: r.bankCode } },
          data: { planRatio: new Prisma.Decimal(r.planRatio) },
        }),
      ),
    ])
    await writeAudit({ actionType: 'PLAN_RATIO_UPDATED', userId: req.user.userId, bankCode: req.user.bankCode, targetType: 'CASE', targetId: caseId, req })
    return { ok: true }
  })

  // POST /api/cases/:caseId/publish — 發布（凍結主辦金額、通知各行確認）
  app.post('/:caseId/publish', async (req: FastifyRequest<{ Params: { caseId: string } }>, reply) => {
    const { caseId } = req.params
    const c = await assertMainDraft(req, reply, caseId)
    if (!c) return
    if (!c.monthlyInstallment || !c.planInstallments || !c.planStartDate) {
      return reply.code(400).send({ message: '請先設定還款計畫（每月金額、期數、起始月）' })
    }

    const parts = await prisma.caseParticipantBank.findMany({ where: { caseId }, include: { items: true } })
    const coBanks = parts.filter((p) => p.roleInCase === 'CO_BANK')
    if (coBanks.length === 0) return reply.code(400).send({ message: '請先邀請至少一家其他債權行再發布' })

    const ratioSum = parts.reduce((s, p) => s + num(p.planRatio), 0)
    if (Math.abs(ratioSum - 1) > 0.0001) return reply.code(400).send({ message: '各行還款計畫比例加總須為 1，請先於還款計畫設定' })

    const mainPart = parts.find((p) => p.roleInCase === 'MAIN')!
    const mainTotal = mainPart.items.reduce((s, it) => s + itemExternalTotal(it), 0)

    await prisma.$transaction([
      prisma.case.update({ where: { caseId }, data: { status: 'PENDING_CONFIRMATION' } }),
      // 主辦金額於發布當下凍結
      prisma.caseParticipantBank.update({ where: { participantId: mainPart.participantId }, data: { confirmedClaimAmount: new Prisma.Decimal(mainTotal) } }),
      prisma.caseParticipantBank.updateMany({ where: { caseId, roleInCase: 'CO_BANK' }, data: { confirmationStatus: 'PENDING' } }),
    ])
    for (const cb of coBanks) {
      await notifyBankUsers({ bankCode: cb.bankCode, type: 'CASE_PUBLISHED', message: `您有新案件（${c.docNumber}）待確認`, relatedCaseId: caseId })
    }
    await writeAudit({ actionType: 'CASE_PUBLISHED', userId: req.user.userId, bankCode: req.user.bankCode, targetType: 'CASE', targetId: caseId, req })
    return { ok: true }
  })
}
