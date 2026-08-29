import type * as React from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Two distinct empty states share this: "nothing exists yet" (offer the primary
 * action) and "nothing matched" (offer to clear the filters). Never the same
 * copy for both — the first is an invitation, the second is a dead end.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      {Icon && (
        <div className="bg-muted text-muted-foreground mb-3 flex size-10 items-center justify-center rounded-full">
          <Icon className="size-5" aria-hidden />
        </div>
      )}
      <p className="text-sm font-medium">{title}</p>
      {description && (
        <p className="text-muted-foreground mt-1 max-w-sm text-sm">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
