import type { FastifyInstance, FastifyReply } from 'fastify'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '../prisma.js'
import { config } from '../config.js'
import { writeAudit } from '../lib/audit.js'
import { verifyAccessCode, markAccessCodeUsed } from '../lib/accessCode.js'

const loginSchema = z.object({
  bankCode: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(1),
})

// 刻意統一的登入失敗訊息，避免洩漏帳號是否存在或屬於哪家銀行
const GENERIC_LOGIN_ERROR = '銀行／帳號／密碼不正確，請確認後再試一次。'

function issueToken(reply: FastifyReply, user: { userId: string; role: 'ADMIN' | 'BANK_STAFF' | 'PLATFORM_AUDITOR'; bankCode: string; name: string }) {
  return reply.jwtSign({ userId: user.userId, role: user.role, bankCode: user.bankCode, name: user.name }, { expiresIn: '8h' })
}

export async function authRoutes(app: FastifyInstance) {
  // GET /api/auth/active-banks — 公開：登入頁下拉用（僅啟用中的機構）
  app.get('/active-banks', async () => {
    const banks = await prisma.bank.findMany({ where: { isActive: true }, orderBy: { bankCode: 'asc' }, select: { bankCode: true, bankName: true } })
    return { banks }
  })

  // POST /api/auth/login — 銀行 + Email + 密碼（或待啟用帳號的啟用碼）
  app.post('/login', { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } }, async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ message: '輸入格式不正確' })
    const { bankCode, email, password } = parsed.data
    const now = Date.now()

    const user = await prisma.user.findUnique({ where: { email }, include: { bank: { select: { bankName: true } } } })

    // 待啟用帳號：把「密碼欄」當啟用碼驗證；正確則要求前端切換到啟用流程（不發 token）
    if (user && user.accountStatus === 'PENDING_ACTIVATION' && user.bankCode === bankCode) {
      const codeId = await verifyAccessCode(user.userId, 'ACTIVATION', password)
      if (codeId) return reply.send({ activationRequired: true, email: user.email, name: user.name })
      await writeAudit({ actionType: 'LOGIN_FAILED', userId: user.userId, bankCode, detail: 'activation code mismatch', req })
      return reply.code(401).send({ message: GENERIC_LOGIN_ERROR })
    }

    // 帳號鎖定中 → 一律回通用訊息
    if (user?.lockedUntil && user.lockedUntil.getTime() > now) {
      await writeAudit({ actionType: 'LOGIN_FAILED', userId: user.userId, bankCode, detail: 'account locked', req })
      return reply.code(401).send({ message: GENERIC_LOGIN_ERROR })
    }

    // 三層檢查：存在 → 已啟用且銀行相符 → 密碼正確
    const bankMatch = !!user && user.accountStatus === 'ACTIVE' && user.bankCode === bankCode && !!user.passwordHash
    const ok = bankMatch && (await bcrypt.compare(password, user!.passwordHash!))

    if (!ok) {
      if (bankMatch && user) {
        const count = user.failedLoginCount + 1
        if (count >= 5) {
          await prisma.user.update({ where: { userId: user.userId }, data: { failedLoginCount: 0, lockedUntil: new Date(now + 15 * 60 * 1000) } })
          await writeAudit({ actionType: 'ACCOUNT_LOCKED', userId: user.userId, bankCode, detail: '連續失敗 5 次，鎖定 15 分鐘', req })
        } else {
          await prisma.user.update({ where: { userId: user.userId }, data: { failedLoginCount: count } })
        }
      }
      await writeAudit({ actionType: 'LOGIN_FAILED', userId: user?.userId ?? null, bankCode, detail: `login failed for ${email}`, req })
      return reply.code(401).send({ message: GENERIC_LOGIN_ERROR })
    }

    await prisma.user.update({ where: { userId: user!.userId }, data: { lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null } })
    await writeAudit({ actionType: 'LOGIN_SUCCESS', userId: user!.userId, bankCode: user!.bankCode, req })

    const token = await issueToken(reply, user!)
    return { token, user: { userId: user!.userId, name: user!.name, email: user!.email, role: user!.role, bankCode: user!.bankCode, bankName: user!.bank?.bankName ?? null } }
  })

  // POST /api/auth/activate — 以啟用碼設定新密碼並勾選同意，完成啟用（自動登入）
  app.post('/activate', { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const parsed = z
      .object({
        bankCode: z.string().min(1),
        email: z.string().email(),
        code: z.string().min(1),
        password: z.string().min(8, '密碼至少 8 碼'),
        consent: z.literal(true, { errorMap: () => ({ message: '請勾選個資蒐集/利用同意' }) }),
      })
      .safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ message: parsed.error.issues[0]?.message ?? '輸入格式不正確' })
    const { bankCode, email, code, password } = parsed.data

    const user = await prisma.user.findUnique({ where: { email } })
    if (!user || user.bankCode !== bankCode || user.accountStatus !== 'PENDING_ACTIVATION') {
      return reply.code(400).send({ message: '啟用資訊不正確或帳號已啟用' })
    }
    const codeId = await verifyAccessCode(user.userId, 'ACTIVATION', code)
    if (!codeId) return reply.code(400).send({ message: '啟用碼無效或已過期' })

    const passwordHash = await bcrypt.hash(password, 10)
    const updated = await prisma.user.update({
      where: { userId: user.userId },
      data: {
        passwordHash,
        accountStatus: 'ACTIVE',
        activatedAt: new Date(),
        consentedAt: new Date(),
        consentVersion: config.consentVersion,
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      },
      include: { bank: { select: { bankName: true } } },
    })
    await markAccessCodeUsed(codeId)
    await writeAudit({ actionType: 'ACCOUNT_ACTIVATED', userId: user.userId, bankCode, targetType: 'USER', targetId: user.userId, fromStatus: 'PENDING_ACTIVATION', toStatus: 'ACTIVE', req })
    await writeAudit({ actionType: 'CONSENT_GIVEN', userId: user.userId, bankCode, detail: config.consentVersion, req })

    const token = await issueToken(reply, updated)
    return { token, user: { userId: updated.userId, name: updated.name, email: updated.email, role: updated.role, bankCode: updated.bankCode, bankName: updated.bank?.bankName ?? null } }
  })

  // GET /api/auth/me — 取得目前登入者
  app.get('/me', { preHandler: [app.authenticate] }, async (req) => {
    const u = await prisma.user.findUnique({ where: { userId: req.user.userId }, include: { bank: true } })
    if (!u) return { user: null }
    return {
      user: {
        userId: u.userId,
        name: u.name,
        email: u.email,
        role: u.role,
        bankCode: u.bankCode,
        bankName: u.bank?.bankName ?? null,
        department: u.department,
        title: u.title,
      },
    }
  })
}
