import { CalendarClock, CircleDot, CircleOff } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { DiscountState } from '@/types/api'

/**
 * Three states, none of them stored: all read off the clock against the active
 * dates, so a discount that has run out says so the moment it does rather than
 * when some job happens to notice.
 */
const STATE = {
  ACTIVE: { label: 'Active', variant: 'success', icon: CircleDot },
  SCHEDULED: { label: 'Scheduled', variant: 'outline', icon: CalendarClock },
  EXPIRED: { label: 'Expired', variant: 'destructive', icon: CircleOff },
} as const satisfies Record<DiscountState, { label: string; variant: string; icon: unknown }>

export const DISCOUNT_STATE_OPTIONS = (['ACTIVE', 'SCHEDULED', 'EXPIRED'] as const).map(
  (value) => ({ value, label: STATE[value].label }),
)

export function DiscountStateBadge({ state }: { state: DiscountState }) {
  const { label, variant, icon: Icon } = STATE[state]
  return (
    <Badge variant={variant}>
      <Icon className="size-2.5" aria-hidden />
      {label}
    </Badge>
  )
}
