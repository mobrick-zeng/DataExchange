import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from '@/layouts/AppLayout'
import { AuthLayoutRoute } from '@/layouts/AuthLayoutRoute'
import { LoginPage } from '@/pages/LoginPage'
import { RegisterPage } from '@/pages/RegisterPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { ForgotPasswordPage } from '@/pages/ForgotPasswordPage'
import { CasesPage } from '@/pages/CasesPage'
import { CaseEditorPage } from '@/pages/CaseEditorPage'
import { CaseDetailPage } from '@/pages/CaseDetailPage'
import { AdminUsersPage } from '@/pages/AdminUsersPage'
import { AuditLogsPage } from '@/pages/AuditLogsPage'

/**
 * 路由架構（後端整合版）：
 * - 未登入區：登入／邀請制註冊（含密碼重設，皆以 ?code= 邀請碼）／忘記密碼（申請重置碼）
 * - 登入後區：Dashboard、案件列表／新增／詳情、使用者與權限管理、操作紀錄，皆串接後端 API
 * 帳號採邀請制，故已移除公開自助註冊的 Email OTP 驗證頁、待審核頁與舊版密碼重設頁。
 * 案件流程採後端「代填→確認/異議→還款」模型，舊版「自行申報／退回補件」頁（DeclarationPage）已停用。
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AuthLayoutRoute />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      </Route>

      <Route element={<AppLayout />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/cases" element={<CasesPage />} />
        <Route path="/cases/new" element={<CaseEditorPage />} />
        <Route path="/cases/:caseId" element={<CaseDetailPage />} />
        <Route path="/cases/:caseId/edit" element={<CaseEditorPage />} />
        <Route path="/admin/users" element={<AdminUsersPage />} />
        <Route path="/audit-logs" element={<AuditLogsPage />} />
      </Route>

      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
