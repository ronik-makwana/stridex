import { Minus, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * − 1 + on a cart line. The ceiling comes from the server's `maxQuantity`,
 * which is itself capped at ten — so this control can never offer a quantity
 * the server would refuse, and it never learns an actual stock count (§18).
 *
 * There is no zero: decrementing past one does nothing, and removing is the ✕
 * beside it. A stepper that deletes at zero is how people lose a line they were
 * only adjusting.
 */
export function QuantityStepper({
  quantity,
  max,
  onChange,
  disabled = false,
  className,
}: {
  quantity: number
  max: number
  onChange: (next: number) => void
  disabled?: boolean
  className?: string
}) {
  const button =
    'flex size-8 items-center justify-center transition-colors hover:bg-secondary disabled:pointer-events-none disabled:opacity-35'

  return (
    <div className={cn('flex w-fit items-center border', className)}>
      <button
        type="button"
        className={button}
        aria-label="Decrease quantity"
        disabled={disabled || quantity <= 1}
        onClick={() => onChange(quantity - 1)}
      >
        <Minus className="size-3.5" />
      </button>
      <span className="min-w-8 text-center text-sm tabular-nums" aria-live="polite">
        {quantity}
      </span>
      <button
        type="button"
        className={button}
        aria-label="Increase quantity"
        disabled={disabled || quantity >= max}
        onClick={() => onChange(quantity + 1)}
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  )
}
