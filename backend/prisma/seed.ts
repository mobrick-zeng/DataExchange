import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

const DEMO_PASSWORD = 'Demo@1234'
// SEED_MODE：'demo'（預設，含示範帳號）｜'production'（只建 admin + 銀行主檔）
const MODE = (process.env.SEED_MODE ?? 'demo').toLowerCase()

async function main() {
  // 銀行／機構主檔（兩種模式皆需；正式版先沿用 012/807/812 作佔位，日後換真實清單）
  const banks = [
    { bankCode: '012', bankName: '台北富邦銀行', type: 'BANK' as const },
    { bankCode: '807', bankName: '玉山銀行', type: 'BANK' as const },
    { bankCode: '812', bankName: '台新銀行', type: 'BANK' as const },
    { bankCode: 'PLATFORM', bankName: '平台管理單位', type: 'PLATFORM' as const },
  ]
  for (const b of banks) {
    await prisma.bank.upsert({ where: { bankCode: b.bankCode }, update: b, create: b })
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10)

  // 平台管理員（兩種模式都建立）；對既有帳號不覆寫密碼
  await prisma.user.upsert({
    where: { email: 'admin@platform-demo.local' },
    update: {},
    create: {
      email: 'admin@platform-demo.local',
      name: '平台管理員',
      passwordHash,
      appliedBankCode: 'PLATFORM',
      approvedBankCode: 'PLATFORM',
      role: 'ADMIN',
      accountStatus: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  })

  if (MODE === 'production') {
    console.log('✅ 種子完成（正式版）：4 家銀行主檔 + 1 組 admin（其餘帳號請以邀請制建立）')
    return
  }

  // Demo 模式：額外建立示範銀行人員與稽核帳號
  const demoUsers = [
    { email: 'fubon.main@bank.local', name: '富邦承辦', bank: '012', role: 'BANK_STAFF' as const },
    { email: 'esun.co@bank.local', name: '玉山承辦', bank: '807', role: 'BANK_STAFF' as const },
    { email: 'taishin.co@bank.local', name: '台新承辦', bank: '812', role: 'BANK_STAFF' as const },
    { email: 'auditor@platform-demo.local', name: '平台稽核', bank: 'PLATFORM', role: 'PLATFORM_AUDITOR' as const },
  ]
  for (const u of demoUsers) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        email: u.email,
        name: u.name,
        passwordHash,
        appliedBankCode: u.bank,
        approvedBankCode: u.bank,
        role: u.role,
        accountStatus: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    })
  }
  console.log('✅ 種子完成（Demo）：4 家銀行 + 5 組帳號（密碼皆 Demo@1234）')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
