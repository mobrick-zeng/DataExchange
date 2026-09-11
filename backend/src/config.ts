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
  // 全域每分鐘請求上限。預設 100；僅自動化測試環境需要調高，正式環境請勿更動。
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX ?? 100),
  // 認證類端點（登入／啟用／密碼重置）的較嚴上限。預設 10；同上，僅測試環境調高。
  authRateLimitMax: Number(process.env.AUTH_RATE_LIMIT_MAX ?? 10),
}
