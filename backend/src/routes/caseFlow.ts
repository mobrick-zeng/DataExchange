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

const DISCLOSED = ['PENDING_OUTCOME', 'ESTABLISHED', 'NOT_ESTABLISHED']
const isTerminal = (s: string) => s === 'ESTABLISHED' || s === 'NOT_ESTABLISHED'

/**
 * 若案件在 PENDING_CONFIRMATION 且所有（未移出）參與行皆已確認，
 * 則一次揭露：凍結彙整表總額、產出各行當輪申報快照、狀態轉 PENDING_OUTCOME。
 * 回傳是否觸發揭露。
 */
async function maybeDisclose(caseId: string): Promise<boolean> {
  const c = await prisma.case.findUnique({
    where: { caseId },
    include: { participants: { where: { removedAt: null }, include: { items: true } } },
  })
  if (!c || c.status !== 'PENDING_CONFIRMATION') return false
  const active = c.participants
  const hasMain = active.some((p) => p.roleInCase === 'MAIN')
  const hasCoBank = active.some((p) => p.roleInCase === 'CO_BANK')
  if (!hasMain || !hasCoBank) return false
  if (!active.every((p) => p.confirmationStatus === 'CONFIRMED')) return false

  const consolidatedTotal = r4(active.reduce((s, p) => s + num(p.confirmedClaimAmount), 0))

  await prisma.$transaction([
    prisma.case.update({
      where: { caseId },
      data: { status: 'PENDING_OUTCOME', disclosedAt: new Date(), consolidatedTotal: new Prisma.Decimal(consolidatedTotal) },
    }),
    prisma.declarationSnapshot.createMany({
      data: active.map((p) => ({
        caseId,
        round: c.round,
        bankCode: p.bankCode,
        roleInCase: p.roleInCase,
        itemsJson: JSON.stringify(
          p.items.map((it) => ({
            claimType: it.claimType,
            principal: num(it.principal),
            interest: num(it.interest),
            penalty: num(it.penalty),
            otherFee: num(it.otherFee),
            note: it.note,
          })),
        ),
        claimTotal: new Prisma.Decimal(num(p.confirmedClaimAmount)),
        confirmedAt: p.confirmedAt,
      })),
    }),
  ])

  for (const p of active) {
    await notifyBankUsers({ bankCode: p.bankCode, type: 'ALL_CONFIRMED_DISCLOSED', message: `案件 ${c.docNumber} 全員已確認並揭露，可檢視債權彙整表`, relatedCaseId: caseId })
  }
  await writeAudit({ actionType: 'CASE_DISCLOSED', targetType: 'CASE', targetId: caseId, detail: `round ${c.round}` })
  return true
}

/** 因疑義／組成變更退回：狀態轉 PENDING_CONFIRMATION、輪次 +1、重置全員確認（保留各行明細供修改）。 */
async function reopenForReconfirm(caseId: string) {
  const c = await prisma.case.findUnique({ where: { caseId } })
  if (!c) return
  await prisma.$transaction([
    prisma.case.update({
      where: { caseId },
      data: { status: 'PENDING_CONFIRMATION', round: c.round + 1, disclosedAt: null, consolidatedTotal: null },
    }),
    prisma.caseParticipantBank.updateMany({
      where: { caseId, removedAt: null },
      data: { confirmationStatus: 'PENDING', confirmedAt: null, confirmedBy: null, confirmedClaimAmount: null },
    }),
  ])
}

/** 確認單一案件（確認自己）。確認當下凍結該行債權金額；可能觸發揭露。 */
type ConfirmResult = { ok: true; disclosed: boolean } | { ok: false; reason: 'NOT_PARTICIPANT' | 'NOT_FOUND' | 'BAD_STATUS' }
async function confirmSelf(caseId: string, userId: string, bankCode: string): Promise<ConfirmResult> {
  const c = await prisma.case.findUnique({ where: { caseId } })
  if (!c) return { ok: false, reason: 'NOT_FOUND' }
  if (c.status !== 'PENDING_CONFIRMATION') return { ok: false, reason: 'BAD_STATUS' }
  const part = await prisma.caseParticipantBank.findUnique({ where: { caseId_bankCode: { caseId, bankCode } }, include: { items: true } })
  if (!part || part.removedAt) return { ok: false, reason: 'NOT_PARTICIPANT' }
  const claim = r4(part.items.reduce((s, it) => s + itemTotal(it), 0))

  await prisma.caseParticipantBank.update({
    where: { participantId: part.participantId },
    data: { confirmationStatus: 'CONFIRMED', confirmedBy: userId, confirmedAt: new Date(), confirmedClaimAmount: new Prisma.Decimal(claim) },
  })
  if (part.roleInCase === 'CO_BANK') {
    await notifyBankUsers({ bankCode: c.mainBankCode, type: 'PARTICIPANT_CONFIRMED', message: `${bankCode} 已確認案件 ${c.docNumber}`, relatedCaseId: caseId })
  }
  const disclosed = await maybeDisclose(caseId)
  return { ok: true, disclosed }
}

export async function caseFlowRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)

  // POST /:caseId/confirm — 確認自己
  app.post('/:caseId/confirm', async (req: FastifyRequest<{ Params: { caseId: string } }>, reply) => {
    const { caseId } = req.params
    const { userId, bankCode } = req.user
    const r = await confirmSelf(caseId, userId, bankCode)
    if (!r.ok) {
      const code = r.reason === 'NOT_FOUND' ? 404 : r.reason === 'BAD_STATUS' ? 409 : 403
      const msg = r.reason === 'NOT_PARTICIPANT' ? '您不是此案件的（有效）參與行' : r.reason === 'BAD_STATUS' ? '案件非於封閉申報階段' : '找不到案件'
      return reply.code(code).send({ message: msg })
    }
    await writeAudit({ actionType: 'CASE_CONFIRMED', userId, bankCode, targetType: 'CASE', targetId: caseId, req })
    return { ok: true, disclosed: r.disclosed }
  })

  // POST /batch-confirm — 一次確認多案（自己）
  app.post('/batch-confirm', async (req: FastifyRequest<{ Body: { caseIds: string[] } }>, reply) => {
    const { userId, bankCode } = req.user
    const parsed = z.object({ caseIds: z.array(z.string()).min(1) }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ message: '請提供 caseIds' })
    const results: Record<string, string> = {}
    for (const caseId of parsed.data.caseIds) {
      const r = await confirmSelf(caseId, userId, bankCode)
      if (r.ok) {
        results[caseId] = r.disclosed ? 'CONFIRMED_AND_DISCLOSED' : 'CONFIRMED'
        await writeAudit({ actionType: 'CASE_CONFIRMED', userId, bankCode, targetType: 'CASE', targetId: caseId, detail: 'batch', req })
      } else results[caseId] = r.reason
    }
    return { results }
  })

  // POST /:caseId/withdraw — 撤回自己的確認（揭露前）
  app.post('/:caseId/withdraw', async (req: FastifyRequest<{ Params: { caseId: string } }>, reply) => {
    const { caseId } = req.params
    const { userId, bankCode } = req.user
    const c = await prisma.case.findUnique({ where: { caseId } })
    if (!c) return reply.code(404).send({ message: '找不到案件' })
    if (c.status !== 'PENDING_CONFIRMATION') return reply.code(409).send({ message: '僅封閉申報階段可撤回確認' })
    const part = await prisma.caseParticipantBank.findUnique({ where: { caseId_bankCode: { caseId, bankCode } } })
    if (!part || part.removedAt) return reply.code(403).send({ message: '您不是此案件的（有效）參與行' })
    if (part.confirmationStatus !== 'CONFIRMED') return reply.code(409).send({ message: '您尚未確認，無需撤回' })

    await prisma.caseParticipantBank.update({
      where: { participantId: part.participantId },
      data: { confirmationStatus: 'PENDING', confirmedAt: null, confirmedBy: null, confirmedClaimAmount: null },
    })
    await writeAudit({ actionType: 'CONFIRMATION_WITHDRAWN', userId, bankCode, targetType: 'CASE', targetId: caseId, req })
    return { ok: true }
  })

  // POST /:caseId/reject — 參與行自行拒絕參與（自行生效即移出）
  app.post('/:caseId/reject', async (req: FastifyRequest<{ Params: { caseId: string }; Body: { reason: string } }>, reply) => {
    const { caseId } = req.params
    const { userId, bankCode } = req.user
    const parsed = z.object({ reason: z.string().min(1) }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ message: '請填寫拒絕參與的理由' })
    const c = await prisma.case.findUnique({ where: { caseId } })
    if (!c) return reply.code(404).send({ message: '找不到案件' })
    if (isTerminal(c.status)) return reply.code(409).send({ message: '案件已結案，不可變更' })
    const part = await prisma.caseParticipantBank.findUnique({ where: { caseId_bankCode: { caseId, bankCode } } })
    if (!part || part.removedAt) return reply.code(403).send({ message: '您不是此案件的（有效）參與行' })
    if (part.roleInCase === 'MAIN') return reply.code(400).send({ message: '主辦不可拒絕參與自己起的案件' })

    await prisma.caseParticipantBank.update({
      where: { participantId: part.participantId },
      data: { removedAt: new Date(), removalKind: 'REJECTED_SELF', removalReason: parsed.data.reason, confirmationStatus: 'PENDING', confirmedAt: null, confirmedBy: null, confirmedClaimAmount: null },
    })
    await notifyBankUsers({ bankCode: c.mainBankCode, type: 'PARTICIPATION_REJECTED', message: `${bankCode} 表示非本案（${c.docNumber}）債權人，已退出`, relatedCaseId: caseId })
    await writeAudit({ actionType: 'PARTICIPATION_REJECTED', userId, bankCode, targetType: 'CASE', targetId: caseId, detail: parsed.data.reason, req })

    // 若已揭露則組成變更→退回重新確認；否則可能因此達成全員確認→揭露
    if (DISCLOSED.includes(c.status)) await reopenForReconfirm(caseId)
    else await maybeDisclose(caseId)
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

  // POST /:caseId/participants/:bankCode/remove — 主辦移出某參與行
  app.post('/:caseId/participants/:bankCode/remove', async (req: FastifyRequest<{ Params: { caseId: string; bankCode: string }; Body: { reason?: string } }>, reply) => {
    const { caseId, bankCode: targetBank } = req.params
    const c = await assertMain(req, reply, caseId)
    if (!c) return
    if (isTerminal(c.status)) return reply.code(409).send({ message: '案件已結案，不可變更' })
    if (targetBank === c.mainBankCode) return reply.code(400).send({ message: '不可移出主辦自身' })
    const reason = (req.body?.reason ?? '').toString()
    const part = await prisma.caseParticipantBank.findUnique({ where: { caseId_bankCode: { caseId, bankCode: targetBank } } })
    if (!part || part.removedAt) return reply.code(404).send({ message: '該銀行未參與此案件' })

    await prisma.caseParticipantBank.update({
      where: { participantId: part.participantId },
      data: { removedAt: new Date(), removalKind: 'REMOVED_BY_MAIN', removalReason: reason || null, confirmationStatus: 'PENDING', confirmedAt: null, confirmedBy: null, confirmedClaimAmount: null },
    })
    await notifyBankUsers({ bankCode: targetBank, type: 'PARTICIPANT_REMOVED', message: `您已被移出案件（${c.docNumber}）`, relatedCaseId: caseId })
    await writeAudit({ actionType: 'PARTICIPANT_REMOVED', userId: req.user.userId, bankCode: req.user.bankCode, targetType: 'CASE', targetId: caseId, detail: `remove ${targetBank}`, req })

    if (DISCLOSED.includes(c.status)) await reopenForReconfirm(caseId)
    else await maybeDisclose(caseId)
    return { ok: true }
  })

  // POST /:caseId/doubt — 揭露後任一參與行標記疑義 → 退回全員重新確認
  app.post('/:caseId/doubt', async (req: FastifyRequest<{ Params: { caseId: string }; Body: { reason: string; pointerBankCode?: string } }>, reply) => {
    const { caseId } = req.params
    const { userId, bankCode } = req.user
    const parsed = z.object({ reason: z.string().min(1), pointerBankCode: z.string().optional() }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ message: '請填寫疑義理由' })
    const c = await prisma.case.findUnique({ where: { caseId } })
    if (!c) return reply.code(404).send({ message: '找不到案件' })
    if (c.status !== 'PENDING_OUTCOME') return reply.code(409).send({ message: '僅已揭露、待回報的案件可標記疑義' })
    const part = await prisma.caseParticipantBank.findUnique({ where: { caseId_bankCode: { caseId, bankCode } } })
    if (!part || part.removedAt) return reply.code(403).send({ message: '您不是此案件的（有效）參與行' })

    await prisma.caseDoubt.create({
      data: { caseId, round: c.round, raisedByBankCode: bankCode, raisedByUserId: userId, reason: parsed.data.reason, pointerBankCode: parsed.data.pointerBankCode || null },
    })
    await reopenForReconfirm(caseId)

    const parts = await prisma.caseParticipantBank.findMany({ where: { caseId, removedAt: null }, select: { bankCode: true } })
    for (const p of parts) {
      await notifyBankUsers({ bankCode: p.bankCode, type: 'REOPENED_FOR_DOUBT', message: `案件 ${c.docNumber} 有疑義，已退回請重新確認`, relatedCaseId: caseId })
    }
    await writeAudit({ actionType: 'DOUBT_RAISED', userId, bankCode, targetType: 'CASE', targetId: caseId, detail: parsed.data.reason, req })
    return { ok: true }
  })

  // POST /:caseId/report — 主辦回報成立/不成立（兩段式確認；系統存證、非裁定）
  app.post('/:caseId/report', async (req: FastifyRequest<{ Params: { caseId: string }; Body: { established: boolean; reason?: string; confirm?: boolean } }>, reply) => {
    const { caseId } = req.params
    const c = await assertMain(req, reply, caseId)
    if (!c) return
    const parsed = z.object({ established: z.boolean(), reason: z.string().optional(), confirm: z.literal(true) }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ message: '需明確二次確認（confirm=true）並指定成立/不成立', issues: parsed.error.issues })
    const { established, reason } = parsed.data

    if (isTerminal(c.status)) return reply.code(409).send({ message: '案件已結案（終態），不可再回報' })
    if (established) {
      if (c.status !== 'PENDING_OUTCOME') return reply.code(409).send({ message: '需全員確認並揭露（PENDING_OUTCOME）後才能回報成立' })
    } else {
      // 不成立：可於封閉申報僵局或已揭露後回報
      if (c.status !== 'PENDING_CONFIRMATION' && c.status !== 'PENDING_OUTCOME') {
        return reply.code(409).send({ message: '此階段不可回報不成立' })
      }
      if (!reason || !reason.trim()) return reply.code(400).send({ message: '回報不成立需填寫理由' })
    }

    await prisma.case.update({
      where: { caseId },
      data: {
        status: established ? 'ESTABLISHED' : 'NOT_ESTABLISHED',
        outcomeReportedAt: new Date(),
        outcomeReportedBy: req.user.userId,
        notEstablishedReason: established ? null : reason!.trim(),
      },
    })
    const parts = await prisma.caseParticipantBank.findMany({ where: { caseId, removedAt: null }, select: { bankCode: true } })
    for (const p of parts) {
      await notifyBankUsers({
        bankCode: p.bankCode,
        type: established ? 'CASE_ESTABLISHED' : 'CASE_NOT_ESTABLISHED',
        message: established ? `案件 ${c.docNumber} 已回報成立` : `案件 ${c.docNumber} 已回報不成立`,
        relatedCaseId: caseId,
      })
    }
    await writeAudit({ actionType: established ? 'CASE_ESTABLISHED' : 'CASE_NOT_ESTABLISHED', userId: req.user.userId, bankCode: req.user.bankCode, targetType: 'CASE', targetId: caseId, fromStatus: c.status, toStatus: established ? 'ESTABLISHED' : 'NOT_ESTABLISHED', detail: reason, req })
    return { ok: true, status: established ? 'ESTABLISHED' : 'NOT_ESTABLISHED' }
  })
}
