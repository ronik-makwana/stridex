import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Spinner({ className }: { className?: string }) {
  return <Loader2 aria-hidden className={cn('size-4 animate-spin', className)} />
}

/**
 * Only for the auth bootstrap, where the app genuinely cannot decide what to
 * render yet. Every other async region gets a skeleton shaped like its content,
 * not a spinner — a grid that flashes a spinner and then reflows is the thing
 * the skeleton rule exists to prevent.
 */
export function FullPageSpinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex min-h-svh w-full items-center justify-center">
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <Spinner />
        <span>{label}…</span>
      </div>
    </div>
  )
}
