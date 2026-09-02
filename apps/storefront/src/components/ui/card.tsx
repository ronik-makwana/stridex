import type * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * A surface, in this app's idiom rather than shadcn's default.
 *
 * Deliberately not the admin's card: that one is `rounded-xl` with a heavier
 * shadow, which suits a dense operator UI and reads as soft and generic here.
 * The storefront runs a 0.25rem radius and a hairline border, so a card is a
 * sheet of paper on a tinted ground, not a floating panel.
 *
 * Copied rather than shared, per the rule that no import crosses from
 * `apps/admin` — the two design languages are meant to drift.
 */
function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn('bg-card text-card-foreground border-border rounded-lg border shadow-sm', className)}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('p-6 sm:p-8', className)} {...props} />
}

export { Card, CardContent }
