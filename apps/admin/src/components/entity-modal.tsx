import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { cn } from '@/lib/utils'

type EntityModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  /** Blocks accidental close — Esc, overlay click and Cancel all route here. */
  isDirty?: boolean
  isSubmitting?: boolean
  submitLabel?: string
  /** The `<form id>` the footer button submits, so the footer can sit outside it. */
  formId: string
  className?: string
  children: React.ReactNode
  footer?: React.ReactNode
}

/**
 * The centred dialog used for every small entity: brands now, attributes,
 * variant options and categories later. Products and collections get full
 * pages instead — a modal cannot hold them.
 */
export function EntityModal({
  open,
  onOpenChange,
  title,
  description,
  isDirty = false,
  isSubmitting = false,
  submitLabel = 'Save',
  formId,
  className,
  children,
  footer,
}: EntityModalProps) {
  const [confirmingDiscard, setConfirmingDiscard] = React.useState(false)

  const requestClose = React.useCallback(() => {
    if (isDirty) setConfirmingDiscard(true)
    else onOpenChange(false)
  }, [isDirty, onOpenChange])

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (next) onOpenChange(true)
          else requestClose()
        }}
      >
        <DialogContent
          // Overrides the primitive's padded grid: this shell is a column of
          // fixed header, scrolling body and fixed footer.
          className={cn('flex max-h-[calc(100svh-4rem)] flex-col gap-0 p-0', className)}
          // Radix would close on Esc and on an overlay click before our own
          // handler sees it, so both are intercepted and routed through the
          // unsaved-changes guard.
          onEscapeKeyDown={(event) => {
            event.preventDefault()
            requestClose()
          }}
          onPointerDownOutside={(event) => {
            event.preventDefault()
            requestClose()
          }}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <DialogHeader className="border-b py-4 pr-12 pl-6">
            <DialogTitle>{title}</DialogTitle>
            {description ? (
              <DialogDescription>{description}</DialogDescription>
            ) : (
              // Radix warns without one, and screen readers announce an empty
              // description as nothing, which is the intent here.
              <DialogDescription className="sr-only">{title}</DialogDescription>
            )}
          </DialogHeader>

          {/* The body scrolls, not the page: the footer stays reachable on a
              short viewport without hunting for it. */}
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>

          <DialogFooter className="border-t px-6 py-4">
            {footer ?? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={requestClose}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button type="submit" form={formId} disabled={isSubmitting}>
                  {isSubmitting && <Spinner />}
                  {submitLabel}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmingDiscard}
        onOpenChange={setConfirmingDiscard}
        title="Discard your changes?"
        description="This form has edits that have not been saved. Closing now loses them."
        confirmLabel="Discard"
        variant="destructive"
        onConfirm={() => {
          setConfirmingDiscard(false)
          onOpenChange(false)
        }}
      />
    </>
  )
}
