import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'
import { config } from './config.js'
import { prisma } from './prisma.js'
import { authenticate } from './auth/guard.js'
import { authRoutes } from './routes/auth.js'
import { dashboardRoutes } from './routes/dashboard.js'
import { bankRoutes } from './routes/banks.js'
import { caseRoutes } from './routes/cases.js'
import { caseFlowRoutes } from './routes/caseFlow.js'
import { userAdminRoutes } from './routes/usersAdmin.js'
import { notificationRoutes } from './routes/notifications.js'
import { auditRoutes } from './routes/audit.js'
import { courtRoutes } from './routes/courts.js'
import { passwordResetRoutes } from './routes/passwordReset.js'

const app = Fastify({ logger: true })

async function bootstrap() {
  await app.register(cors, { origin: config.corsOrigins, credentials: true })
  await app.register(jwt, { secret: config.jwtSecret })
  // 全域流量限制（各敏感端點另有更嚴格上限）；超過回 429。
  // 上限可由 RATE_LIMIT_MAX 覆寫——預設 100 不變，僅供一致性測試等自動化情境調高
  // （該套測試每個案例都要建立一整組案件，很容易觸頂）。正式環境請勿調高。
  await app.register(rateLimit, { global: true, max: config.rateLimitMax, timeWindow: '1 minute' })

  // 註冊 JWT 驗證裝飾器
  app.decorate('authenticate', authenticate)

  // 健康檢查：順便確認資料庫連得上
  app.get('/health', async () => {
    const bankCount = await prisma.bank.count()
    const userCount = await prisma.user.count()
    return { status: 'ok', db: 'connected', banks: bankCount, users: userCount }
  })

  // API 模組
  await app.register(authRoutes, { prefix: '/api/auth' })
  await app.register(dashboardRoutes, { prefix: '/api/dashboard' })
  await app.register(bankRoutes, { prefix: '/api/banks' })
  await app.register(courtRoutes, { prefix: '/api/courts' })
  await app.register(caseRoutes, { prefix: '/api/cases' })
  await app.register(caseFlowRoutes, { prefix: '/api/cases' })
  await app.register(userAdminRoutes, { prefix: '/api/users' })
  await app.register(notificationRoutes, { prefix: '/api/notifications' })
  await app.register(auditRoutes, { prefix: '/api/audit-logs' })
  await app.register(passwordResetRoutes, { prefix: '/api' })

  await app.listen({ host: '0.0.0.0', port: config.port })
}

bootstrap().catch((err) => {
  app.log.error(err)
  process.exit(1)
})
