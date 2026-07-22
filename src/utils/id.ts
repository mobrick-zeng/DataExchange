/** 產生前端 Mock 用的唯一識別碼（正式版應改為後端資料庫產生的主鍵） */
export function generateId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10)
  const time = Date.now().toString(36)
  return `${prefix}_${time}${random}`
}

/** 產生 6 位數 OTP 驗證碼 */
export function generateOtpCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}
