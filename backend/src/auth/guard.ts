import type { FastifyReply, FastifyRequest } from 'fastify'
import type { JwtUser } from './jwt.js'

/** 驗證 JWT，失敗回 401 */
export async function authenticate(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify()
  } catch {
    reply.code(401).send({ message: '未授權，請重新登入' })
  }
}

/** 角色守衛：限定特定角色才能存取 */
export function requireRole(...roles: NonNullable<JwtUser['role']>[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const role = req.user?.role
    if (!role || !roles.includes(role)) {
      reply.code(403).send({ message: '權限不足' })
    }
  }
}
