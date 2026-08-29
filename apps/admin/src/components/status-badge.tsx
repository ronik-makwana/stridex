import { Archive, Circle, CircleDot } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { EntityStatus } from '@/types/api'

const STATUS = {
  ACTIVE: { label: 'Active', variant: 'success', icon: CircleDot },
  DRAFT: { label: 'Draft', variant: 'muted', icon: Circle },
  ARCHIVED: { label: 'Archived', variant: 'outline', icon: Archive },
} as const satisfies Record<EntityStatus, { label: string; variant: string; icon: unknown }>

export const STATUS_OPTIONS = (
  Object.entries(STATUS) as [EntityStatus, (typeof STATUS)[EntityStatus]][]
).map(([value, { label }]) => ({ value, label }))

/** One vocabulary — brands, categories, products, variants, collections. */
export function StatusBadge({ status }: { status: EntityStatus }) {
  const { label, variant, icon: Icon } = STATUS[status]
  return (
    <Badge variant={variant}>
      <Icon className="size-2.5" aria-hidden />
      {label}
    </Badge>
  )
}
