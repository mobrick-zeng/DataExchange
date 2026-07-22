import { PrismaClient } from '@prisma/client'

// 單例 Prisma Client，供全後端共用
export const prisma = new PrismaClient()
