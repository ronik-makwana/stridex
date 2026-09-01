import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ListMeta } from '@/types/api'

export function DataTablePagination({
  meta,
  onPageChange,
  isFetching = false,
}: {
  meta: ListMeta | undefined
  onPageChange: (page: number) => void
  isFetching?: boolean
}) {
  if (!meta || meta.total === 0) return null

  // Derived rather than trusted: an endpoint that forgets `totalPages` would
  // otherwise compare `undefined <= 1`, come out false, and render "Page 1 of
  // undefined" under a list that fits on one page.
  const totalPages = meta.totalPages || Math.max(1, Math.ceil(meta.total / meta.limit))

  // One page of results needs no controls; showing disabled ones is noise.
  if (totalPages <= 1) return null

  const first = (meta.page - 1) * meta.limit + 1
  const last = Math.min(meta.page * meta.limit, meta.total)

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-muted-foreground text-sm" aria-live="polite">
        {first}–{last} of {meta.total}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={meta.page <= 1 || isFetching}
          onClick={() => onPageChange(meta.page - 1)}
        >
          <ChevronLeft className="size-4" />
          Previous
        </Button>
        <span className="text-muted-foreground px-1 text-sm">
          Page {meta.page} of {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={meta.page >= totalPages || isFetching}
          onClick={() => onPageChange(meta.page + 1)}
        >
          Next
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  )
}
