import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { prisma } from '../prisma.js'
import { requireRole } from '../auth/guard.js'
import { writeAudit } from '../lib/audit.js'
import { mintInvitation } from './invitations.js'

export async function passwordResetRoutes(app: FastifyInstance) {
  // POST /api/auth/request-password-reset — 使用者申請密碼重置（公開；一律通用回應避免洩漏帳號）
  app.post('/auth/request-password-reset', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req: FastifyRequest<{ Body: { bankCode: string; email: string } }>, reply) => {
    const parsed = z.object({ bankCode: z.string().min(1), email: z.string().email() }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ message: '請輸入銀行與 Email' })
    const { bankCode, email } = parsed.data
    const user = await prisma.user.findUnique({ where: { email } })
    if (user && user.approvedBankCode === bankCode && user.accountStatus === 'ACTIVE') {
      const existing = await prisma.passwordResetRequest.findFirst({ where: { userId: user.userId, status: 'PENDING' } })
      if (!existing) await prisma.passwordResetRequest.create({ data: { userId: user.userId, email, bankCode } })
      await writeAudit({ actionType: 'REQUEST_PASSWORD_RESET', userId: user.userId, bankCode, req })
    }
    return { ok: true }
  })

  const adminOnly = { preHandler: [app.authenticate, requireRole('ADMIN')] }

  // GET /api/password-reset-requests — 待處理的密碼重置申請
  app.get('/password-reset-requests', adminOnly, async () => {
    const rows = await prisma.passwordResetRequest.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { name: true } } },
    })
    return { requests: rows.map((r) => ({ requestId: r.requestId, email: r.email, bankCode: r.bankCode, name: r.user.name, createdAt: r.createdAt })) }
  })

  // POST /api/password-reset-requests/:id/issue — 對申請核發重置碼
  app.post('/password-reset-requests/:id/issue', adminOnly, async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const row = await prisma.passwordResetRequest.findUnique({ where: { requestId: req.params.id }, include: { user: true } })
    if (!row) return reply.code(404).send({ message: '找不到申請' })
    if (row.status !== 'PENDING') return reply.code(409).send({ message: '此申請已處理' })
    const minted = await mintInvitation({ email: row.email, bankCode: row.bankCode, role: row.user.role ?? 'BANK_STAFF', purpose: 'PASSWORD_RESET', createdBy: req.user.userId })
    await prisma.passwordResetRequest.update({ where: { requestId: req.params.id }, data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedBy: req.user.userId } })
    await writeAudit({ actionType: 'ISSUE_PASSWORD_RESET', userId: req.user.userId, targetType: 'user', targetId: row.userId, detail: row.email, req })
    return { code: minted.code, registerPath: `/register?code=${encodeURIComponent(minted.code)}`, expiresAt: minted.expiresAt }
  })

  // POST /api/users/:userId/issue-reset — 管理員主動替帳號核發重置碼（免申請）
  app.post('/users/:userId/issue-reset', adminOnly, async (req: FastifyRequest<{ Params: { userId: string } }>, reply) => {
    const u = await prisma.user.findUnique({ where: { userId: req.params.userId } })
    if (!u || !u.approvedBankCode) return reply.code(404).send({ message: '找不到帳號或帳號尚未核准銀行' })
    const minted = await mintInvitation({ email: u.email, bankCode: u.approvedBankCode, role: u.role ?? 'BANK_STAFF', purpose: 'PASSWORD_RESET', createdBy: req.user.userId })
    await writeAudit({ actionType: 'ISSUE_PASSWORD_RESET', userId: req.user.userId, targetType: 'user', targetId: u.userId, detail: u.email, req })
    return { code: minted.code, registerPath: `/register?code=${encodeURIComponent(minted.code)}`, expiresAt: minted.expiresAt }
  })
}
