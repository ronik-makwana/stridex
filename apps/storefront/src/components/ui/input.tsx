import type * as React from 'react'
import { cn } from '@/lib/utils'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // `text-base` at every breakpoint, not `md:text-sm`: iOS Safari zooms
        // the viewport on focus for anything under 16px, and a checkout form
        // that jumps on the first tap loses orders.
        'border-input placeholder:text-muted-foreground flex h-11 w-full min-w-0 rounded-md border bg-transparent px-3.5 py-2 text-base transition-colors outline-none',
        'focus-visible:border-ring focus-visible:outline-ring focus-visible:outline-2 focus-visible:-outline-offset-1',
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-destructive aria-invalid:focus-visible:outline-destructive',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
