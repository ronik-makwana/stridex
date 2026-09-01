import type * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * A centred modal, on the same Radix primitive as the drawer — so focus
 * trapping, the Escape key and the scroll lock behave identically in both, and
 * neither has its own half-implemented version of them.
 *
 * Unlike the sheet, the title here is *visible*: a drawer is understood from
 * what is inside it, while a dialog that interrupts the page has to say what it
 * is interrupting for.
 */
const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogClose = DialogPrimitive.Close

function DialogContent({
  className,
  children,
  title,
  description,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  title: string
  description?: string
}) {
  return (
    <DialogPrimitive.Portal>
      {/*
        Dimmed *and* blurred. The dim alone leaves the page behind perfectly
        legible, so the eye keeps reading it; taking the detail out of it is
        what makes the form the only thing left to look at. The blur is small —
        enough to push the page back, not so much that the customer loses track
        of where they were.
      */}
      <DialogPrimitive.Overlay
        className={cn(
          'bg-foreground/30 fixed inset-0 z-50 backdrop-blur-sm',
          'data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out',
        )}
      />
      <DialogPrimitive.Content
        className={cn(
          // Scrolls inside itself rather than growing past the viewport: a form
          // with its submit button below the fold is a form nobody submits.
          // The one rounded surface in a deliberately square design: the page
          // is printed, and this is the thing lifted off it. `overflow-hidden`
          // is what stops the header's border and the scrolling body from
          // squaring the corners off again.
          'bg-background fixed top-1/2 left-1/2 z-50 flex max-h-[90svh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border shadow-2xl outline-none',
          'data-[state=open]:animate-modal-in data-[state=closed]:animate-modal-out',
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <div>
            <DialogPrimitive.Title className="text-sm tracking-[0.14em] uppercase">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="text-muted-foreground mt-1 text-sm">
                {description}
              </DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close
            aria-label="Close"
            className="text-muted-foreground hover:text-foreground -mr-1 rounded-sm transition-colors"
          >
            <X className="size-5" />
          </DialogPrimitive.Close>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

export { Dialog, DialogTrigger, DialogClose, DialogContent }
