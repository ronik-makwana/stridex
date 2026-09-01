import { Button } from '@/components/ui/button'

/**
 * Numbered pages, not infinite scroll. A customer who opens a product and comes
 * back must land where they were, and the URL carries `?page=` so they do —
 * infinite scroll loses that, and loses the footer with it.
 */
export function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number
  totalPages: number
  onChange: (page: number) => void
}) {
  if (totalPages <= 1) return null

  // A compact window around the current page: 1 … 4 5 6 … 71.
  const around = [page - 1, page, page + 1].filter((n) => n > 1 && n < totalPages)
  const numbers = [...new Set([1, ...around, totalPages])].sort((a, b) => a - b)

  return (
    <nav className="mt-14 flex items-center justify-center gap-2" aria-label="Pagination">
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        Previous
      </Button>

      <div className="flex items-center gap-1">
        {numbers.map((n, index) => (
          <span key={n} className="flex items-center gap-1">
            {index > 0 && numbers[index - 1]! < n - 1 && (
              <span className="text-muted-foreground px-1 text-sm">…</span>
            )}
            <Button
              variant={n === page ? 'default' : 'ghost'}
              size="sm"
              aria-current={n === page ? 'page' : undefined}
              onClick={() => onChange(n)}
              className="min-w-9 tabular-nums"
            >
              {n}
            </Button>
          </span>
        ))}
      </div>

      <Button
        variant="outline"
        size="sm"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
      >
        Next
      </Button>
    </nav>
  )
}
