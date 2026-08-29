import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Spinner({ className }: { className?: string }) {
  return <Loader2 aria-hidden className={cn('size-4 animate-spin', className)} />
}

export function FullPageSpinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex h-full min-h-svh w-full items-center justify-center">
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <Spinner />
        <span>{label}…</span>
      </div>
    </div>
  )
}
