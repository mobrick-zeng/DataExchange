import type { Role } from '@/types'
import { ROLE_BADGE_CLASS, ROLE_LABELS } from '@/utils/labels'
import { Badge } from './Badge'

export function RoleBadge({ role }: { role: Role | null }) {
  if (!role) return <Badge className="bg-slate-500/15 text-slate-700 ring-1 ring-inset ring-slate-500/30">未指派角色</Badge>
  return <Badge className={ROLE_BADGE_CLASS[role]}>{ROLE_LABELS[role]}</Badge>
}
