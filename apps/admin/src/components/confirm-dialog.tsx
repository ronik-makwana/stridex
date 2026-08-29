import * as React from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { buttonVariants } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

type ConfirmDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: React.ReactNode
  /** Omit to leave only Cancel — a dialog that only has bad news to deliver. */
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'default' | 'destructive'
  /** Awaited, so the button can show a spinner and the dialog stays open on failure. */
  onConfirm: () => void | Promise<void>
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
}: ConfirmDialogProps) {
  const [pending, setPending] = React.useState(false)

  const run = async () => {
    setPending(true)
    try {
      await onConfirm()
    } finally {
      setPending(false)
    }
  }

  return (
    <AlertDialog
      open={open}
      // A close while an action is in flight would strand the spinner.
      onOpenChange={(next) => !pending && onOpenChange(next)}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription asChild={typeof description !== 'string'}>
            {description}
          </AlertDialogDescription>}
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel
            disabled={pending}
            className={cn(buttonVariants({ variant: 'outline' }))}
          >
            {cancelLabel}
          </AlertDialogCancel>

          {confirmLabel && (
            <AlertDialogAction
              disabled={pending}
              onClick={(event) => {
                // Radix closes on action click; the dialog must survive a failed
                // request so the error is visible next to what caused it.
                event.preventDefault()
                void run()
              }}
              className={cn(buttonVariants({ variant }))}
            >
              {pending && <Spinner />}
              {confirmLabel}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
