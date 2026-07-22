import { useToastStore } from '@/stores/toastStore'

/** 全站統一的成功／錯誤／提示訊息入口 */
export function useToast() {
  const push = useToastStore((s) => s.push)
  return {
    success: (message: string) => push('success', message),
    error: (message: string) => push('error', message),
    info: (message: string) => push('info', message),
  }
}
