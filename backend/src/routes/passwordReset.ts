import type { FastifyInstance, FastifyRequest } from 'fastify'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '../prisma.js'
import { requireRole } from '../auth/guard.js'
import { writeAudit } from '../lib/audit.js'
import { mintAccessCode, verifyAccessCode, markAccessCodeUsed } from '../lib/accessCode.js'

export async function passwordResetRoutes(app: FastifyInstance) {
  // POST /api/auth/request-password-reset — 使用者申請（公開；一律通用回應避免洩漏帳號）
  app.post('/auth/request-password-reset', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req: FastifyRequest<{ Body: { bankCode: string; email: string } }>, reply) => {
    const parsed = z.object({ bankCode: z.string().min(1), email: z.string().email() }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ message: '請輸入銀行與 Email' })
    const { bankCode, email } = parsed.data
    const user = await prisma.user.findUnique({ where: { email } })
    if (user && user.bankCode === bankCode && user.accountStatus === 'ACTIVE') {
      const existing = await prisma.passwordResetRequest.findFirst({ where: { userId: user.userId, status: 'PENDING' } })
      if (!existing) await prisma.passwordResetRequest.create({ data: { userId: user.userId } })
      await writeAudit({ actionType: 'PASSWORD_RESET_REQUESTED', userId: user.userId, bankCode, req })
    }
    return { ok: true }
  })

  // POST /api/auth/reset-password — 憑重置碼設定新密碼（公開）
  app.post('/auth/reset-password', { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (req: FastifyRequest<{ Body: { bankCode: string; email: string; code: string; password: string } }>, reply) => {
    const parsed = z.object({ bankCode: z.string().min(1), email: z.string().email(), code: z.string().min(1), password: z.string().min(8, '密碼至少 8 碼') }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ message: parsed.error.issues[0]?.message ?? '輸入格式不正確' })
    const { bankCode, email, code, password } = parsed.data
    const user = await prisma.user.findUnique({ where: { email } })
    if (!user || user.bankCode !== bankCode || user.accountStatus !== 'ACTIVE') {
      return reply.code(400).send({ message: '重置資訊不正確' })
    }
    const codeId = await verifyAccessCode(user.userId, 'PASSWORD_RESET', code)
    if (!codeId) return reply.code(400).send({ message: '重置碼無效或已過期' })

    const passwordHash = await bcrypt.hash(password, 10)
    await prisma.$transaction([
      prisma.user.update({ where: { userId: user.userId }, data: { passwordHash, failedLoginCount: 0, lockedUntil: null } }),
      prisma.passwordResetRequest.updateMany({ where: { userId: user.userId, status: 'PENDING' }, data: { status: 'RESOLVED', resolvedAt: new Date() } }),
    ])
    await markAccessCodeUsed(codeId)
    await writeAudit({ actionType: 'PASSWORD_CHANGED', userId: user.userId, bankCode, targetType: 'USER', targetId: user.userId, req })
    return { ok: true }
  })

  const adminOnly = { preHandler: [app.authenticate, requireRole('ADMIN')] }

  // GET /api/password-reset-requests — 待處理申請
  app.get('/password-reset-requests', adminOnly, async () => {
    const rows = await prisma.passwordResetRequest.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { name: true, email: true, bankCode: true } } },
    })
    return { requests: rows.map((r) => ({ requestId: r.requestId, userId: r.userId, name: r.user.name, email: r.user.email, bankCode: r.user.bankCode, createdAt: r.createdAt })) }
  })

  // POST /api/password-reset-requests/:id/issue — 對申請核發重置碼
  app.post('/password-reset-requests/:id/issue', adminOnly, async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const row = await prisma.passwordResetRequest.findUnique({ where: { requestId: req.params.id } })
    if (!row) return reply.code(404).send({ message: '找不到申請' })
    if (row.status !== 'PENDING') return reply.code(409).send({ message: '此申請已處理' })
    const minted = await mintAccessCode({ userId: row.userId, purpose: 'PASSWORD_RESET', createdBy: req.user.userId })
    await prisma.passwordResetRequest.update({ where: { requestId: req.params.id }, data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedBy: req.user.userId } })
    await writeAudit({ actionType: 'PASSWORD_RESET_ISSUED', userId: req.user.userId, targetType: 'USER', targetId: row.userId, req })
    return { resetCode: minted.code, expiresAt: minted.expiresAt }
  })

  // POST /api/users/:userId/issue-reset — 管理員主動核發重置碼
  app.post('/users/:userId/issue-reset', adminOnly, async (req: FastifyRequest<{ Params: { userId: string } }>, reply) => {
    const u = await prisma.user.findUnique({ where: { userId: req.params.userId } })
    if (!u) return reply.code(404).send({ message: '找不到帳號' })
    if (u.accountStatus !== 'ACTIVE') return reply.code(409).send({ message: '僅已啟用帳號可核發重置碼' })
    const minted = await mintAccessCode({ userId: u.userId, purpose: 'PASSWORD_RESET', createdBy: req.user.userId })
    await writeAudit({ actionType: 'PASSWORD_RESET_ISSUED', userId: req.user.userId, targetType: 'USER', targetId: u.userId, req })
    return { resetCode: minted.code, expiresAt: minted.expiresAt }
  })
}
