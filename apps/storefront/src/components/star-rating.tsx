import * as React from 'react'
import { Star } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Read-only stars. Deliberately not amber: the storefront has one accent and it
 * is spent on sale prices, so a gold star introduced here would compete with
 * the discount pill further up the same page.
 */
export function Stars({
  value,
  size = 14,
  className,
}: {
  value: number
  size?: number
  className?: string
}) {
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)} aria-hidden>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          style={{ width: size, height: size }}
          className={n <= Math.round(value) ? 'fill-foreground text-foreground' : 'fill-border text-border'}
        />
      ))}
    </span>
  )
}

/**
 * The input. A radio group under the hood, not five buttons: arrow keys move
 * between ratings, the whole control is one tab stop, and a screen reader
 * announces it as the single choice it is.
 */
export function StarRatingInput({
  value,
  onChange,
  disabled,
  id,
}: {
  value: number
  onChange: (rating: number) => void
  disabled?: boolean
  id?: string
}) {
  const [hovered, setHovered] = React.useState<number | null>(null)
  const shown = hovered ?? value

  return (
    <div
      id={id}
      role="radiogroup"
      aria-label="Rating"
      className="inline-flex items-center gap-1"
      onMouseLeave={() => setHovered(null)}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} ${n === 1 ? 'star' : 'stars'}`}
          disabled={disabled}
          // Only the selected star is tabbable, so the group is one stop and the
          // arrow keys do the rest — the standard radio-group pattern.
          tabIndex={value === n || (value === 0 && n === 1) ? 0 : -1}
          onClick={() => onChange(n)}
          onMouseEnter={() => setHovered(n)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
              event.preventDefault()
              onChange(Math.min(5, (value || 0) + 1))
            }
            if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
              event.preventDefault()
              onChange(Math.max(1, (value || 1) - 1))
            }
          }}
          className="rounded-sm p-0.5 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Star
            className={cn(
              'size-7 transition-colors',
              n <= shown ? 'fill-foreground text-foreground' : 'fill-secondary text-border',
            )}
          />
        </button>
      ))}
    </div>
  )
}
