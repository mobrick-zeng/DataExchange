import type { ReactNode } from 'react'

interface BadgeProps {
  className?: string
  children: ReactNode
}

/** 通用徽章外框，實際顏色由呼叫端依狀態對照表傳入 className */
export function Badge({ className = '', children }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${className}`}
    >
      {children}
    </span>
  )
}
