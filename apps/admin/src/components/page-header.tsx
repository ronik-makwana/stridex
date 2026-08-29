import type * as React from 'react'
import { Link } from 'react-router'
import { ArrowLeft } from 'lucide-react'

/**
 * Page title on the left, the one primary action on the right.
 *
 * On a detail page, pass `backTo` and the arrow sits inline with the title
 * rather than on a line of its own above it. Splitting them cost a whole row to
 * repeat the name of the list you just came from, when the useful label is the
 * record you are actually looking at.
 */
export function PageHeader({
  title,
  description,
  backTo,
  backLabel = 'Back',
  actions,
}: {
  title: string
  description?: string
  /** Where the ← goes. Omit on list pages. */
  backTo?: string
  backLabel?: string
  actions?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        {backTo && (
          <Link
            to={backTo}
            aria-label={backLabel}
            title={backLabel}
            className="text-muted-foreground hover:text-foreground hover:bg-accent -ml-1.5 rounded-md p-1.5 transition-colors"
          >
            <ArrowLeft className="size-4" />
          </Link>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight">{title}</h1>
          {description && <p className="text-muted-foreground mt-0.5 text-sm">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
