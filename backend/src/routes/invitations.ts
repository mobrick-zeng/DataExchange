import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { InvitationPurpose, Role } from '@prisma/client'
import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '../prisma.js'
import { requireRole } from '../auth/guard.js'
import { writeAudit } from '../lib/audit.js'

const INVITE_TTL_MS = 3 * 24 * 60 * 60 * 1000 // 3 天

/** 產生一次性邀請碼並建立 Invitation（新帳號或密碼重置共用）；回傳明碼碼（僅此一次） */
export async function mintInvitation(data: { email: string; bankCode: string; role: Role; purpose: InvitationPurpose; createdBy: string }) {
  const secret = randomBytes(18).toString('base64url')
  const codeHash = await bcrypt.hash(secret, 10)
  const inv = await prisma.invitation.create({ data: { ...data, codeHash, expiresAt: new Date(Date.now() + INVITE_TTL_MS) } })
  return { invitationId: inv.invitationId, code: `${inv.invitationId}.${secret}`, expiresAt: inv.expiresAt }
}

/** 解析邀請碼（格式：invitationId.secret），驗證有效性 */
type InviteWithBank = NonNullable<Awaited<ReturnType<typeof findInvite>>>
function findInvite(invitationId: string) {
  return prisma.invitation.findUnique({ where: { invitationId }, include: { bank: { select: { bankName: true } } } })
}

async function resolveInvite(
  code: string,
): Promise<{ error: keyof typeof ERROR_MSG; inv: null } | { error: null; inv: InviteWithBank }> {
  const idx = code.indexOf('.')
  if (idx < 0) return { error: 'INVALID', inv: null }
  const invitationId = code.slice(0, idx)
  const secret = code.slice(idx + 1)
  const inv = await findInvite(invitationId)
  if (!inv) return { error: 'INVALID', inv: null }
  if (inv.status === 'REVOKED') return { error: 'REVOKED', inv: null }
  if (inv.status === 'ACCEPTED') return { error: 'USED', inv: null }
  if (inv.expiresAt.getTime() < Date.now()) return { error: 'EXPIRED', inv: null }
  const ok = await bcrypt.compare(secret, inv.codeHash)
  if (!ok) return { error: 'INVALID', inv: null }
  return { error: null, inv }
}

const ERROR_MSG = {
  INVALID: '邀請碼無效',
  REVOKED: '此邀請已被撤銷',
  USED: '此邀請碼已使用過',
  EXPIRED: '邀請碼已過期（效期 3 天）',
} as const

export async function invitationRoutes(app: FastifyInstance) {
  // ---- 管理員：建立 / 列表 / 撤銷 ----
  const adminOnly = { preHandler: [app.authenticate, requireRole('ADMIN')] }

  // POST /api/invitations — 建立邀請（回傳一次性邀請碼與註冊連結）
  app.post('/', adminOnly, async (req, reply) => {
    const parsed = z
      .object({ email: z.string().email(), bankCode: z.string().min(1), role: z.enum(['BANK_STAFF', 'VIEWER', 'PLATFORM_AUDITOR', 'ADMIN']) })
      .safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ message: '請提供 email、bankCode、role' })
    const { email, bankCode, role } = parsed.data

    const bank = await prisma.bank.findUnique({ where: { bankCode } })
    if (!bank) return reply.code(404).send({ message: '銀行不存在' })
    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) return reply.code(409).send({ message: '此 Email 已有帳號' })

    const minted = await mintInvitation({ email, bankCode, role, purpose: 'NEW_ACCOUNT', createdBy: req.user.userId })
    await writeAudit({ actionType: 'CREATE_INVITATION', userId: req.user.userId, targetType: 'invitation', targetId: minted.invitationId, detail: email, req })
    return { invitationId: minted.invitationId, code: minted.code, registerPath: `/register?code=${encodeURIComponent(minted.code)}`, expiresAt: minted.expiresAt }
  })

  // GET /api/invitations — 邀請列表
  app.get('/', adminOnly, async () => {
    const list = await prisma.invitation.findMany({ orderBy: { createdAt: 'desc' }, include: { bank: { select: { bankName: true } } } })
    const now = Date.now()
    return {
      invitations: list.map((i) => ({
        invitationId: i.invitationId,
        email: i.email,
        bankCode: i.bankCode,
        bankName: i.bank.bankName,
        role: i.role,
        status: i.status === 'PENDING' && i.expiresAt.getTime() < now ? 'EXPIRED' : i.status,
        expiresAt: i.expiresAt,
        createdAt: i.createdAt,
      })),
    }
  })

  // POST /api/invitations/:id/revoke — 撤銷
  app.post('/:id/revoke', adminOnly, async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const inv = await prisma.invitation.findUnique({ where: { invitationId: req.params.id } })
    if (!inv) return reply.code(404).send({ message: '找不到邀請' })
    if (inv.status !== 'PENDING') return reply.code(409).send({ message: '僅待使用的邀請可撤銷' })
    await prisma.invitation.update({ where: { invitationId: req.params.id }, data: { status: 'REVOKED' } })
    await writeAudit({ actionType: 'REVOKE_INVITATION', userId: req.user.userId, targetType: 'invitation', targetId: req.params.id, req })
    return { ok: true }
  })

  // ---- 公開（未登入即可呼叫）：驗證 / 完成註冊 ----

  // POST /api/invitations/validate — 驗證邀請碼，回傳預填資訊
  app.post('/validate', { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (req: FastifyRequest<{ Body: { code: string } }>, reply) => {
    const code = req.body?.code
    if (!code) return reply.code(400).send({ message: '請提供邀請碼' })
    const r = await resolveInvite(code)
    if (r.error) return reply.code(400).send({ message: ERROR_MSG[r.error] })
    return { email: r.inv.email, bankCode: r.inv.bankCode, bankName: r.inv.bank.bankName, role: r.inv.role, purpose: r.inv.purpose }
  })

  // POST /api/invitations/accept — 憑邀請碼完成註冊
  app.post('/accept', { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (req: FastifyRequest<{ Body: { code: string; name: string; password: string } }>, reply) => {
    const parsed = z.object({ code: z.string().min(1), name: z.string().min(1), password: z.string().min(8, '密碼至少 8 碼') }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ message: parsed.error.issues[0]?.message ?? '輸入格式不正確' })
    const { code, name, password } = parsed.data

    const r = await resolveInvite(code)
    if (r.error) return reply.code(400).send({ message: ERROR_MSG[r.error] })
    const inv = r.inv
    if (inv.purpose !== 'NEW_ACCOUNT') return reply.code(400).send({ message: '此邀請碼為密碼重置用途，請改用重設密碼流程' })

    const existing = await prisma.user.findUnique({ where: { email: inv.email } })
    if (existing) return reply.code(409).send({ message: '此 Email 已註冊，請直接登入' })

    const passwordHash = await bcrypt.hash(password, 10)
    const user = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          email: inv.email,
          name,
          passwordHash,
          appliedBankCode: inv.bankCode,
          approvedBankCode: inv.bankCode,
          role: inv.role,
          accountStatus: 'ACTIVE',
          emailVerifiedAt: new Date(),
        },
      })
      await tx.invitation.update({ where: { invitationId: inv.invitationId }, data: { status: 'ACCEPTED', acceptedUserId: u.userId, acceptedAt: new Date() } })
      await tx.accountApprovalLog.create({ data: { userId: u.userId, action: 'APPROVE', performedBy: inv.createdBy, previousStatus: null, newStatus: 'ACTIVE', reason: '邀請制註冊' } })
      return u
    })
    await writeAudit({ actionType: 'ACCEPT_INVITATION', userId: user.userId, bankCode: inv.bankCode, targetType: 'invitation', targetId: inv.invitationId, req })
    return { ok: true, email: user.email, bankCode: inv.bankCode }
  })

  // POST /api/invitations/reset-password — 憑「密碼重置」邀請碼設定新密碼（既有帳號）
  app.post('/reset-password', { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (req: FastifyRequest<{ Body: { code: string; password: string } }>, reply) => {
    const parsed = z.object({ code: z.string().min(1), password: z.string().min(8, '密碼至少 8 碼') }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ message: parsed.error.issues[0]?.message ?? '輸入格式不正確' })
    const { code, password } = parsed.data

    const r = await resolveInvite(code)
    if (r.error) return reply.code(400).send({ message: ERROR_MSG[r.error] })
    const inv = r.inv
    if (inv.purpose !== 'PASSWORD_RESET') return reply.code(400).send({ message: '此邀請碼非密碼重置用途' })

    const user = await prisma.user.findUnique({ where: { email: inv.email } })
    if (!user) return reply.code(404).send({ message: '找不到對應帳號' })

    const passwordHash = await bcrypt.hash(password, 10)
    await prisma.$transaction([
      prisma.user.update({ where: { userId: user.userId }, data: { passwordHash } }),
      prisma.invitation.update({ where: { invitationId: inv.invitationId }, data: { status: 'ACCEPTED', acceptedUserId: user.userId, acceptedAt: new Date() } }),
    ])
    await writeAudit({ actionType: 'PASSWORD_RESET_SUCCESS', userId: user.userId, bankCode: inv.bankCode, targetType: 'user', targetId: user.userId, req })
    return { ok: true }
  })
}
