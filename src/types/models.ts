import type { BankCode, Role } from './enums'

/**
 * 登入 session 使用者（前端只保留顯示與導覽所需的最小欄位）。
 * 完整資料由各 API 端點按需回傳，不在前端長期保存個資。
 */
export interface User {
  userId: string
  name: string
  email: string
  role: Role
  bankCode: BankCode
  bankName?: string | null
}

/** 機構主檔（/api/banks、/api/auth/active-banks 回傳） */
export interface Bank {
  bankCode: BankCode
  bankName: string
  type?: 'BANK' | 'PLATFORM'
  isActive?: boolean
}

/** 法院主檔（/api/courts 回傳） */
export interface Court {
  courtCode: string
  courtName: string
  courtType?: string | null
  isActive?: boolean
}
