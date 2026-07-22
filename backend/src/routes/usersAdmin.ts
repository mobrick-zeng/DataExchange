import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { prisma } from '../prisma.js'
import { requireRole } from '../auth/guard.js'
import { writeAudit } from '../lib/audit.js'
import { notifyUser } from '../lib/notify.js'

export async function userAdminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)
  app.addHook('preHandler', requireRole('ADMIN'))

  // GET /api/users?status= — 使用者清單（可篩狀態）
  app.get('/', async (req: FastifyRequest<{ Querystring: { status?: string } }>) => {
    const status = req.query.status
    const users = await prisma.user.findMany({
      where: status ? { accountStatus: status as never } : {},
      orderBy: { createdAt: 'desc' },
      select: {
        userId: true, name: true, email: true, appliedBankCode: true, approvedBankCode: true,
        role: true, accountStatus: true, department: true, title: true, createdAt: true, lockedUntil: true,
      },
    })
    return { users }
  })

  // GET /api/users/:userId/approval-logs — 審核歷程
  app.get('/:userId/approval-logs', async (req: FastifyRequest<{ Params: { userId: string } }>) => {
    const logs = await prisma.accountApprovalLog.findMany({
      where: { userId: req.params.userId },
      orderBy: { createdAt: 'asc' },
    })
    return { logs }
  })

  async function changeStatus(
    req: FastifyRequest,
    userId: string,
    newStatus: 'ACTIVE' | 'REJECTED' | 'SUSPENDED',
    action: 'APPROVE' | 'REJECT' | 'SUSPEND' | 'REACTIVATE',
    auditType: 'ACCOUNT_APPROVED' | 'ACCOUNT_REJECTED' | 'ACCOUNT_SUSPENDED' | 'ACCOUNT_REACTIVATED',
    extra?: { role?: string; approvedBankCode?: string; reason?: string },
  ) {
    const target = await prisma.user.findUnique({ where: { userId } })
    if (!target) return null
    const previousStatus = target.accountStatus

    await prisma.$transaction([
      prisma.user.update({
        where: { userId },
        data: {
          accountStatus: newStatus,
          ...(extra?.role ? { role: extra.role as never } : {}),
          ...(extra?.approvedBankCode ? { approvedBankCode: extra.approvedBankCode } : {}),
        },
      }),
      prisma.accountApprovalLog.create({
        data: { userId, action, performedBy: req.user.userId, previousStatus, newStatus, reason: extra?.reason },
      }),
    ])
    await writeAudit({ actionType: auditType, userId: req.user.userId, targetType: 'user', targetId: userId, detail: extra?.reason, req })
    return target
  }

  // POST /api/users/:userId/approve — 核准（指派角色與正式銀行）
  app.post('/:userId/approve', async (req: FastifyRequest<{ Params: { userId: string } }>, reply) => {
    const parsed = z.object({ role: z.enum(['BANK_STAFF', 'VIEWER', 'PLATFORM_AUDITOR', 'ADMIN']), approvedBankCode: z.string().min(1) }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ message: '請提供 role 與 approvedBankCode' })
    const t = await changeStatus(req, req.params.userId, 'ACTIVE', 'APPROVE', 'ACCOUNT_APPROVED', parsed.data)
    if (!t) return reply.code(404).send({ message: '找不到使用者' })
    await notifyUser({ userId: req.params.userId, type: 'ACCOUNT_APPROVED', message: '您的帳號已核准，可以登入使用。' })
    return { ok: true }
  })

  // POST /api/users/:userId/reject — 駁回
  app.post('/:userId/reject', async (req: FastifyRequest<{ Params: { userId: string }; Body: { reason: string } }>, reply) => {
    const parsed = z.object({ reason: z.string().min(1) }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ message: '請填寫駁回原因' })
    const t = await changeStatus(req, req.params.userId, 'REJECTED', 'REJECT', 'ACCOUNT_REJECTED', { reason: parsed.data.reason })
    if (!t) return reply.code(404).send({ message: '找不到使用者' })
    await notifyUser({ userId: req.params.userId, type: 'ACCOUNT_REJECTED', message: `您的註冊申請已被駁回：${parsed.data.reason}` })
    return { ok: true }
  })

  // POST /api/users/:userId/suspend — 停用
  app.post('/:userId/suspend', async (req: FastifyRequest<{ Params: { userId: string }; Body: { reason?: string } }>, reply) => {
    const reason = (req.body as { reason?: string })?.reason
    const t = await changeStatus(req, req.params.userId, 'SUSPENDED', 'SUSPEND', 'ACCOUNT_SUSPENDED', { reason })
    if (!t) return reply.code(404).send({ message: '找不到使用者' })
    return { ok: true }
  })

  // POST /api/users/:userId/unlock — 解除帳號鎖定
  app.post('/:userId/unlock', async (req: FastifyRequest<{ Params: { userId: string } }>, reply) => {
    const t = await prisma.user.findUnique({ where: { userId: req.params.userId } })
    if (!t) return reply.code(404).send({ message: '找不到使用者' })
    await prisma.user.update({ where: { userId: req.params.userId }, data: { failedLoginCount: 0, lockedUntil: null } })
    await writeAudit({ actionType: 'ACCOUNT_UNLOCKED', userId: req.user.userId, targetType: 'user', targetId: req.params.userId, req })
    return { ok: true }
  })

  // POST /api/users/:userId/reactivate — 重新啟用
  app.post('/:userId/reactivate', async (req: FastifyRequest<{ Params: { userId: string } }>, reply) => {
    const t = await changeStatus(req, req.params.userId, 'ACTIVE', 'REACTIVATE', 'ACCOUNT_REACTIVATED')
    if (!t) return reply.code(404).send({ message: '找不到使用者' })
    await notifyUser({ userId: req.params.userId, type: 'ACCOUNT_APPROVED', message: '您的帳號已重新啟用。' })
    return { ok: true }
  })
}
