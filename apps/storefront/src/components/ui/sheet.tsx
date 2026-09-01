import type * as React from 'react'
import * as SheetPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * A side drawer. Phase 11 uses it for the mobile nav; Phase 14's cart drawer
 * mounts on the same primitive so the two never animate differently.
 *
 * Radix keeps the node mounted while it animates out, which is why the
 * `data-[state=closed]` classes below need real keyframes — see globals.css.
 */
const Sheet = SheetPrimitive.Root
const SheetTrigger = SheetPrimitive.Trigger
const SheetClose = SheetPrimitive.Close

function SheetContent({
  className,
  children,
  side = 'right',
  title,
  description,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: 'left' | 'right'
  /** Required by Radix for the accessible name; visually hidden by default. */
  title: string
  description?: string
}) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay
        className={cn(
          'fixed inset-0 z-50 bg-foreground/25',
          'data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out',
        )}
      />
      <SheetPrimitive.Content
        className={cn(
          'bg-background fixed inset-y-0 z-50 flex h-full w-full max-w-sm flex-col outline-none',
          side === 'right'
            ? 'right-0 border-l data-[state=open]:animate-drawer-in-right data-[state=closed]:animate-drawer-out-right'
            : 'left-0 border-r data-[state=open]:animate-drawer-in-left data-[state=closed]:animate-drawer-out-left',
          className,
        )}
        {...props}
      >
        <SheetPrimitive.Title className="sr-only">{title}</SheetPrimitive.Title>
        <SheetPrimitive.Description className="sr-only">
          {description ?? title}
        </SheetPrimitive.Description>
        {children}
        <SheetPrimitive.Close
          aria-label="Close"
          className="text-muted-foreground hover:text-foreground absolute top-4 right-4 rounded-sm transition-colors"
        >
          <X className="size-5" />
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  )
}

export { Sheet, SheetTrigger, SheetClose, SheetContent }
