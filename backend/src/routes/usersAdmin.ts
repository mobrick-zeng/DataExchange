import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { prisma } from '../prisma.js'
import { requireRole } from '../auth/guard.js'
import { writeAudit } from '../lib/audit.js'
import { mintAccessCode } from '../lib/accessCode.js'

export async function userAdminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)
  app.addHook('preHandler', requireRole('ADMIN'))

  // GET /api/users?status= — 使用者清單
  app.get('/', async (req: FastifyRequest<{ Querystring: { status?: string } }>) => {
    const status = req.query.status
    const users = await prisma.user.findMany({
      where: status ? { accountStatus: status as never } : {},
      orderBy: { createdAt: 'desc' },
      select: {
        userId: true, name: true, email: true, bankCode: true, role: true, accountStatus: true,
        department: true, title: true, createdAt: true, activatedAt: true, lastLoginAt: true, lockedUntil: true,
        consentedAt: true, bank: { select: { bankName: true } },
      },
    })
    return { users: users.map((u) => ({ ...u, bankName: u.bank?.bankName ?? null, bank: undefined })) }
  })

  // GET /api/users/:userId/audit — 該帳號相關稽核歷程
  app.get('/:userId/audit', async (req: FastifyRequest<{ Params: { userId: string } }>) => {
    const logs = await prisma.auditLog.findMany({
      where: { OR: [{ targetType: 'USER', targetId: req.params.userId }, { userId: req.params.userId }] },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
    return { logs }
  })

  // POST /api/users — 建立帳號（PENDING_ACTIVATION）並核發啟用碼（明碼僅回傳一次）
  app.post('/', async (req, reply) => {
    const parsed = z
      .object({
        email: z.string().email(),
        name: z.string().min(1),
        bankCode: z.string().min(1),
        role: z.enum(['ADMIN', 'BANK_STAFF', 'PLATFORM_AUDITOR']),
        department: z.string().optional(),
        title: z.string().optional(),
      })
      .safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ message: '請提供 email、name、bankCode、role' })
    const { email, name, bankCode, role, department, title } = parsed.data

    const bank = await prisma.bank.findUnique({ where: { bankCode } })
    if (!bank || !bank.isActive) return reply.code(400).send({ message: '銀行不存在或未啟用' })
    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) return reply.code(409).send({ message: '此 Email 已有帳號' })

    const user = await prisma.user.create({
      data: { email, name, bankCode, role, department, title, accountStatus: 'PENDING_ACTIVATION' },
    })
    const minted = await mintAccessCode({ userId: user.userId, purpose: 'ACTIVATION', createdBy: req.user.userId })
    await writeAudit({ actionType: 'ACCOUNT_CREATED', userId: req.user.userId, bankCode, targetType: 'USER', targetId: user.userId, toStatus: 'PENDING_ACTIVATION', detail: email, req })
    return { userId: user.userId, email, activationCode: minted.code, expiresAt: minted.expiresAt }
  })

  // POST /api/users/:userId/issue-activation — 重新核發啟用碼
  app.post('/:userId/issue-activation', async (req: FastifyRequest<{ Params: { userId: string } }>, reply) => {
    const u = await prisma.user.findUnique({ where: { userId: req.params.userId } })
    if (!u) return reply.code(404).send({ message: '找不到使用者' })
    if (u.accountStatus !== 'PENDING_ACTIVATION') return reply.code(409).send({ message: '此帳號非待啟用狀態' })
    const minted = await mintAccessCode({ userId: u.userId, purpose: 'ACTIVATION', createdBy: req.user.userId })
    await writeAudit({ actionType: 'ACCOUNT_CREATED', userId: req.user.userId, targetType: 'USER', targetId: u.userId, detail: 're-issue activation', req })
    return { activationCode: minted.code, expiresAt: minted.expiresAt }
  })

  // POST /api/users/:userId/suspend — 停用
  app.post('/:userId/suspend', async (req: FastifyRequest<{ Params: { userId: string }; Body: { reason?: string } }>, reply) => {
    const u = await prisma.user.findUnique({ where: { userId: req.params.userId } })
    if (!u) return reply.code(404).send({ message: '找不到使用者' })
    await prisma.user.update({ where: { userId: u.userId }, data: { accountStatus: 'SUSPENDED' } })
    await writeAudit({ actionType: 'ACCOUNT_SUSPENDED', userId: req.user.userId, targetType: 'USER', targetId: u.userId, fromStatus: u.accountStatus, toStatus: 'SUSPENDED', detail: (req.body as any)?.reason, req })
    return { ok: true }
  })

  // POST /api/users/:userId/reactivate — 復用（僅限已啟用過的帳號）
  app.post('/:userId/reactivate', async (req: FastifyRequest<{ Params: { userId: string } }>, reply) => {
    const u = await prisma.user.findUnique({ where: { userId: req.params.userId } })
    if (!u) return reply.code(404).send({ message: '找不到使用者' })
    if (u.accountStatus !== 'SUSPENDED') return reply.code(409).send({ message: '僅停用中的帳號可復用' })
    await prisma.user.update({ where: { userId: u.userId }, data: { accountStatus: 'ACTIVE' } })
    await writeAudit({ actionType: 'ACCOUNT_REACTIVATED', userId: req.user.userId, targetType: 'USER', targetId: u.userId, fromStatus: 'SUSPENDED', toStatus: 'ACTIVE', req })
    return { ok: true }
  })

  // POST /api/users/:userId/unlock — 解除登入鎖定
  app.post('/:userId/unlock', async (req: FastifyRequest<{ Params: { userId: string } }>, reply) => {
    const u = await prisma.user.findUnique({ where: { userId: req.params.userId } })
    if (!u) return reply.code(404).send({ message: '找不到使用者' })
    await prisma.user.update({ where: { userId: u.userId }, data: { failedLoginCount: 0, lockedUntil: null } })
    await writeAudit({ actionType: 'ACCOUNT_UNLOCKED', userId: req.user.userId, targetType: 'USER', targetId: u.userId, req })
    return { ok: true }
  })
}
