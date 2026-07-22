import { EmptyState } from './EmptyState'

interface ComingSoonProps {
  title: string
}

/** 尚未實作頁面的統一占位畫面，避免導覽選單連結失效 */
export function ComingSoon({ title }: ComingSoonProps) {
  return (
    <div className="p-6">
      <EmptyState
        icon="🚧"
        title={`「${title}」將於下一階段實作`}
        description="此頁面已於規劃文件中定義完整規格，將依開發順序於後續階段完成。"
      />
    </div>
  )
}
