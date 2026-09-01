import { cn } from '@/lib/utils'
import type { StockBucket } from '@/types/api'

/**
 * Stock as the customer is allowed to see it. There is no number here and there
 * is no prop that could carry one — the API sends a bucket and nothing else
 * (§18). An exact count is a scraping target and a public read of sales
 * velocity.
 *
 * LOW_STOCK deliberately does not say how few. "Only 2 left" is a stronger
 * nudge and a worse promise: it is stale the moment another customer opens the
 * page, and it hands a competitor a per-SKU run rate.
 */
const LABELS: Record<StockBucket, string> = {
  IN_STOCK: 'In stock',
  LOW_STOCK: 'Only a few left',
  SOLD_OUT: 'Sold out',
}

export function StockLabel({
  stock,
  className,
}: {
  stock: StockBucket
  className?: string
}) {
  return (
    <p
      className={cn(
        'text-sm',
        stock === 'SOLD_OUT' && 'text-muted-foreground',
        // Not the accent: that belongs to price. Low stock is information, not
        // a markdown, and colouring it the same teaches the customer nothing.
        stock === 'LOW_STOCK' && 'text-foreground font-medium',
        stock === 'IN_STOCK' && 'text-muted-foreground',
        className,
      )}
    >
      {LABELS[stock]}
    </p>
  )
}
