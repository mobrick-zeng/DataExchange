import '@fastify/jwt'
import type { FastifyReply, FastifyRequest } from 'fastify'

// JWT 內容型別
export interface JwtUser {
  userId: string
  role: 'ADMIN' | 'BANK_STAFF' | 'PLATFORM_AUDITOR'
  bankCode: string
  name: string
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtUser
    user: JwtUser
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}
