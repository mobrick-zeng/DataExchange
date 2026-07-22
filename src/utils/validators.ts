const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidEmail(value: string): boolean {
  return EMAIL_REGEX.test(value.trim())
}

export type PasswordStrength = 'weak' | 'medium' | 'strong'

/**
 * 密碼強度規則（依規劃文件）：
 * - 至少 8 碼
 * - 至少包含 1 個英文字母 + 1 個數字
 * - 大小寫混合／特殊符號為加分項，非強制
 */
export function isPasswordValid(password: string): boolean {
  if (password.length < 8) return false
  const hasLetter = /[A-Za-z]/.test(password)
  const hasDigit = /\d/.test(password)
  return hasLetter && hasDigit
}

export function getPasswordStrength(password: string): PasswordStrength {
  if (!isPasswordValid(password)) return 'weak'
  let score = 0
  if (password.length >= 10) score += 1
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1
  if (/[^A-Za-z0-9]/.test(password)) score += 1
  if (score >= 2) return 'strong'
  if (score === 1) return 'medium'
  return 'medium'
}

export const PASSWORD_STRENGTH_LABEL: Record<PasswordStrength, string> = {
  weak: '弱',
  medium: '中',
  strong: '強',
}

export const PASSWORD_STRENGTH_COLOR: Record<PasswordStrength, string> = {
  weak: 'bg-rose-500',
  medium: 'bg-amber-500',
  strong: 'bg-emerald-500',
}

export function isNonEmpty(value: string | undefined | null): boolean {
  return !!value && value.trim().length > 0
}
