import type { FastifyInstance } from 'fastify'
import { prisma } from '../prisma.js'

async function casesByStatus(where: object): Promise<Record<string, number>> {
  const rows = await prisma.case.groupBy({ by: ['status'], where, _count: { _all: true } })
  const out: Record<string, number> = {}
  for (const r of rows) out[r.status] = r._count._all
  return out
}

export async function dashboardRoutes(app: FastifyInstance) {
  // GET /api/dashboard/summary — 依角色回傳統計與待辦
  app.get('/summary', { preHandler: [app.authenticate] }, async (req) => {
    const { userId, role, bankCode } = req.user

    const unreadNotifications = await prisma.notification.count({ where: { userId, isRead: false } })
    const summary: Record<string, unknown> = { role, unreadNotifications }

    if (role === 'ADMIN') {
      summary.pendingUserActivations = await prisma.user.count({ where: { accountStatus: 'PENDING_ACTIVATION' } })
      summary.pendingResetRequests = await prisma.passwordResetRequest.count({ where: { status: 'PENDING' } })
      summary.allCasesByStatus = await casesByStatus({})
      summary.totalCases = await prisma.case.count()
    }

    if (role === 'PLATFORM_AUDITOR') {
      summary.allCasesByStatus = await casesByStatus({})
      summary.totalCases = await prisma.case.count()
    }

    if (role === 'BANK_STAFF' && bankCode) {
      // 以「主辦」身分（我起的案件）
      const myMainCasesByStatus = await casesByStatus({ mainBankCode: bankCode })

      // 我主辦、封閉申報中、仍有（有效）參與行尚未確認的案件
      const pendingConfirmations = await prisma.caseParticipantBank.count({
        where: { case: { mainBankCode: bankCode, status: 'PENDING_CONFIRMATION' }, removedAt: null, confirmationStatus: 'PENDING' },
      })
      // 我主辦、已揭露待我回報成立/不成立的案件
      const outcomeToReport = await prisma.case.count({ where: { mainBankCode: bankCode, status: 'PENDING_OUTCOME' } })

      // 以「其他債權行」身分（被邀請的案件）
      const toConfirm = await prisma.caseParticipantBank.count({
        where: { bankCode, roleInCase: 'CO_BANK', removedAt: null, confirmationStatus: 'PENDING', case: { status: 'PENDING_CONFIRMATION' } },
      })
      const myCoBankCasesByStatus = await casesByStatus({
        participants: { some: { bankCode, roleInCase: 'CO_BANK', removedAt: null } },
      })

      summary.asMain = { casesByStatus: myMainCasesByStatus, pendingConfirmations, outcomeToReport }
      summary.asCoBank = { toConfirm, casesByStatus: myCoBankCasesByStatus }
    }

    return summary
  })
}
