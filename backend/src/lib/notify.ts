import type { NotificationType } from '@prisma/client'
import { prisma } from '../prisma.js'

/** 對單一使用者發送通知 */
export async function notifyUser(params: {
  userId: string
  type: NotificationType
  message: string
  relatedCaseId?: string
}) {
  await prisma.notification.create({
    data: { userId: params.userId, type: params.type, message: params.message, relatedCaseId: params.relatedCaseId },
  })
}

/** 對某銀行的所有「已啟用」使用者發送通知 */
export async function notifyBankUsers(params: {
  bankCode: string
  type: NotificationType
  message: string
  relatedCaseId?: string
  relatedDeclarationId?: string
}) {
  const users = await prisma.user.findMany({
    where: { approvedBankCode: params.bankCode, accountStatus: 'ACTIVE' },
    select: { userId: true },
  })
  if (users.length === 0) return
  await prisma.notification.createMany({
    data: users.map((u) => ({
      userId: u.userId,
      type: params.type,
      message: params.message,
      relatedCaseId: params.relatedCaseId,
      relatedDeclarationId: params.relatedDeclarationId,
    })),
  })
}
