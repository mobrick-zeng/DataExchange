import type { FastifyInstance } from 'fastify'
import type { CaseStatus } from '@prisma/client'
import { prisma } from '../prisma.js'

/** 本期期別，格式 YYYY-MM */
function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7)
}

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
    const period = currentPeriod()

    const unreadNotifications = await prisma.notification.count({
      where: { userId, isRead: false },
    })

    const summary: Record<string, unknown> = { role, period, unreadNotifications }

    if (role === 'ADMIN') {
      summary.pendingUserApprovals = await prisma.user.count({ where: { accountStatus: 'PENDING_REVIEW' } })
      summary.allCasesByStatus = await casesByStatus({})
      summary.totalCases = await prisma.case.count()
    }

    if (role === 'PLATFORM_AUDITOR') {
      summary.allCasesByStatus = await casesByStatus({})
      summary.totalCases = await prisma.case.count()
    }

    if (role === 'BANK_STAFF' && bankCode) {
      // 以「最大債權行」身分（我建立/主辦的案件）
      const myMainCasesByStatus = await casesByStatus({ mainBankCode: bankCode })

      const pendingConfirmations = await prisma.caseParticipantBank.count({
        where: { case: { mainBankCode: bankCode }, roleInCase: 'CO_BANK', confirmationStatus: 'PENDING' },
      })
      const disputesToHandle = await prisma.caseParticipantBank.count({
        where: { case: { mainBankCode: bankCode }, confirmationStatus: 'DISPUTED' },
      })

      // 本月待更新：我主辦、還款中、且本期尚無還款紀錄的案件數
      const inRepayment = await prisma.case.findMany({
        where: { mainBankCode: bankCode, status: 'IN_REPAYMENT' as CaseStatus },
        select: { caseId: true },
      })
      const ids = inRepayment.map((c) => c.caseId)
      let repaymentUpdatesDue = 0
      if (ids.length) {
        const updated = await prisma.repaymentRecord.findMany({
          where: { caseId: { in: ids }, period },
          select: { caseId: true },
          distinct: ['caseId'],
        })
        repaymentUpdatesDue = ids.length - updated.length
      }

      // 以「其他債權行」身分（被邀請的案件）
      const toConfirm = await prisma.caseParticipantBank.count({
        where: { bankCode, roleInCase: 'CO_BANK', confirmationStatus: 'PENDING' },
      })
      const myDisputes = await prisma.caseParticipantBank.count({
        where: { bankCode, roleInCase: 'CO_BANK', confirmationStatus: 'DISPUTED' },
      })
      // 我以其他債權行身分參與的所有案件（含已確認、還款中…），供儀表板呈現完整參與概況，
      // 而非只看得到「待確認／異議」兩種待辦
      const myCoBankCasesByStatus = await casesByStatus({
        participants: { some: { bankCode, roleInCase: 'CO_BANK' } },
      })

      summary.asMain = {
        casesByStatus: myMainCasesByStatus,
        pendingConfirmations,
        disputesToHandle,
        repaymentUpdatesDue,
      }
      summary.asCoBank = { toConfirm, myDisputes, casesByStatus: myCoBankCasesByStatus }
    }

    return summary
  })
}
