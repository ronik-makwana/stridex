import { Link } from 'react-router'
import { X } from 'lucide-react'
import { Price } from '@/components/price'
import { QuantityStepper } from '@/components/quantity-stepper'
import { cn } from '@/lib/utils'
import { formatMoney } from '@/lib/format'
import type { CartLine } from '@/types/api'

/**
 * One line, in the drawer and on the cart page alike — `compact` is the only
 * difference between them, because two copies of this would be two places for
 * the stale-cart states to drift.
 *
 * Those states are the point of the screen. The reason renders inline above the
 * line it belongs to, in amber, one sentence, no icon: a page-level "some items
 * changed" banner makes the customer hunt for which (§16).
 */
export function CartLineRow({
  line,
  onQuantityChange,
  onRemove,
  busy = false,
  compact = false,
  onNavigate,
}: {
  line: CartLine
  onQuantityChange: (quantity: number) => void
  onRemove: () => void
  busy?: boolean
  compact?: boolean
  /** Closes the drawer when a line is clicked through to its product. */
  onNavigate?: () => void
}) {
  const image = line.image
  const title = line.title ?? 'This item'

  return (
    <div className={cn('flex gap-4 py-5', compact && 'py-4')}>
      <div
        className={cn(
          'bg-secondary relative shrink-0 overflow-hidden',
          compact ? 'h-24 w-20' : 'h-32 w-28',
          // A line that cannot be bought reads as inactive rather than shouting.
          !line.purchasable && 'opacity-50',
        )}
      >
        {image ? (
          <img
            src={image.url}
            alt={image.altText ?? title}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {line.brand && (
              <p className="text-muted-foreground text-xs tracking-[0.08em] uppercase">
                {line.brand.name}
              </p>
            )}
            {line.slug ? (
              <Link
                to={`/products/${line.slug}`}
                onClick={onNavigate}
                className="mt-0.5 block truncate text-sm hover:underline"
              >
                {title}
              </Link>
            ) : (
              <p className="text-muted-foreground mt-0.5 truncate text-sm">{title}</p>
            )}
            {line.options.length > 0 && (
              <p className="text-muted-foreground mt-1 text-xs">
                {line.options.map((option) => option.value).join(' / ')}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={onRemove}
            disabled={busy}
            aria-label={`Remove ${title}`}
            className="text-muted-foreground hover:text-foreground -mr-1 shrink-0 p-1 transition-colors disabled:opacity-40"
          >
            <X className="size-4" />
          </button>
        </div>

        {/*
          Above the controls, not below: it explains what the customer is about
          to look at — a price that moved, a quantity that shrank — before they
          read the number it changed.
        */}
        {line.reason && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-500">
            <span aria-hidden>⚠</span>
            <span>
              {line.reason.message}
              {line.reason.code === 'PRICE_CHANGED' && line.reason.previousPrice && (
                <>
                  {' — was '}
                  <span className="line-through">{formatMoney(line.reason.previousPrice)}</span>
                </>
              )}
            </span>
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          {line.purchasable ? (
            <>
              <Price
                price={line.price}
                compareAtPrice={line.compareAtPrice}
                discountPercent={line.discountPercent}
                size="sm"
              />
              <QuantityStepper
                quantity={line.quantity}
                max={Math.max(line.maxQuantity, line.quantity)}
                onChange={onQuantityChange}
                disabled={busy}
              />
              {/* The line total, which the server computed. Nothing here multiplies. */}
              <span className="text-sm tabular-nums">{formatMoney(line.lineTotal)}</span>
            </>
          ) : (
            <button
              type="button"
              onClick={onRemove}
              disabled={busy}
              className="text-sm underline underline-offset-4 disabled:opacity-40"
            >
              Remove
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
