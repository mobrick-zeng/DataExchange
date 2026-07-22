import type { FastifyInstance, FastifyRequest } from 'fastify'
import { prisma } from '../prisma.js'
import { requireRole } from '../auth/guard.js'

export async function auditRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)
  // 稽核紀錄僅平台管理員與平台稽核可查
  app.addHook('preHandler', requireRole('ADMIN', 'PLATFORM_AUDITOR'))

  // GET /api/audit-logs?actionType=&bankCode=&from=&to=&limit=
  app.get('/', async (req: FastifyRequest<{ Querystring: { actionType?: string; bankCode?: string; from?: string; to?: string; limit?: string } }>) => {
    const q = req.query
    const where: Record<string, unknown> = {}
    if (q.actionType) where.actionType = q.actionType
    if (q.bankCode) where.bankCode = q.bankCode
    if (q.from || q.to) {
      where.createdAt = {
        ...(q.from ? { gte: new Date(q.from) } : {}),
        ...(q.to ? { lte: new Date(q.to) } : {}),
      }
    }
    const limit = Math.min(Number(q.limit ?? 200), 500)
    const logs = await prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { user: { select: { name: true } } },
    })
    return {
      logs: logs.map((l) => ({
        logId: l.logId,
        actionType: l.actionType,
        userName: l.user?.name ?? null,
        bankCode: l.bankCode,
        targetType: l.targetType,
        targetId: l.targetId,
        fromStatus: l.fromStatus,
        toStatus: l.toStatus,
        detail: l.detail,
        ipAddress: l.ipAddress,
        createdAt: l.createdAt,
      })),
    }
  })
}
