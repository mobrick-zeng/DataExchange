import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { prisma } from '../prisma.js'
import { writeAudit } from '../lib/audit.js'
import { notifyBankUsers } from '../lib/notify.js'

const createCaseSchema = z.object({
  caseNumber: z.string().min(1),
  debtorId: z.string().min(1),
  debtorName: z.string().min(1),
  receiptDate: z.string().min(1),
  declarationDeadline: z.string().min(1),
  mediationDate: z.string().optional(),
  mediationInstitution: z.string().optional(),
  notificationDate: z.string().optional(),
  note: z.string().optional(),
  totalDebtAmount: z.number().optional(),
  monthlyInstallment: z.number().optional(),
  planStartDate: z.string().optional(),
  planInstallments: z.number().int().optional(),
})

const itemSchema = z.object({
  claimType: z.enum(['CREDIT_LOAN', 'CREDIT_CARD', 'GUARANTEE', 'OTHER']),
  externalPrincipal: z.number().default(0),
  externalInterest: z.number().default(0),
  externalPenalty: z.number().default(0),
  externalOtherFee: z.number().default(0),
  internalTotal: z.number().default(0),
  note: z.string().optional(),
})

function d(s?: string): Date | undefined {
  return s ? new Date(s) : undefined
}

/** 取得使用者對案件的關係，並判斷是否可存取 */
function relationTo(user: { role: string | null; bankCode: string | null }, mainBankCode: string, participantBankCodes: string[]) {
  const isAdmin = user.role === 'ADMIN'
  const isAuditor = user.role === 'PLATFORM_AUDITOR'
  const isMain = !!user.bankCode && user.bankCode === mainBankCode
  const isParticipant = !!user.bankCode && participantBankCodes.includes(user.bankCode)
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
      : { OR: [{ mainBankCode: bankCode ?? '__none__' }, { participants: { some: { bankCode: bankCode ?? '__none__' } } }] }

    const cases = await prisma.case.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        mainBank: { select: { bankName: true } },
        participants: { select: { bankCode: true, roleInCase: true, confirmationStatus: true } },
      },
    })

    return {
      cases: cases.map((c) => {
        const mine = c.participants.find((p) => p.bankCode === bankCode)
        return {
          caseId: c.caseId,
          caseNumber: c.caseNumber,
          debtorName: c.debtorName,
          mainBankCode: c.mainBankCode,
          mainBankName: c.mainBank.bankName,
          status: c.status,
          declarationDeadline: c.declarationDeadline,
          totalDebtAmount: c.totalDebtAmount,
          participantCount: c.participants.length,
          myRoleInCase: mine?.roleInCase ?? (c.mainBankCode === bankCode ? 'MAIN' : null),
          myConfirmationStatus: mine?.confirmationStatus ?? null,
        }
      }),
    }
  })

  // POST /api/cases — 建立案件（僅銀行人員；建立者所屬銀行即最大債權行）
  app.post('/', async (req, reply) => {
    const { role, bankCode, userId } = req.user
    if (role !== 'BANK_STAFF' || !bankCode || bankCode === 'PLATFORM') {
      return reply.code(403).send({ message: '僅銀行人員可建立案件' })
    }
    const parsed = createCaseSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ message: '輸入格式不正確', issues: parsed.error.issues })
    const b = parsed.data

    const existing = await prisma.case.findUnique({ where: { caseNumber: b.caseNumber } })
    if (existing) return reply.code(409).send({ message: '案號已存在' })

    const created = await prisma.$transaction(async (tx) => {
      const c = await tx.case.create({
        data: {
          caseNumber: b.caseNumber,
          debtorId: b.debtorId,
          debtorName: b.debtorName,
          mainBankCode: bankCode,
          receiptDate: new Date(b.receiptDate),
          declarationDeadline: new Date(b.declarationDeadline),
          mediationDate: d(b.mediationDate),
          mediationInstitution: b.mediationInstitution,
          notificationDate: d(b.notificationDate),
          note: b.note,
          totalDebtAmount: b.totalDebtAmount,
          monthlyInstallment: b.monthlyInstallment,
          planStartDate: d(b.planStartDate),
          planInstallments: b.planInstallments,
          status: 'DRAFT',
          createdBy: userId,
        },
      })
      // 最大債權行自身：參與列 + 債權容器
      await tx.caseParticipantBank.create({
        data: { caseId: c.caseId, bankCode, roleInCase: 'MAIN', confirmationStatus: 'NOT_REQUIRED' },
      })
      await tx.creditorDeclaration.create({ data: { caseId: c.caseId, bankCode } })
      return c
    })

    await writeAudit({ actionType: 'CREATE_CASE', userId, bankCode, targetType: 'case', targetId: created.caseId, req })
    return { caseId: created.caseId }
  })

  // GET /api/cases/:caseId — 案件詳情（套用可視範圍）
  app.get('/:caseId', async (req: FastifyRequest<{ Params: { caseId: string } }>, reply) => {
    const { caseId } = req.params
    const { role, bankCode, userId } = req.user

    const c = await prisma.case.findUnique({
      where: { caseId },
      include: {
        mainBank: { select: { bankName: true } },
        participants: { include: { bank: { select: { bankName: true } } } },
        declarations: { include: { items: true, bank: { select: { bankName: true } } } },
      },
    })
    if (!c) return reply.code(404).send({ message: '找不到案件' })

    const rel = relationTo({ role, bankCode }, c.mainBankCode, c.participants.map((p) => p.bankCode))
    if (!rel.canAccess) return reply.code(403).send({ message: '權限不足' })

    const seeAllItems = rel.isMain || rel.isAdmin || rel.isAuditor
    const seeInternal = rel.isAuditor // 方案B：僅平台稽核可見 internal_total

    if (seeInternal) {
      await writeAudit({ actionType: 'VIEW_INTERNAL_TOTAL', userId, bankCode, targetType: 'case', targetId: caseId, req })
    }

    const declarations = c.declarations.map((decl) => {
      const canSeeItems = seeAllItems || decl.bankCode === bankCode
      return {
        declarationId: decl.declarationId,
        bankCode: decl.bankCode,
        bankName: decl.bank.bankName,
        totalAmount: decl.totalAmount,
        items: canSeeItems
          ? decl.items.map((it) => ({
              itemId: it.itemId,
              claimType: it.claimType,
              externalPrincipal: it.externalPrincipal,
              externalInterest: it.externalInterest,
              externalPenalty: it.externalPenalty,
              externalOtherFee: it.externalOtherFee,
              externalTotal: it.externalTotal,
              ...(seeInternal ? { internalTotal: it.internalTotal } : {}),
              note: it.note,
            }))
          : null, // 其他債權行看不到別家逐筆明細
      }
    })

    return {
      case: {
        caseId: c.caseId,
        caseNumber: c.caseNumber,
        debtorId: c.debtorId,
        debtorName: c.debtorName,
        mainBankCode: c.mainBankCode,
        mainBankName: c.mainBank.bankName,
        status: c.status,
        receiptDate: c.receiptDate,
        mediationDate: c.mediationDate,
        mediationInstitution: c.mediationInstitution,
        notificationDate: c.notificationDate,
        declarationDeadline: c.declarationDeadline,
        totalDebtAmount: c.totalDebtAmount,
        monthlyInstallment: c.monthlyInstallment,
        planStartDate: c.planStartDate,
        planInstallments: c.planInstallments,
        settledAt: c.settledAt,
        terminatedAt: c.terminatedAt,
        terminationReason: c.terminationReason,
        note: c.note,
      },
      viewer: { isMain: rel.isMain, isParticipant: rel.isParticipant, isAdmin: rel.isAdmin, isAuditor: rel.isAuditor, bankCode },
      participants: c.participants.map((p) => ({
        bankCode: p.bankCode,
        bankName: p.bank.bankName,
        roleInCase: p.roleInCase,
        confirmationStatus: p.confirmationStatus,
        confirmedAt: p.confirmedAt,
        disputeReason: p.disputeReason,
        disputedAt: p.disputedAt,
      })),
      declarations,
    }
  })

  // 共用：確認呼叫者是該案主辦、且案件在可編輯狀態
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
      reply.code(409).send({ message: '案件已發布，草稿階段才能編輯參與銀行與債權資料' })
      return null
    }
    return c
  }

  // POST /api/cases/:caseId/participants — 邀請其他債權行
  app.post('/:caseId/participants', async (req: FastifyRequest<{ Params: { caseId: string }; Body: { bankCode: string } }>, reply) => {
    const { caseId } = req.params
    const c = await assertMainDraft(req, reply, caseId)
    if (!c) return
    const inviteBank = req.body?.bankCode
    if (!inviteBank) return reply.code(400).send({ message: '請提供 bankCode' })
    if (inviteBank === c.mainBankCode) return reply.code(400).send({ message: '主辦銀行已是參與者' })
    const bank = await prisma.bank.findUnique({ where: { bankCode: inviteBank } })
    if (!bank) return reply.code(404).send({ message: '銀行不存在' })
    const dup = await prisma.caseParticipantBank.findUnique({ where: { caseId_bankCode: { caseId, bankCode: inviteBank } } })
    if (dup) return reply.code(409).send({ message: '該銀行已受邀' })

    await prisma.$transaction([
      prisma.caseParticipantBank.create({
        data: { caseId, bankCode: inviteBank, roleInCase: 'CO_BANK', confirmationStatus: 'PENDING' },
      }),
      prisma.creditorDeclaration.create({ data: { caseId, bankCode: inviteBank } }),
    ])
    await writeAudit({ actionType: 'INVITE_BANK', userId: req.user.userId, bankCode: req.user.bankCode, targetType: 'case', targetId: caseId, detail: `invite ${inviteBank}`, req })
    return { ok: true }
  })

  // PUT /api/cases/:caseId/declarations/:bankCode — 代填某債權行的債權明細
  app.put('/:caseId/declarations/:bankCode', async (req: FastifyRequest<{ Params: { caseId: string; bankCode: string } }>, reply) => {
    const { caseId, bankCode: targetBank } = req.params
    const parsed = z.object({ items: z.array(itemSchema) }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ message: '輸入格式不正確', issues: parsed.error.issues })

    const c = await prisma.case.findUnique({ where: { caseId } })
    if (!c) return reply.code(404).send({ message: '找不到案件' })
    if (c.mainBankCode !== req.user.bankCode) return reply.code(403).send({ message: '只有最大債權行（主辦）可編輯債權資料' })

    const targetPart = await prisma.caseParticipantBank.findUnique({ where: { caseId_bankCode: { caseId, bankCode: targetBank } } })
    const isDisputed = targetPart?.confirmationStatus === 'DISPUTED'
    // 草稿階段可自由編輯；已發布後僅能修正「被該行回報異議」的資料
    if (c.status !== 'DRAFT' && !isDisputed) {
      return reply.code(409).send({ message: '案件已發布，僅能修正被回報異議的資料' })
    }

    const decl = await prisma.creditorDeclaration.findUnique({ where: { caseId_bankCode: { caseId, bankCode: targetBank } } })
    if (!decl) return reply.code(404).send({ message: '該銀行未參與此案件' })

    let total = 0
    const itemsData = parsed.data.items.map((it) => {
      const externalTotal = it.externalPrincipal + it.externalInterest + it.externalPenalty + it.externalOtherFee
      total += externalTotal
      return { ...it, externalTotal, declarationId: decl.declarationId }
    })

    await prisma.$transaction([
      prisma.creditItem.deleteMany({ where: { declarationId: decl.declarationId } }),
      ...(itemsData.length ? [prisma.creditItem.createMany({ data: itemsData })] : []),
      prisma.creditorDeclaration.update({ where: { declarationId: decl.declarationId }, data: { totalAmount: total } }),
    ])
    // 若原本是被該行回報異議，修正後重設為待確認並重新通知該行
    if (isDisputed) {
      await prisma.caseParticipantBank.update({
        where: { caseId_bankCode: { caseId, bankCode: targetBank } },
        data: { confirmationStatus: 'PENDING', disputeReason: null, disputedAt: null },
      })
      await notifyBankUsers({ bankCode: targetBank, type: 'CASE_INVITATION', message: `案件 ${c.caseNumber} 已修正，請重新確認`, relatedCaseId: caseId })
    }
    await writeAudit({ actionType: 'UPDATE_CASE', userId: req.user.userId, bankCode: req.user.bankCode, targetType: 'declaration', targetId: decl.declarationId, detail: `fill claims for ${targetBank}`, req })
    return { ok: true, totalAmount: total }
  })

  // POST /api/cases/:caseId/publish — 發布案件，通知其他債權行確認
  app.post('/:caseId/publish', async (req: FastifyRequest<{ Params: { caseId: string } }>, reply) => {
    const { caseId } = req.params
    const c = await assertMainDraft(req, reply, caseId)
    if (!c) return

    const coBanks = await prisma.caseParticipantBank.findMany({ where: { caseId, roleInCase: 'CO_BANK' }, select: { bankCode: true } })
    if (coBanks.length === 0) return reply.code(400).send({ message: '請先邀請至少一家其他債權行再發布' })

    await prisma.$transaction([
      prisma.case.update({ where: { caseId }, data: { status: 'PENDING_CONFIRMATION' } }),
      prisma.caseParticipantBank.updateMany({ where: { caseId, roleInCase: 'CO_BANK' }, data: { confirmationStatus: 'PENDING' } }),
    ])
    for (const cb of coBanks) {
      await notifyBankUsers({ bankCode: cb.bankCode, type: 'CASE_INVITATION', message: `您有新案件（${c.caseNumber}）待確認`, relatedCaseId: caseId })
    }
    await writeAudit({ actionType: 'PUBLISH_CASE', userId: req.user.userId, bankCode: req.user.bankCode, targetType: 'case', targetId: caseId, req })
    return { ok: true }
  })
}
