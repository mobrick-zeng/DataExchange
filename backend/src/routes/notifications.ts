import type { FastifyInstance, FastifyRequest } from 'fastify'
import { prisma } from '../prisma.js'

export async function notificationRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)

  // GET /api/notifications — 我的通知
  app.get('/', async (req) => {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user.userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    const unreadCount = notifications.filter((n) => !n.isRead).length
    return { notifications, unreadCount }
  })

  // POST /api/notifications/:id/read — 標記單筆已讀
  app.post('/:id/read', async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const n = await prisma.notification.findUnique({ where: { notificationId: req.params.id } })
    if (!n || n.userId !== req.user.userId) return reply.code(404).send({ message: '找不到通知' })
    await prisma.notification.update({ where: { notificationId: req.params.id }, data: { isRead: true } })
    return { ok: true }
  })

  // POST /api/notifications/read-all — 全部標記已讀
  app.post('/read-all', async (req) => {
    await prisma.notification.updateMany({ where: { userId: req.user.userId, isRead: false }, data: { isRead: true } })
    return { ok: true }
  })
}
