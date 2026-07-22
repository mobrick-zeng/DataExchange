// 集中讀取環境變數，缺少必要值時盡早失敗
function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`缺少必要環境變數：${name}（請檢查 backend/.env）`)
  return v
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
  port: Number(process.env.PORT ?? 4000),
  corsOrigins: (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  // 個資蒐集/利用同意書版本（啟用帳號時記錄）
  consentVersion: process.env.CONSENT_VERSION ?? 'v1-2026-07',
}
