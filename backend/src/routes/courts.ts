import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { prisma } from '../prisma.js'
import { requireRole } from '../auth/guard.js'
import { writeAudit } from '../lib/audit.js'

export async function courtRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)

  // GET /api/courts?activeOnly=1 — 法院清單
  app.get('/', async (req: FastifyRequest<{ Querystring: { activeOnly?: string } }>) => {
    const activeOnly = req.query.activeOnly === '1' || req.query.activeOnly === 'true'
    const courts = await prisma.court.findMany({
      where: activeOnly ? { isActive: true } : {},
      orderBy: { courtCode: 'asc' },
    })
    return { courts }
  })

  // PATCH /api/courts/:courtCode — 啟用/停用（僅 ADMIN）
  app.patch<{ Params: { courtCode: string }; Body: { isActive: boolean } }>('/:courtCode', { preHandler: [requireRole('ADMIN')] }, async (req, reply) => {
    const parsed = z.object({ isActive: z.boolean() }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ message: '請提供 isActive' })
    const court = await prisma.court.findUnique({ where: { courtCode: req.params.courtCode } })
    if (!court) return reply.code(404).send({ message: '找不到法院' })
    await prisma.court.update({ where: { courtCode: req.params.courtCode }, data: { isActive: parsed.data.isActive } })
    await writeAudit({
      actionType: parsed.data.isActive ? 'COURT_ACTIVATED' : 'COURT_DEACTIVATED',
      userId: req.user.userId, targetType: 'COURT', targetId: req.params.courtCode, req,
    })
    return { ok: true }
  })
}
