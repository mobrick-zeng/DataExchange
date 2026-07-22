import type { AccessCodePurpose } from '@prisma/client'
import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { prisma } from '../prisma.js'

const DEFAULT_TTL_MS = 3 * 24 * 60 * 60 * 1000 // 3 天

/**
 * 產生一次性代碼（啟用碼／密碼重置碼）並存雜湊；回傳明碼（僅此一次）。
 * 明碼由管理員經外部管道遞送給使用者，使用者於登入頁「當密碼」輸入。
 */
export async function mintAccessCode(params: {
  userId: string
  purpose: AccessCodePurpose
  createdBy: string
  ttlMs?: number
}): Promise<{ code: string; expiresAt: Date }> {
  // 12 碼英數（base64url 去掉易混淆字元不強制；先撤銷同用途未使用碼避免多碼並存）
  const code = randomBytes(9).toString('base64url')
  const codeHash = await bcrypt.hash(code, 10)
  const expiresAt = new Date(Date.now() + (params.ttlMs ?? DEFAULT_TTL_MS))

  await prisma.accessCode.updateMany({
    where: { userId: params.userId, purpose: params.purpose, usedAt: null },
    data: { usedAt: new Date() }, // 作廢舊碼
  })
  await prisma.accessCode.create({
    data: { userId: params.userId, purpose: params.purpose, codeHash, expiresAt, createdBy: params.createdBy },
  })
  return { code, expiresAt }
}

/** 驗證使用者的一次性代碼；成功回傳 codeId，否則 null（不透露原因） */
export async function verifyAccessCode(userId: string, purpose: AccessCodePurpose, code: string): Promise<string | null> {
  const now = new Date()
  const candidates = await prisma.accessCode.findMany({
    where: { userId, purpose, usedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: 'desc' },
  })
  for (const c of candidates) {
    if (await bcrypt.compare(code, c.codeHash)) return c.codeId
  }
  return null
}

/** 標記代碼已使用 */
export async function markAccessCodeUsed(codeId: string): Promise<void> {
  await prisma.accessCode.update({ where: { codeId }, data: { usedAt: new Date() } })
}
