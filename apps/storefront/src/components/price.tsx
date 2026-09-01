import { cn } from '@/lib/utils'
import { formatMoney } from '@/lib/format'

/**
 * Every price in the storefront renders through here, so compare-at and the
 * discount pill can never drift between the card, the product page and the
 * cart.
 *
 * What this shows is *catalog markdown*: `compareAtPrice` against `price` on
 * the variant. It is already inside `price`. It is a strikethrough and a pill,
 * and it must never be re-subtracted anywhere — an order summary that deducts
 * it as well is discounting the product twice (§15.3).
 *
 * The API decides whether a markdown is real (compare-at strictly above price)
 * and floors the percentage. This component never computes one.
 */
export function Price({
  price,
  compareAtPrice,
  discountPercent,
  size = 'default',
  className,
}: {
  price: string | null
  compareAtPrice?: string | null
  discountPercent?: number | null
  size?: 'sm' | 'default' | 'lg'
  className?: string
}) {
  const onSale = Boolean(compareAtPrice && discountPercent)

  return (
    <div className={cn('flex flex-wrap items-baseline gap-x-2.5 gap-y-1', className)}>
      <span
        className={cn(
          'tabular-nums',
          size === 'sm' && 'text-sm',
          size === 'default' && 'text-base',
          size === 'lg' && 'text-2xl',
          // The accent is spent here: a marked-down price is one of the two
          // things in the whole design allowed to use it.
          onSale ? 'text-accent font-medium' : 'font-medium',
        )}
      >
        {formatMoney(price)}
      </span>

      {onSale && (
        <>
          <span
            className={cn(
              'text-muted-foreground tabular-nums line-through',
              size === 'lg' ? 'text-base' : 'text-sm',
            )}
          >
            {formatMoney(compareAtPrice)}
          </span>
          {/*
            A quiet pill, not a loud red block. The badge is already sitting
            beside an accent-coloured price; making it a filled red rectangle as
            well shouts the same fact twice.
          */}
          <span className="text-accent border-accent/30 rounded-full border px-2 py-0.5 text-xs font-medium">
            {discountPercent}% off
          </span>
        </>
      )}
    </div>
  )
}

/** For a card or header where no size is chosen yet and prices differ. */
export function PriceRange({
  min,
  max,
  className,
}: {
  min: string
  max: string
  className?: string
}) {
  if (min === max) return <Price price={min} size="lg" className={className} />
  return (
    <div className={cn('text-2xl font-medium tabular-nums', className)}>
      {formatMoney(min)} – {formatMoney(max)}
    </div>
  )
}
