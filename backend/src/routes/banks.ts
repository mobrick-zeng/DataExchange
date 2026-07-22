import type { FastifyInstance } from 'fastify'
import { prisma } from '../prisma.js'

export async function bankRoutes(app: FastifyInstance) {
  // GET /api/banks — 銀行／機構清單（供邀請、下拉選單使用）
  app.get('/', { preHandler: [app.authenticate] }, async () => {
    const banks = await prisma.bank.findMany({ orderBy: { bankCode: 'asc' } })
    return { banks }
  })
}
