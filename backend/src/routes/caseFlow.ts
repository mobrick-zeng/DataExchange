import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { prisma } from '../prisma.js'
import { writeAudit } from '../lib/audit.js'
import { notifyBankUsers } from '../lib/notify.js'

/** 確認單一案件（供單筆與批次共用）。回傳是否全部確認完成。 */
type ConfirmResult = { ok: true; allConfirmed: boolean } | { ok: false; reason: 'NOT_CO_BANK' | 'NOT_FOUND' }

async function confirmOne(caseId: string, userId: string, bankCode: string): Promise<ConfirmResult> {
  const part = await prisma.caseParticipantBank.findUnique({ where: { caseId_bankCode: { caseId, bankCode } } })
  if (!part || part.roleInCase !== 'CO_BANK') return { ok: false, reason: 'NOT_CO_BANK' as const }

  await prisma.caseParticipantBank.update({
    where: { caseId_bankCode: { caseId, bankCode } },
    data: { confirmationStatus: 'CONFIRMED', confirmedBy: userId, confirmedAt: new Date(), disputeReason: null, disputedAt: null },
  })
  const c = await prisma.case.findUnique({ where: { caseId } })
  if (!c) return { ok: false, reason: 'NOT_FOUND' as const }

  await notifyBankUsers({ bankCode: c.mainBankCode, type: 'CASE_CONFIRMED_BY_BANK', message: `${bankCode} 已確認案件 ${c.caseNumber}`, relatedCaseId: caseId })

  const remaining = await prisma.caseParticipantBank.count({ where: { caseId, roleInCase: 'CO_BANK', confirmationStatus: { not: 'CONFIRMED' } } })
  const allConfirmed = remaining === 0
  if (allConfirmed && c.status === 'PENDING_CONFIRMATION') {
    await prisma.case.update({ where: { caseId }, data: { status: 'IN_REPAYMENT' } })
    await notifyBankUsers({ bankCode: c.mainBankCode, type: 'ALL_BANKS_CONFIRMED', message: `案件 ${c.caseNumber} 全部債權行已確認，進入還款中`, relatedCaseId: caseId })
  }
  return { ok: true, allConfirmed }
}

export async function caseFlowRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)

  // POST /:caseId/confirm — 其他債權行確認收到且無誤
  app.post('/:caseId/confirm', async (req: FastifyRequest<{ Params: { caseId: string } }>, reply) => {
    const { caseId } = req.params
    const { userId, bankCode } = req.user
    if (!bankCode) return reply.code(403).send({ message: '權限不足' })
    const r = await confirmOne(caseId, userId, bankCode)
    if (!r.ok) return reply.code(r.reason === 'NOT_FOUND' ? 404 : 403).send({ message: r.reason === 'NOT_CO_BANK' ? '您不是此案件的其他債權行' : '找不到案件' })
    await writeAudit({ actionType: 'CONFIRM_CASE_RECEIPT', userId, bankCode, targetType: 'case', targetId: caseId, req })
    return { ok: true, allConfirmed: r.allConfirmed }
  })

  // POST /batch-confirm — 批次確認多個案件
  app.post('/batch-confirm', async (req: FastifyRequest<{ Body: { caseIds: string[] } }>, reply) => {
    const { userId, bankCode } = req.user
    if (!bankCode) return reply.code(403).send({ message: '權限不足' })
    const parsed = z.object({ caseIds: z.array(z.string()).min(1) }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ message: '請提供 caseIds' })

    const results: Record<string, string> = {}
    for (const caseId of parsed.data.caseIds) {
      const r = await confirmOne(caseId, userId, bankCode)
      if (r.ok) {
        results[caseId] = 'CONFIRMED'
        await writeAudit({ actionType: 'CONFIRM_CASE_RECEIPT', userId, bankCode, targetType: 'case', targetId: caseId, detail: 'batch', req })
      } else {
        results[caseId] = r.reason
      }
    }
    return { results }
  })

  // POST /:caseId/dispute — 其他債權行回報異議
  app.post('/:caseId/dispute', async (req: FastifyRequest<{ Params: { caseId: string }; Body: { reason: string } }>, reply) => {
    const { caseId } = req.params
    const { userId, bankCode } = req.user
    const parsed = z.object({ reason: z.string().min(1) }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ message: '請填寫異議原因' })
    if (!bankCode) return reply.code(403).send({ message: '權限不足' })

    const part = await prisma.caseParticipantBank.findUnique({ where: { caseId_bankCode: { caseId, bankCode } } })
    if (!part || part.roleInCase !== 'CO_BANK') return reply.code(403).send({ message: '您不是此案件的其他債權行' })

    await prisma.caseParticipantBank.update({
      where: { caseId_bankCode: { caseId, bankCode } },
      data: { confirmationStatus: 'DISPUTED', disputeReason: parsed.data.reason, disputedAt: new Date(), confirmedAt: null, confirmedBy: null },
    })
    const c = await prisma.case.findUnique({ where: { caseId } })
    if (c) await notifyBankUsers({ bankCode: c.mainBankCode, type: 'CASE_DISPUTED_BY_BANK', message: `${bankCode} 對案件 ${c.caseNumber} 回報異議`, relatedCaseId: caseId })
    await writeAudit({ actionType: 'DISPUTE_CASE', userId, bankCode, targetType: 'case', targetId: caseId, detail: parsed.data.reason, req })
    return { ok: true }
  })

  // 共用：主辦銀行檢查
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

  // POST /:caseId/repayments — 記錄本期各行還款（僅還款中）
  app.post('/:caseId/repayments', async (req: FastifyRequest<{ Params: { caseId: string } }>, reply) => {
    const { caseId } = req.params
    const c = await assertMain(req, reply, caseId)
    if (!c) return
    if (c.status !== 'IN_REPAYMENT') return reply.code(409).send({ message: '案件需在「還款中」才能登記還款' })
    const parsed = z
      .object({
        period: z.string().regex(/^\d{4}-\d{2}$/, '期別格式須為 YYYY-MM'),
        records: z.array(z.object({ bankCode: z.string(), periodRepaid: z.number().default(0), outstandingBalance: z.number().default(0), note: z.string().optional() })).min(1),
      })
      .safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ message: '輸入格式不正確', issues: parsed.error.issues })
    const { period, records } = parsed.data

    for (const r of records) {
      await prisma.repaymentRecord.upsert({
        where: { caseId_bankCode_period: { caseId, bankCode: r.bankCode, period } },
        create: { caseId, bankCode: r.bankCode, period, periodRepaid: r.periodRepaid, outstandingBalance: r.outstandingBalance, note: r.note, recordedBy: req.user.userId },
        update: { periodRepaid: r.periodRepaid, outstandingBalance: r.outstandingBalance, note: r.note, recordedBy: req.user.userId, recordedAt: new Date() },
      })
    }
    const coBanks = await prisma.caseParticipantBank.findMany({ where: { caseId, roleInCase: 'CO_BANK' }, select: { bankCode: true } })
    for (const cb of coBanks) {
      await notifyBankUsers({ bankCode: cb.bankCode, type: 'REPAYMENT_UPDATED', message: `案件 ${c.caseNumber} ${period} 還款已更新`, relatedCaseId: caseId })
    }
    await writeAudit({ actionType: 'RECORD_REPAYMENT', userId: req.user.userId, bankCode: req.user.bankCode, targetType: 'case', targetId: caseId, detail: period, req })
    return { ok: true, period }
  })

  // GET /:caseId/repayments — 還款紀錄（其他債權行僅見本行）
  app.get('/:caseId/repayments', async (req: FastifyRequest<{ Params: { caseId: string } }>, reply) => {
    const { caseId } = req.params
    const { role, bankCode } = req.user
    const c = await prisma.case.findUnique({ where: { caseId }, include: { participants: { select: { bankCode: true } } } })
    if (!c) return reply.code(404).send({ message: '找不到案件' })
    const isPlatform = role === 'ADMIN' || role === 'PLATFORM_AUDITOR'
    const isMain = c.mainBankCode === bankCode
    const isParticipant = c.participants.some((p) => p.bankCode === bankCode)
    if (!isPlatform && !isMain && !isParticipant) return reply.code(403).send({ message: '權限不足' })

    const seeAll = isPlatform || isMain
    const records = await prisma.repaymentRecord.findMany({
      where: seeAll ? { caseId } : { caseId, bankCode: bankCode ?? '__none__' },
      orderBy: [{ period: 'asc' }, { bankCode: 'asc' }],
    })
    return { records }
  })

  // POST /:caseId/settle — 結清
  app.post('/:caseId/settle', async (req: FastifyRequest<{ Params: { caseId: string } }>, reply) => {
    const { caseId } = req.params
    const c = await assertMain(req, reply, caseId)
    if (!c) return
    if (c.status !== 'IN_REPAYMENT') return reply.code(409).send({ message: '僅還款中的案件可結清' })
    await prisma.case.update({ where: { caseId }, data: { status: 'SETTLED', settledAt: new Date() } })
    const parts = await prisma.caseParticipantBank.findMany({ where: { caseId }, select: { bankCode: true } })
    for (const p of parts) await notifyBankUsers({ bankCode: p.bankCode, type: 'CASE_SETTLED', message: `案件 ${c.caseNumber} 已結清`, relatedCaseId: caseId })
    await writeAudit({ actionType: 'SETTLE_CASE', userId: req.user.userId, bankCode: req.user.bankCode, targetType: 'case', targetId: caseId, req })
    return { ok: true }
  })

  // POST /:caseId/terminate — 毀諾／終止
  app.post('/:caseId/terminate', async (req: FastifyRequest<{ Params: { caseId: string }; Body: { reason: string } }>, reply) => {
    const { caseId } = req.params
    const c = await assertMain(req, reply, caseId)
    if (!c) return
    if (c.status !== 'IN_REPAYMENT') return reply.code(409).send({ message: '僅還款中的案件可終止' })
    const parsed = z.object({ reason: z.string().min(1) }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ message: '請填寫終止原因' })
    await prisma.case.update({ where: { caseId }, data: { status: 'TERMINATED', terminatedAt: new Date(), terminationReason: parsed.data.reason } })
    const parts = await prisma.caseParticipantBank.findMany({ where: { caseId }, select: { bankCode: true } })
    for (const p of parts) await notifyBankUsers({ bankCode: p.bankCode, type: 'CASE_TERMINATED', message: `案件 ${c.caseNumber} 已毀諾／終止`, relatedCaseId: caseId })
    await writeAudit({ actionType: 'TERMINATE_CASE', userId: req.user.userId, bankCode: req.user.bankCode, targetType: 'case', targetId: caseId, detail: parsed.data.reason, req })
    return { ok: true }
  })
}
