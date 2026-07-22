import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { prisma } from '../prisma.js'
import { requireRole } from '../auth/guard.js'
import { writeAudit } from '../lib/audit.js'

export async function bankRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)

  // GET /api/banks?activeOnly=1 — 機構清單（下拉/邀請用 activeOnly；後台管理列全部）
  app.get('/', async (req: FastifyRequest<{ Querystring: { activeOnly?: string } }>) => {
    const activeOnly = req.query.activeOnly === '1' || req.query.activeOnly === 'true'
    const banks = await prisma.bank.findMany({
      where: activeOnly ? { isActive: true } : {},
      orderBy: { bankCode: 'asc' },
    })
    return { banks }
  })

  // PATCH /api/banks/:bankCode — 啟用/停用（僅 ADMIN）
  app.patch<{ Params: { bankCode: string }; Body: { isActive: boolean } }>('/:bankCode', { preHandler: [requireRole('ADMIN')] }, async (req, reply) => {
    const parsed = z.object({ isActive: z.boolean() }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ message: '請提供 isActive' })
    const bank = await prisma.bank.findUnique({ where: { bankCode: req.params.bankCode } })
    if (!bank) return reply.code(404).send({ message: '找不到機構' })
    await prisma.bank.update({ where: { bankCode: req.params.bankCode }, data: { isActive: parsed.data.isActive } })
    await writeAudit({
      actionType: parsed.data.isActive ? 'BANK_ACTIVATED' : 'BANK_DEACTIVATED',
      userId: req.user.userId, targetType: 'BANK', targetId: req.params.bankCode, req,
    })
    return { ok: true }
  })
}
