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
  corsOrigins: (process.env.CORS_ORIGIN ?? 'http://localhost:5176')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
}
