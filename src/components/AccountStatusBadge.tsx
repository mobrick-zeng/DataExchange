import type { AccountStatus } from '@/types'
import { ACCOUNT_STATUS_BADGE_CLASS, ACCOUNT_STATUS_LABELS } from '@/utils/labels'
import { Badge } from './Badge'

export function AccountStatusBadge({ status }: { status: AccountStatus }) {
  return <Badge className={ACCOUNT_STATUS_BADGE_CLASS[status]}>{ACCOUNT_STATUS_LABELS[status]}</Badge>
}
