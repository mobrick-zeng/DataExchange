import 'dotenv/config'
import { PrismaClient, Prisma } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

const DEMO_PASSWORD = 'Demo@1234'
const CONSENT_VERSION = 'v1-2026-07'
// SEED_MODE：'demo'（含全階段示範資料）｜'production'（僅 admin + 銀行/法院主檔）
const MODE = (process.env.SEED_MODE ?? 'demo').toLowerCase()

// 金額四捨五入到 4 位小數
const r4 = (n: number) => Math.round(n * 10000) / 10000

// ============================== 參考主檔 ==============================

// 金融機構參考主檔（3 碼；兩種模式皆建立）。僅 012/808/812 與 PLATFORM 啟用，其餘預設停用。
// ⚠️ 本清單為「主要銀行」起步樣本；正式上線前請以央行「金融機構代碼一覽表」最終校對（尚未含全部信合社／農漁會）。
// 代碼已更正為真實值：玉山＝808、永豐＝807、台新＝812、富邦＝012。
const BANKS: { bankCode: string; bankName: string; type: 'BANK' | 'PLATFORM'; isActive: boolean }[] = [
  { bankCode: 'PLATFORM', bankName: '平台管理單位', type: 'PLATFORM', isActive: true },
  { bankCode: '012', bankName: '台北富邦銀行', type: 'BANK', isActive: true },
  { bankCode: '808', bankName: '玉山銀行', type: 'BANK', isActive: true },
  { bankCode: '812', bankName: '台新國際商業銀行', type: 'BANK', isActive: true },
  // —— 以下為預留清單（停用，日後於後台啟用）——
  { bankCode: '004', bankName: '臺灣銀行', type: 'BANK', isActive: false },
  { bankCode: '005', bankName: '臺灣土地銀行', type: 'BANK', isActive: false },
  { bankCode: '006', bankName: '合作金庫商業銀行', type: 'BANK', isActive: false },
  { bankCode: '007', bankName: '第一商業銀行', type: 'BANK', isActive: false },
  { bankCode: '008', bankName: '華南商業銀行', type: 'BANK', isActive: false },
  { bankCode: '009', bankName: '彰化商業銀行', type: 'BANK', isActive: false },
  { bankCode: '011', bankName: '上海商業儲蓄銀行', type: 'BANK', isActive: false },
  { bankCode: '013', bankName: '國泰世華商業銀行', type: 'BANK', isActive: false },
  { bankCode: '016', bankName: '高雄銀行', type: 'BANK', isActive: false },
  { bankCode: '017', bankName: '兆豐國際商業銀行', type: 'BANK', isActive: false },
  { bankCode: '018', bankName: '全國農業金庫', type: 'BANK', isActive: false },
  { bankCode: '021', bankName: '花旗（台灣）商業銀行', type: 'BANK', isActive: false },
  { bankCode: '048', bankName: '王道商業銀行', type: 'BANK', isActive: false },
  { bankCode: '050', bankName: '臺灣中小企業銀行', type: 'BANK', isActive: false },
  { bankCode: '052', bankName: '渣打國際商業銀行', type: 'BANK', isActive: false },
  { bankCode: '053', bankName: '台中商業銀行', type: 'BANK', isActive: false },
  { bankCode: '054', bankName: '京城商業銀行', type: 'BANK', isActive: false },
  { bankCode: '081', bankName: '滙豐（台灣）商業銀行', type: 'BANK', isActive: false },
  { bankCode: '101', bankName: '瑞興商業銀行', type: 'BANK', isActive: false },
  { bankCode: '103', bankName: '臺灣新光商業銀行', type: 'BANK', isActive: false },
  { bankCode: '108', bankName: '陽信商業銀行', type: 'BANK', isActive: false },
  { bankCode: '118', bankName: '板信商業銀行', type: 'BANK', isActive: false },
  { bankCode: '147', bankName: '三信商業銀行', type: 'BANK', isActive: false },
  { bankCode: '700', bankName: '中華郵政', type: 'BANK', isActive: false },
  { bankCode: '803', bankName: '聯邦商業銀行', type: 'BANK', isActive: false },
  { bankCode: '805', bankName: '遠東國際商業銀行', type: 'BANK', isActive: false },
  { bankCode: '806', bankName: '元大商業銀行', type: 'BANK', isActive: false },
  { bankCode: '807', bankName: '永豐商業銀行', type: 'BANK', isActive: false },
  { bankCode: '809', bankName: '凱基商業銀行', type: 'BANK', isActive: false },
  { bankCode: '810', bankName: '星展（台灣）商業銀行', type: 'BANK', isActive: false },
  { bankCode: '816', bankName: '安泰商業銀行', type: 'BANK', isActive: false },
  { bankCode: '822', bankName: '中國信託商業銀行', type: 'BANK', isActive: false },
]

// 法院參考主檔（兩種模式皆建立）。僅臺北/士林啟用，其餘預設停用。
// ⚠️ courtCode 為內部可讀代碼（非司法院官方代碼）；公文文號格式與官方代碼待正式確認。
const COURTS: { courtCode: string; courtName: string; courtType: string; isActive: boolean }[] = [
  { courtCode: 'TPD', courtName: '臺灣臺北地方法院', courtType: '地方法院', isActive: true },
  { courtCode: 'SLD', courtName: '臺灣士林地方法院', courtType: '地方法院', isActive: true },
  { courtCode: 'KLD', courtName: '臺灣基隆地方法院', courtType: '地方法院', isActive: false },
  { courtCode: 'PCD', courtName: '臺灣新北地方法院', courtType: '地方法院', isActive: false },
  { courtCode: 'ILD', courtName: '臺灣宜蘭地方法院', courtType: '地方法院', isActive: false },
  { courtCode: 'TYD', courtName: '臺灣桃園地方法院', courtType: '地方法院', isActive: false },
  { courtCode: 'SCD', courtName: '臺灣新竹地方法院', courtType: '地方法院', isActive: false },
  { courtCode: 'MLD', courtName: '臺灣苗栗地方法院', courtType: '地方法院', isActive: false },
  { courtCode: 'TCD', courtName: '臺灣臺中地方法院', courtType: '地方法院', isActive: false },
  { courtCode: 'NTD', courtName: '臺灣南投地方法院', courtType: '地方法院', isActive: false },
  { courtCode: 'CHD', courtName: '臺灣彰化地方法院', courtType: '地方法院', isActive: false },
  { courtCode: 'ULD', courtName: '臺灣雲林地方法院', courtType: '地方法院', isActive: false },
  { courtCode: 'CYD', courtName: '臺灣嘉義地方法院', courtType: '地方法院', isActive: false },
  { courtCode: 'TND', courtName: '臺灣臺南地方法院', courtType: '地方法院', isActive: false },
  { courtCode: 'KSD', courtName: '臺灣高雄地方法院', courtType: '地方法院', isActive: false },
  { courtCode: 'CTD', courtName: '臺灣橋頭地方法院', courtType: '地方法院', isActive: false },
  { courtCode: 'PTD', courtName: '臺灣屏東地方法院', courtType: '地方法院', isActive: false },
  { courtCode: 'TTD', courtName: '臺灣臺東地方法院', courtType: '地方法院', isActive: false },
  { courtCode: 'HLD', courtName: '臺灣花蓮地方法院', courtType: '地方法院', isActive: false },
  { courtCode: 'PHD', courtName: '臺灣澎湖地方法院', courtType: '地方法院', isActive: false },
  { courtCode: 'KSJ', courtName: '臺灣高雄少年及家事法院', courtType: '少年及家事法院', isActive: false },
  { courtCode: 'KMD', courtName: '福建金門地方法院', courtType: '地方法院', isActive: false },
  { courtCode: 'LCD', courtName: '福建連江地方法院', courtType: '地方法院', isActive: false },
]

// ============================== 案件示範規格 ==============================

type ItemSpec = {
  claimType: 'CREDIT_LOAN' | 'CREDIT_CARD' | 'GUARANTEE' | 'OTHER'
  principal: number
  interest: number
  penalty: number
  otherFee: number
  internalTotal?: number
}
type PartSpec = {
  bankCode: string
  role: 'MAIN' | 'CO_BANK'
  planRatio: number
  confirm: 'NOT_REQUIRED' | 'PENDING' | 'CONFIRMED' | 'DISPUTED'
  disputeReason?: string
  items: ItemSpec[]
}
type CaseSpec = {
  courtCode: string
  docNumber: string
  mainBankCode: string
  status: 'DRAFT' | 'PENDING_CONFIRMATION' | 'IN_REPAYMENT' | 'SETTLED' | 'TERMINATED'
  receiptDate?: string
  confirmationDeadline?: string
  note?: string
  participants: PartSpec[]
  plan?: { monthlyInstallment: number; planInstallments: number; planStartDate: string }
  periods?: { period: string; actualReceivedTotal: number }[]
  settledAt?: string
  terminatedAt?: string
  terminationReason?: string
}

const itemsTotal = (items: ItemSpec[]) =>
  r4(items.reduce((s, it) => s + it.principal + it.interest + it.penalty + it.otherFee, 0))

async function main() {
  // ---- 銀行與法院主檔（兩種模式皆需；upsert 冪等）----
  for (const b of BANKS) {
    await prisma.bank.upsert({ where: { bankCode: b.bankCode }, update: b, create: b })
  }
  for (const c of COURTS) {
    await prisma.court.upsert({ where: { courtCode: c.courtCode }, update: c, create: c })
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10)

  // ---- 平台管理員（兩種模式都建立；已啟用、已同意）----
  const admin = await prisma.user.upsert({
    where: { email: 'admin@platform-demo.local' },
    update: {},
    create: {
      email: 'admin@platform-demo.local',
      name: '平台管理員',
      passwordHash,
      bankCode: 'PLATFORM',
      role: 'ADMIN',
      accountStatus: 'ACTIVE',
      activatedAt: new Date(),
      consentedAt: new Date(),
      consentVersion: CONSENT_VERSION,
    },
  })

  if (MODE === 'production') {
    console.log('✅ 種子完成（正式版）：銀行/法院主檔 + 1 組 admin（其餘帳號請以邀請/啟用碼建立）')
    return
  }

  // ============================ Demo 模式 ============================

  // ---- 示範帳號（已啟用）----
  const demoUsers = [
    { email: 'auditor@platform-demo.local', name: '平台稽核', bankCode: 'PLATFORM', role: 'PLATFORM_AUDITOR' as const },
    { email: 'fubon.main@bank.local', name: '富邦承辦', bankCode: '012', role: 'BANK_STAFF' as const },
    { email: 'esun.co@bank.local', name: '玉山承辦', bankCode: '808', role: 'BANK_STAFF' as const },
    { email: 'taishin.co@bank.local', name: '台新承辦', bankCode: '812', role: 'BANK_STAFF' as const },
  ]
  const userByBank: Record<string, string> = {} // bankCode -> userId（取該行一位承辦當確認人）
  for (const u of demoUsers) {
    const created = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        email: u.email,
        name: u.name,
        passwordHash,
        bankCode: u.bankCode,
        role: u.role,
        accountStatus: 'ACTIVE',
        activatedAt: new Date(),
        consentedAt: new Date(),
        consentVersion: CONSENT_VERSION,
      },
    })
    if (u.role === 'BANK_STAFF') userByBank[u.bankCode] = created.userId
  }

  // ---- 一個「待啟用」帳號 + 啟用碼（示範正式區啟用流程）----
  const pendingEmail = 'pending.co@bank.local'
  const existingPending = await prisma.user.findUnique({ where: { email: pendingEmail } })
  if (!existingPending) {
    const pending = await prisma.user.create({
      data: {
        email: pendingEmail,
        name: '（待啟用）玉山新承辦',
        bankCode: '808',
        role: 'BANK_STAFF',
        accountStatus: 'PENDING_ACTIVATION',
      },
    })
    const activationCode = 'ACT-DEMO-808'
    await prisma.accessCode.create({
      data: {
        userId: pending.userId,
        purpose: 'ACTIVATION',
        codeHash: await bcrypt.hash(activationCode, 10),
        expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        createdBy: admin.userId,
      },
    })
    console.log(`ℹ️ 待啟用示範帳號：${pendingEmail}（銀行 808）／啟用碼：${activationCode}`)
  }

  // ---- 案件示範資料（僅在完全沒有案件時建立，避免重啟重複）----
  if ((await prisma.case.count()) > 0) {
    console.log('ℹ️ 已存在案件資料，略過案件種子。')
    console.log('✅ 種子完成（Demo）')
    return
  }

  const commonItems = (base: number): ItemSpec[] => [
    { claimType: 'CREDIT_LOAN', principal: base, interest: r4(base * 0.05), penalty: 1000, otherFee: 500, internalTotal: base },
    { claimType: 'CREDIT_CARD', principal: r4(base * 0.4), interest: r4(base * 0.02), penalty: 800, otherFee: 200, internalTotal: r4(base * 0.4) },
  ]

  const specs: CaseSpec[] = [
    // 1) DRAFT —— 主辦代填、設好比例，尚未發布
    {
      courtCode: 'TPD', docNumber: '北院民聲字第1130000101號', mainBankCode: '012', status: 'DRAFT',
      receiptDate: '2026-06-10', confirmationDeadline: '2026-07-31', note: '草稿：主辦代填中',
      participants: [
        { bankCode: '012', role: 'MAIN', planRatio: 0.5, confirm: 'NOT_REQUIRED', items: commonItems(300000) },
        { bankCode: '808', role: 'CO_BANK', planRatio: 0.3, confirm: 'PENDING', items: commonItems(180000) },
        { bankCode: '812', role: 'CO_BANK', planRatio: 0.2, confirm: 'PENDING', items: commonItems(120000) },
      ],
    },
    // 2) PENDING_CONFIRMATION —— 已發布；808 已確認、812 待確認
    {
      courtCode: 'TPD', docNumber: '北院民聲字第1130000102號', mainBankCode: '012', status: 'PENDING_CONFIRMATION',
      receiptDate: '2026-06-05', confirmationDeadline: '2026-07-20', note: '已發布，待部分行確認',
      participants: [
        { bankCode: '012', role: 'MAIN', planRatio: 0.5, confirm: 'NOT_REQUIRED', items: commonItems(400000) },
        { bankCode: '808', role: 'CO_BANK', planRatio: 0.3, confirm: 'CONFIRMED', items: commonItems(200000) },
        { bankCode: '812', role: 'CO_BANK', planRatio: 0.2, confirm: 'PENDING', items: commonItems(150000) },
      ],
    },
    // 3) PENDING_CONFIRMATION —— 含異議（812 回報異議）
    {
      courtCode: 'SLD', docNumber: '士院民聲字第1130000103號', mainBankCode: '012', status: 'PENDING_CONFIRMATION',
      receiptDate: '2026-06-01', confirmationDeadline: '2026-07-15', note: '有一家回報異議，待主辦修正',
      participants: [
        { bankCode: '012', role: 'MAIN', planRatio: 0.6, confirm: 'NOT_REQUIRED', items: commonItems(500000) },
        { bankCode: '808', role: 'CO_BANK', planRatio: 0.25, confirm: 'CONFIRMED', items: commonItems(200000) },
        { bankCode: '812', role: 'CO_BANK', planRatio: 0.15, confirm: 'DISPUTED', disputeReason: '利息計算基準日與本行帳載不符，請主辦重新核對。', items: commonItems(120000) },
      ],
    },
    // 4) IN_REPAYMENT —— 全數確認，2 期還款（第 2 期短繳、產生尾差）
    {
      courtCode: 'TPD', docNumber: '北院民聲字第1130000104號', mainBankCode: '808', status: 'IN_REPAYMENT',
      receiptDate: '2026-04-10', confirmationDeadline: '2026-05-10', note: '還款中',
      plan: { monthlyInstallment: 30000, planInstallments: 24, planStartDate: '2026-05-01' },
      periods: [
        { period: '2026-05', actualReceivedTotal: 30000 },
        { period: '2026-06', actualReceivedTotal: 25000.01 }, // 故意造成攤提尾差
      ],
      participants: [
        { bankCode: '808', role: 'MAIN', planRatio: 0.5, confirm: 'NOT_REQUIRED', items: commonItems(360000) },
        { bankCode: '012', role: 'CO_BANK', planRatio: 0.3333, confirm: 'CONFIRMED', items: commonItems(240000) },
        { bankCode: '812', role: 'CO_BANK', planRatio: 0.1667, confirm: 'CONFIRMED', items: commonItems(120000) },
      ],
    },
    // 5) SETTLED —— 已結清
    {
      courtCode: 'SLD', docNumber: '士院民聲字第1130000105號', mainBankCode: '012', status: 'SETTLED',
      receiptDate: '2025-12-01', confirmationDeadline: '2026-01-10', note: '已結清',
      plan: { monthlyInstallment: 50000, planInstallments: 6, planStartDate: '2026-01-01' },
      periods: [
        { period: '2026-01', actualReceivedTotal: 50000 },
        { period: '2026-02', actualReceivedTotal: 50000 },
      ],
      settledAt: '2026-06-30',
      participants: [
        { bankCode: '012', role: 'MAIN', planRatio: 0.7, confirm: 'NOT_REQUIRED', items: commonItems(400000) },
        { bankCode: '808', role: 'CO_BANK', planRatio: 0.3, confirm: 'CONFIRMED', items: commonItems(150000) },
      ],
    },
    // 6) TERMINATED —— 毀諾終止
    {
      courtCode: 'TPD', docNumber: '北院民聲字第1130000106號', mainBankCode: '012', status: 'TERMINATED',
      receiptDate: '2025-11-01', confirmationDeadline: '2025-12-10', note: '債務人違約',
      plan: { monthlyInstallment: 20000, planInstallments: 12, planStartDate: '2025-12-01' },
      periods: [{ period: '2025-12', actualReceivedTotal: 20000 }],
      terminatedAt: '2026-03-15', terminationReason: '債務人連續三期未依調解方案繳款，宣告毀諾。',
      participants: [
        { bankCode: '012', role: 'MAIN', planRatio: 0.6, confirm: 'NOT_REQUIRED', items: commonItems(300000) },
        { bankCode: '808', role: 'CO_BANK', planRatio: 0.4, confirm: 'CONFIRMED', items: commonItems(200000) },
      ],
    },
  ]

  for (const spec of specs) {
    await createCase(spec, admin.userId, userByBank)
  }

  console.log(`✅ 種子完成（Demo）：${BANKS.length} 家機構、${COURTS.length} 所法院、示範帳號、${specs.length} 件全階段案件`)
}

async function createCase(spec: CaseSpec, adminId: string, userByBank: Record<string, string>) {
  const beyondConfirm = spec.status === 'IN_REPAYMENT' || spec.status === 'SETTLED' || spec.status === 'TERMINATED'
  const createdBy = userByBank[spec.mainBankCode] ?? adminId

  const c = await prisma.case.create({
    data: {
      courtCode: spec.courtCode,
      docNumber: spec.docNumber,
      mainBankCode: spec.mainBankCode,
      status: spec.status as any,
      receiptDate: spec.receiptDate ? new Date(spec.receiptDate) : null,
      confirmationDeadline: spec.confirmationDeadline ? new Date(spec.confirmationDeadline) : null,
      note: spec.note,
      createdBy,
      monthlyInstallment: spec.plan ? new Prisma.Decimal(spec.plan.monthlyInstallment) : null,
      planInstallments: spec.plan?.planInstallments ?? null,
      planStartDate: spec.plan ? new Date(spec.plan.planStartDate) : null,
      confirmedAt: beyondConfirm ? new Date() : null,
      settledAt: spec.settledAt ? new Date(spec.settledAt) : null,
      terminatedAt: spec.terminatedAt ? new Date(spec.terminatedAt) : null,
      terminationReason: spec.terminationReason ?? null,
    },
  })

  const partIdByBank: Record<string, string> = {}
  let totalDebt = 0

  for (const p of spec.participants) {
    const claim = itemsTotal(p.items)
    // 凍結時機：CO_BANK 於確認時凍結；MAIN 或確認後階段一律凍結
    const frozen = beyondConfirm || p.confirm === 'CONFIRMED' || p.role === 'MAIN'
    if (frozen) totalDebt = r4(totalDebt + claim)

    const confirmerId = p.confirm === 'CONFIRMED' ? userByBank[p.bankCode] ?? null : null
    const part = await prisma.caseParticipantBank.create({
      data: {
        caseId: c.caseId,
        bankCode: p.bankCode,
        roleInCase: p.role as any,
        planRatio: new Prisma.Decimal(p.planRatio),
        confirmationStatus: p.confirm as any,
        confirmedBy: confirmerId,
        confirmedAt: p.confirm === 'CONFIRMED' ? new Date() : null,
        disputeReason: p.confirm === 'DISPUTED' ? p.disputeReason ?? null : null,
        disputedAt: p.confirm === 'DISPUTED' ? new Date() : null,
        confirmedClaimAmount: frozen ? new Prisma.Decimal(claim) : null,
        items: {
          create: p.items.map((it) => ({
            claimType: it.claimType as any,
            principal: new Prisma.Decimal(it.principal),
            interest: new Prisma.Decimal(it.interest),
            penalty: new Prisma.Decimal(it.penalty),
            otherFee: new Prisma.Decimal(it.otherFee),
            internalTotal: new Prisma.Decimal(it.internalTotal ?? 0),
          })),
        },
      },
    })
    partIdByBank[p.bankCode] = part.participantId
  }

  // 只有確認後階段才凍結案件總額
  if (beyondConfirm) {
    await prisma.case.update({ where: { caseId: c.caseId }, data: { totalDebtAmount: new Prisma.Decimal(totalDebt) } })
  }

  // 還款期別 + 攤提（尾差由主辦吸收）
  if (spec.plan && spec.periods && spec.periods.length) {
    const parts = spec.participants.map((p) => ({
      bankCode: p.bankCode,
      ratio: p.planRatio,
      isMain: p.role === 'MAIN',
      participantId: partIdByBank[p.bankCode],
    }))
    const recordedBy = userByBank[spec.mainBankCode] ?? adminId

    for (const per of spec.periods) {
      const planned = splitByRatio(spec.plan.monthlyInstallment, parts)
      const actual = splitByRatio(per.actualReceivedTotal, parts)
      const hasRounding = actual.remainder !== 0

      const period = await prisma.repaymentPeriod.create({
        data: {
          caseId: c.caseId,
          period: per.period,
          actualReceivedTotal: new Prisma.Decimal(per.actualReceivedTotal),
          hasRoundingAdjust: hasRounding,
          recordedBy,
        },
      })
      for (const p of parts) {
        await prisma.repaymentAllocation.create({
          data: {
            periodId: period.periodId,
            participantId: p.participantId,
            plannedAmount: new Prisma.Decimal(planned.amounts[p.bankCode]),
            actualAmount: new Prisma.Decimal(actual.amounts[p.bankCode]),
            roundingAdjustment: new Prisma.Decimal(p.isMain ? actual.remainder : 0),
          },
        })
      }
    }
  }
}

// 依比例攤提；尾差記入主辦，確保加總＝total
function splitByRatio(
  total: number,
  parts: { bankCode: string; ratio: number; isMain: boolean }[],
): { amounts: Record<string, number>; remainder: number } {
  const amounts: Record<string, number> = {}
  let allocated = 0
  const mainBank = parts.find((p) => p.isMain)!
  for (const p of parts) {
    if (p.isMain) continue
    const a = r4(total * p.ratio)
    amounts[p.bankCode] = a
    allocated = r4(allocated + a)
  }
  const mainShare = r4(total * mainBank.ratio)
  const mainActual = r4(total - allocated) // 主辦吸收尾差
  amounts[mainBank.bankCode] = mainActual
  const remainder = r4(mainActual - mainShare)
  return { amounts, remainder }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
