import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '../prisma.js'
import { writeAudit } from '../lib/audit.js'

const loginSchema = z.object({
  bankCode: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(1),
})

// 刻意統一的登入失敗訊息，避免洩漏帳號是否存在或核准了哪家銀行
const GENERIC_LOGIN_ERROR = '銀行／帳號／密碼不正確，請確認後再試一次。'

export async function authRoutes(app: FastifyInstance) {
  // POST /api/auth/login — 銀行 + Email + 密碼三層驗證
  app.post('/login', { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } }, async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ message: '輸入格式不正確' })
    const { bankCode, email, password } = parsed.data
    const now = Date.now()

    const user = await prisma.user.findUnique({ where: { email } })

    // 帳號鎖定中 → 一律回通用訊息（不透露鎖定狀態）
    if (user?.lockedUntil && user.lockedUntil.getTime() > now) {
      await writeAudit({ actionType: 'LOGIN_FAILED', userId: user.userId, bankCode, detail: 'account locked', req })
      return reply.code(401).send({ message: GENERIC_LOGIN_ERROR })
    }

    // 三層檢查：存在 → 核准銀行相符且已啟用 → 密碼正確
    const bankMatch = !!user && user.accountStatus === 'ACTIVE' && user.approvedBankCode === bankCode
    const ok = bankMatch && (await bcrypt.compare(password, user!.passwordHash))

    if (!ok) {
      // 僅在「正確帳號+銀行、但密碼錯誤」時累計鎖定（降低誤鎖與惡意鎖定他人）
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
    await writeAudit({ actionType: 'LOGIN_SUCCESS', userId: user!.userId, bankCode: user!.approvedBankCode, req })

    const token = await reply.jwtSign(
      { userId: user!.userId, role: user!.role, bankCode: user!.approvedBankCode, name: user!.name },
      { expiresIn: '8h' },
    )
    return { token, user: { userId: user!.userId, name: user!.name, email: user!.email, role: user!.role, bankCode: user!.approvedBankCode } }
  })

  // GET /api/auth/me — 取得目前登入者
  app.get('/me', { preHandler: [app.authenticate] }, async (req) => {
    const u = await prisma.user.findUnique({
      where: { userId: req.user.userId },
      include: { approvedBank: true },
    })
    if (!u) return { user: null }
    return {
      user: {
        userId: u.userId,
        name: u.name,
        email: u.email,
        role: u.role,
        bankCode: u.approvedBankCode,
        bankName: u.approvedBank?.bankName ?? null,
        department: u.department,
        title: u.title,
      },
    }
  })
}
