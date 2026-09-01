import type * as React from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The platform's own select, styled to match `Input`.
 *
 * Deliberately not a Radix listbox: on a phone this opens the native picker —
 * the wheel the customer already knows, positioned by the OS, immune to a
 * keyboard covering half the page — and that is worth more on a checkout than
 * a menu that matches the design system exactly.
 *
 * `appearance-none` drops the platform arrow so the chevron can sit where the
 * rest of the form's chevrons do; the padding leaves room for it.
 */
function Select({ className, children, ...props }: React.ComponentProps<'select'>) {
  return (
    <div className="relative">
      <select
        data-slot="select"
        className={cn(
          // `text-base` for the same reason as Input: anything smaller and iOS
          // Safari zooms the page on focus.
          'border-input flex h-11 w-full min-w-0 appearance-none rounded-md border bg-transparent px-3.5 py-2 pr-10 text-base transition-colors outline-none',
          'focus-visible:border-ring focus-visible:outline-ring focus-visible:outline-2 focus-visible:-outline-offset-1',
          'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
          'aria-invalid:border-destructive aria-invalid:focus-visible:outline-destructive',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className="text-muted-foreground pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2"
        aria-hidden
      />
    </div>
  )
}

export { Select }
