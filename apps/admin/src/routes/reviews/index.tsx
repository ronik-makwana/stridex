import * as React from 'react'
import { Link } from 'react-router'
import { Eye, EyeOff, MessageSquare, Star, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api-client'
import { useListParams } from '@/hooks/use-list-params'
import { useReviewCounts, useReviews } from '@/features/reviews/queries'
import { useDeleteReview, useSetReviewStatus } from '@/features/reviews/mutations'
import { formatDate } from '@/lib/format'
import type { Review } from '@/types/api'
import { PageHeader } from '@/components/page-header'
import { EmptyState } from '@/components/empty-state'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { DataTablePagination } from '@/components/data-table/data-table-pagination'
import { FilterBar, FilterSelect } from '@/components/data-table/filter-bar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

const STATUS_OPTIONS = [
  { value: 'PUBLISHED', label: 'Published' },
  { value: 'HIDDEN', label: 'Hidden' },
]

const RATING_OPTIONS = [5, 4, 3, 2, 1].map((rating) => ({
  value: String(rating),
  label: `${rating} star${rating === 1 ? '' : 's'}`,
}))

/**
 * Moderation, as a queue of cards rather than a table. A review is a paragraph
 * of somebody's writing and the decision is made by reading it — a truncated
 * cell in a column would mean opening a row to do the one thing this screen is
 * for.
 *
 * Two tools, and they are not the same. **Hide** is reversible and leaves the
 * review where it is; the author still sees their own, which is what stops them
 * writing it again and hitting a 409 that explains nothing. **Delete** frees
 * their slot so they can write another, and is for abuse — a one-star review
 * that is simply true is not a moderation problem.
 */
export default function ReviewsPage() {
  const params = useListParams<'status' | 'rating'>({
    defaultSort: 'created_at:desc',
    filters: ['status', 'rating'],
  })
  const { data, isPending, isFetching } = useReviews(params.toQuery())
  const { data: counts } = useReviewCounts()
  const setStatus = useSetReviewStatus()
  const deleteReview = useDeleteReview()
  const [deleting, setDeleting] = React.useState<Review | null>(null)

  const act = async (run: () => Promise<unknown>, success: string) => {
    try {
      await run()
      toast.success(success)
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'That did not work')
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Reviews"
        description={
          counts
            ? `${counts.published} published · ${counts.hidden} hidden`
            : 'What customers said, and whether it is shown.'
        }
      />

      <FilterBar
        search={params.q}
        onSearchChange={params.setSearch}
        searchPlaceholder="Search the text, a product or an email"
        onClear={params.clear}
        showClear={params.isFiltered}
      >
        <FilterSelect
          label="Status"
          value={params.filters.status}
          onChange={(value) => params.setFilter('status', value)}
          options={STATUS_OPTIONS}
        />
        <FilterSelect
          label="Rating"
          value={params.filters.rating}
          onChange={(value) => params.setFilter('rating', value)}
          options={RATING_OPTIONS}
        />
      </FilterBar>

      {isPending ? (
        <div className="space-y-3">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-32 w-full rounded-lg" />
          ))}
        </div>
      ) : (data?.data.length ?? 0) === 0 ? (
        <EmptyState
          icon={params.isFiltered ? undefined : MessageSquare}
          title={params.isFiltered ? 'No reviews match these filters' : 'No reviews yet'}
          description={
            params.isFiltered
              ? 'Clear the filters to see everything.'
              : 'Customers can review anything they have bought.'
          }
        />
      ) : (
        <ul className="space-y-3">
          {data?.data.map((review) => (
            <li key={review.id}>
              <article
                className={cn(
                  'bg-card rounded-lg border p-5',
                  // A hidden review reads as inactive rather than shouting: it
                  // is still somebody's writing, just not on the page.
                  review.status === 'HIDDEN' && 'opacity-70',
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Stars rating={review.rating} />
                      {review.verifiedPurchase && <Badge variant="success">Verified purchase</Badge>}
                      {review.status === 'HIDDEN' && <Badge variant="muted">Hidden</Badge>}
                    </div>
                    <p className="text-muted-foreground mt-1.5 text-xs">
                      {review.author.name ?? review.author.email} · {review.author.email} ·{' '}
                      {formatDate(review.createdAt)}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void act(
                          () =>
                            setStatus.mutateAsync({
                              id: review.id,
                              status: review.status === 'HIDDEN' ? 'PUBLISHED' : 'HIDDEN',
                            }),
                          review.status === 'HIDDEN' ? 'Published' : 'Hidden from the product page',
                        )
                      }
                    >
                      {review.status === 'HIDDEN' ? (
                        <>
                          <Eye className="size-4" />
                          Publish
                        </>
                      ) : (
                        <>
                          <EyeOff className="size-4" />
                          Hide
                        </>
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Delete review"
                      onClick={() => setDeleting(review)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>

                <p className="mt-3 text-sm leading-relaxed whitespace-pre-line">{review.body}</p>

                <Link
                  to={`/products/${review.product.id}`}
                  className="text-muted-foreground hover:text-foreground mt-3 inline-block text-xs underline underline-offset-4"
                >
                  {review.product.title}
                </Link>
              </article>
            </li>
          ))}
        </ul>
      )}

      <DataTablePagination meta={data?.meta} onPageChange={params.setPage} isFetching={isFetching} />

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this review?"
        description="Deleting frees the customer's slot, so they can write another one about this product. For a review that is merely unfavourable, hide it instead — hiding is reversible and they keep seeing their own."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={async () => {
          if (!deleting) return
          await act(() => deleteReview.mutateAsync(deleting.id), 'Review deleted')
          setDeleting(null)
        }}
      />
    </div>
  )
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="flex items-center gap-0.5" aria-label={`${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={cn('size-3.5', star <= rating ? 'fill-foreground' : 'text-muted-foreground/40')}
        />
      ))}
    </span>
  )
}
