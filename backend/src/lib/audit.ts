import type { AuditActionType } from '@prisma/client'
import type { FastifyRequest } from 'fastify'
import { prisma } from '../prisma.js'

/** 寫入稽核紀錄（只可新增） */
export async function writeAudit(params: {
  actionType: AuditActionType
  userId?: string | null
  bankCode?: string | null
  targetType?: string
  targetId?: string
  fromStatus?: string
  toStatus?: string
  detail?: string
  req?: FastifyRequest
}) {
  await prisma.auditLog.create({
    data: {
      actionType: params.actionType,
      userId: params.userId ?? null,
      bankCode: params.bankCode ?? null,
      targetType: params.targetType,
      targetId: params.targetId,
      fromStatus: params.fromStatus,
      toStatus: params.toStatus,
      detail: params.detail,
      ipAddress: params.req?.ip,
      userAgent: params.req?.headers['user-agent'],
    },
  })
}
