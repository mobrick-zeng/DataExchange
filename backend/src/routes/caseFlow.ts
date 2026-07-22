import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../prisma.js'
import { writeAudit } from '../lib/audit.js'
import { notifyBankUsers } from '../lib/notify.js'

const num = (v: Prisma.Decimal | null | undefined) => (v == null ? 0 : Number(v))
const r4 = (n: number) => Math.round(n * 10000) / 10000
const itemTotal = (it: { principal: any; interest: any; penalty: any; otherFee: any }) =>
  num(it.principal) + num(it.interest) + num(it.penalty) + num(it.otherFee)

/** 依 planRatio 攤提 total；尾差記入主辦，確保加總＝total */
function splitByRatio(total: number, parts: { bankCode: string; ratio: number; isMain: boolean }[]) {
  const amounts: Record<string, number> = {}
  let allocated = 0
  const main = parts.find((p) => p.isMain)!
  for (const p of parts) {
    if (p.isMain) continue
    amounts[p.bankCode] = r4(total * p.ratio)
    allocated = r4(allocated + amounts[p.bankCode])
  }
  amounts[main.bankCode] = r4(total - allocated)
  const remainder = r4(amounts[main.bankCode] - r4(total * main.ratio))
  return { amounts, remainder }
}

/** 確認單一案件；回傳是否全部確認完成。確認當下凍結該行債權金額。 */
type ConfirmResult = { ok: true; allConfirmed: boolean } | { ok: false; reason: 'NOT_CO_BANK' | 'NOT_FOUND' }
async function confirmOne(caseId: string, userId: string, bankCode: string): Promise<ConfirmResult> {
  const part = await prisma.caseParticipantBank.findUnique({ where: { caseId_bankCode: { caseId, bankCode } }, include: { items: true } })
  if (!part || part.roleInCase !== 'CO_BANK') return { ok: false, reason: 'NOT_CO_BANK' }
  const claim = part.items.reduce((s, it) => s + itemTotal(it), 0)

  await prisma.caseParticipantBank.update({
    where: { participantId: part.participantId },
    data: { confirmationStatus: 'CONFIRMED', confirmedBy: userId, confirmedAt: new Date(), disputeReason: null, disputedAt: null, confirmedClaimAmount: new Prisma.Decimal(claim) },
  })
  const c = await prisma.case.findUnique({ where: { caseId } })
  if (!c) return { ok: false, reason: 'NOT_FOUND' }
  await notifyBankUsers({ bankCode: c.mainBankCode, type: 'CASE_CONFIRMED_BY_BANK', message: `${bankCode} 已確認案件 ${c.docNumber}`, relatedCaseId: caseId })

  const remaining = await prisma.caseParticipantBank.count({ where: { caseId, roleInCase: 'CO_BANK', confirmationStatus: { not: 'CONFIRMED' } } })
  const allConfirmed = remaining === 0
  if (allConfirmed && c.status === 'PENDING_CONFIRMATION') {
    const parts = await prisma.caseParticipantBank.findMany({ where: { caseId } })
    const total = parts.reduce((s, p) => s + num(p.confirmedClaimAmount), 0)
    await prisma.case.update({ where: { caseId }, data: { status: 'IN_REPAYMENT', confirmedAt: new Date(), totalDebtAmount: new Prisma.Decimal(total) } })
    await notifyBankUsers({ bankCode: c.mainBankCode, type: 'ALL_BANKS_CONFIRMED', message: `案件 ${c.docNumber} 全部債權行已確認，進入還款中`, relatedCaseId: caseId })
  }
  return { ok: true, allConfirmed }
}

export async function caseFlowRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)

  // POST /:caseId/confirm
  app.post('/:caseId/confirm', async (req: FastifyRequest<{ Params: { caseId: string } }>, reply) => {
    const { caseId } = req.params
    const { userId, bankCode } = req.user
    const r = await confirmOne(caseId, userId, bankCode)
    if (!r.ok) return reply.code(r.reason === 'NOT_FOUND' ? 404 : 403).send({ message: r.reason === 'NOT_CO_BANK' ? '您不是此案件的其他債權行' : '找不到案件' })
    await writeAudit({ actionType: 'CASE_CONFIRMED', userId, bankCode, targetType: 'CASE', targetId: caseId, req })
    return { ok: true, allConfirmed: r.allConfirmed }
  })

  // POST /batch-confirm
  app.post('/batch-confirm', async (req: FastifyRequest<{ Body: { caseIds: string[] } }>, reply) => {
    const { userId, bankCode } = req.user
    const parsed = z.object({ caseIds: z.array(z.string()).min(1) }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ message: '請提供 caseIds' })
    const results: Record<string, string> = {}
    for (const caseId of parsed.data.caseIds) {
      const r = await confirmOne(caseId, userId, bankCode)
      if (r.ok) {
        results[caseId] = 'CONFIRMED'
        await writeAudit({ actionType: 'CASE_CONFIRMED', userId, bankCode, targetType: 'CASE', targetId: caseId, detail: 'batch', req })
      } else results[caseId] = r.reason
    }
    return { results }
  })

  // POST /:caseId/dispute
  app.post('/:caseId/dispute', async (req: FastifyRequest<{ Params: { caseId: string }; Body: { reason: string } }>, reply) => {
    const { caseId } = req.params
    const { userId, bankCode } = req.user
    const parsed = z.object({ reason: z.string().min(1) }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ message: '請填寫異議原因' })

    const part = await prisma.caseParticipantBank.findUnique({ where: { caseId_bankCode: { caseId, bankCode } } })
    if (!part || part.roleInCase !== 'CO_BANK') return reply.code(403).send({ message: '您不是此案件的其他債權行' })

    await prisma.caseParticipantBank.update({
      where: { participantId: part.participantId },
      data: { confirmationStatus: 'DISPUTED', disputeReason: parsed.data.reason, disputedAt: new Date(), confirmedAt: null, confirmedBy: null, confirmedClaimAmount: null },
    })
    const c = await prisma.case.findUnique({ where: { caseId } })
    if (c) await notifyBankUsers({ bankCode: c.mainBankCode, type: 'CASE_DISPUTED_BY_BANK', message: `${bankCode} 對案件 ${c.docNumber} 回報異議`, relatedCaseId: caseId })
    await writeAudit({ actionType: 'CASE_DISPUTED', userId, bankCode, targetType: 'CASE', targetId: caseId, detail: parsed.data.reason, req })
    return { ok: true }
  })

  async function assertMain(req: FastifyRequest, reply: FastifyReply, caseId: string) {
    const c = await prisma.case.findUnique({ where: { caseId } })
    if (!c) {
      reply.code(404).send({ message: '找不到案件' })
      return null
    }
    if (c.mainBankCode !== req.user.bankCode) {
      reply.code(403).send({ message: '只有最大債權行（主辦）可執行此操作' })
      return null
    }
    return c
  }

  // POST /:caseId/repayments — 登記本期實收總額，系統依 planRatio 自動攤提
  app.post('/:caseId/repayments', async (req: FastifyRequest<{ Params: { caseId: string } }>, reply) => {
    const { caseId } = req.params
    const c = await assertMain(req, reply, caseId)
    if (!c) return
    if (c.status !== 'IN_REPAYMENT') return reply.code(409).send({ message: '案件需在「還款中」才能登記還款' })
    const parsed = z
      .object({ period: z.string().regex(/^\d{4}-\d{2}$/, '期別格式須為 YYYY-MM'), actualReceivedTotal: z.number().nonnegative(), note: z.string().optional() })
      .safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ message: '輸入格式不正確', issues: parsed.error.issues })
    const { period, actualReceivedTotal, note } = parsed.data

    const parts = await prisma.caseParticipantBank.findMany({ where: { caseId } })
    const shape = parts.map((p) => ({ bankCode: p.bankCode, participantId: p.participantId, ratio: num(p.planRatio), isMain: p.roleInCase === 'MAIN' }))
    const monthly = num(c.monthlyInstallment)
    const planned = splitByRatio(monthly, shape)
    const actual = splitByRatio(actualReceivedTotal, shape)
    const hasRounding = actual.remainder !== 0

    await prisma.$transaction(async (tx) => {
      const existing = await tx.repaymentPeriod.findUnique({ where: { caseId_period: { caseId, period } } })
      if (existing) await tx.repaymentAllocation.deleteMany({ where: { periodId: existing.periodId } })
      const per = existing
        ? await tx.repaymentPeriod.update({ where: { periodId: existing.periodId }, data: { actualReceivedTotal: new Prisma.Decimal(actualReceivedTotal), hasRoundingAdjust: hasRounding, note, recordedBy: req.user.userId, recordedAt: new Date() } })
        : await tx.repaymentPeriod.create({ data: { caseId, period, actualReceivedTotal: new Prisma.Decimal(actualReceivedTotal), hasRoundingAdjust: hasRounding, note, recordedBy: req.user.userId } })
      await tx.repaymentAllocation.createMany({
        data: shape.map((p) => ({
          periodId: per.periodId,
          participantId: p.participantId,
          plannedAmount: new Prisma.Decimal(planned.amounts[p.bankCode]),
          actualAmount: new Prisma.Decimal(actual.amounts[p.bankCode]),
          roundingAdjustment: new Prisma.Decimal(p.isMain ? actual.remainder : 0),
        })),
      })
    })

    for (const p of parts.filter((x) => x.roleInCase === 'CO_BANK')) {
      await notifyBankUsers({ bankCode: p.bankCode, type: 'REPAYMENT_RECORDED', message: `案件 ${c.docNumber} ${period} 還款已更新`, relatedCaseId: caseId })
    }
    await writeAudit({ actionType: 'REPAYMENT_RECORDED', userId: req.user.userId, bankCode: req.user.bankCode, targetType: 'CASE', targetId: caseId, detail: `${period} 實收 ${actualReceivedTotal}`, req })
    return { ok: true, period, hasRoundingAdjust: hasRounding }
  })

  // GET /:caseId/repayments — 還款對照表（各行原定 vs 實際、剩餘、兩種百分比）
  app.get('/:caseId/repayments', async (req: FastifyRequest<{ Params: { caseId: string } }>, reply) => {
    const { caseId } = req.params
    const { role, bankCode } = req.user
    const c = await prisma.case.findUnique({ where: { caseId }, include: { participants: { include: { bank: { select: { bankName: true } } } } } })
    if (!c) return reply.code(404).send({ message: '找不到案件' })
    const isPlatform = role === 'ADMIN' || role === 'PLATFORM_AUDITOR'
    const isMain = c.mainBankCode === bankCode
    const isParticipant = c.participants.some((p) => p.bankCode === bankCode)
    if (!isPlatform && !isMain && !isParticipant) return reply.code(403).send({ message: '權限不足' })
    const seeAll = isPlatform || isMain

    const periods = await prisma.repaymentPeriod.findMany({
      where: { caseId },
      orderBy: { period: 'asc' },
      include: { allocations: { include: { participant: { select: { bankCode: true } } } } },
    })

    // 每期列（依可視範圍過濾各行）
    const periodRows = periods.map((per) => ({
      period: per.period,
      actualReceivedTotal: per.actualReceivedTotal,
      hasRoundingAdjust: per.hasRoundingAdjust,
      recordedAt: per.recordedAt,
      note: per.note,
      allocations: per.allocations
        .filter((a) => seeAll || a.participant.bankCode === bankCode)
        .map((a) => ({ bankCode: a.participant.bankCode, plannedAmount: a.plannedAmount, actualAmount: a.actualAmount, roundingAdjustment: a.roundingAdjustment })),
    }))

    // 各行彙總（累計、剩餘、百分比）
    const visibleParts = c.participants.filter((p) => seeAll || p.bankCode === bankCode)
    const summary = visibleParts.map((p) => {
      let cumPlanned = 0
      let cumActual = 0
      for (const per of periods) {
        const a = per.allocations.find((x) => x.participant.bankCode === p.bankCode)
        if (a) {
          cumPlanned = r4(cumPlanned + num(a.plannedAmount))
          cumActual = r4(cumActual + num(a.actualAmount))
        }
      }
      const claim = num(p.confirmedClaimAmount)
      return {
        bankCode: p.bankCode,
        bankName: p.bank.bankName,
        roleInCase: p.roleInCase,
        planRatio: p.planRatio,
        confirmedClaimAmount: p.confirmedClaimAmount,
        cumulativePlanned: cumPlanned,
        cumulativeActual: cumActual,
        outstanding: r4(claim - cumActual),
        planCompletionPct: cumPlanned > 0 ? r4((cumActual / cumPlanned) * 100) : null,
        debtRecoveryPct: claim > 0 ? r4((cumActual / claim) * 100) : null,
      }
    })

    return { periods: periodRows, summary }
  })

  // POST /:caseId/settle
  app.post('/:caseId/settle', async (req: FastifyRequest<{ Params: { caseId: string } }>, reply) => {
    const { caseId } = req.params
    const c = await assertMain(req, reply, caseId)
    if (!c) return
    if (c.status !== 'IN_REPAYMENT') return reply.code(409).send({ message: '僅還款中的案件可結清' })
    await prisma.case.update({ where: { caseId }, data: { status: 'SETTLED', settledAt: new Date() } })
    const parts = await prisma.caseParticipantBank.findMany({ where: { caseId }, select: { bankCode: true } })
    for (const p of parts) await notifyBankUsers({ bankCode: p.bankCode, type: 'CASE_SETTLED', message: `案件 ${c.docNumber} 已結清`, relatedCaseId: caseId })
    await writeAudit({ actionType: 'CASE_SETTLED', userId: req.user.userId, bankCode: req.user.bankCode, targetType: 'CASE', targetId: caseId, req })
    return { ok: true }
  })

  // POST /:caseId/terminate
  app.post('/:caseId/terminate', async (req: FastifyRequest<{ Params: { caseId: string }; Body: { reason: string } }>, reply) => {
    const { caseId } = req.params
    const c = await assertMain(req, reply, caseId)
    if (!c) return
    if (c.status !== 'IN_REPAYMENT') return reply.code(409).send({ message: '僅還款中的案件可終止' })
    const parsed = z.object({ reason: z.string().min(1) }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ message: '請填寫終止原因' })
    await prisma.case.update({ where: { caseId }, data: { status: 'TERMINATED', terminatedAt: new Date(), terminationReason: parsed.data.reason } })
    const parts = await prisma.caseParticipantBank.findMany({ where: { caseId }, select: { bankCode: true } })
    for (const p of parts) await notifyBankUsers({ bankCode: p.bankCode, type: 'CASE_TERMINATED', message: `案件 ${c.docNumber} 已毀諾／終止`, relatedCaseId: caseId })
    await writeAudit({ actionType: 'CASE_TERMINATED', userId: req.user.userId, bankCode: req.user.bankCode, targetType: 'CASE', targetId: caseId, detail: parsed.data.reason, req })
    return { ok: true }
  })
}
