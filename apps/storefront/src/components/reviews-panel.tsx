import * as React from 'react'
import { Link, useLocation } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { AlertCircle, BadgeCheck, EyeOff } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth'
import { ApiError } from '@/lib/api-client'
import { loginPathFor } from '@/lib/redirect'
import { formatDate } from '@/lib/format'
import {
  useCreateReview,
  useDeleteReview,
  useReviews,
  useUpdateReview,
} from '@/features/reviews/queries'
import type { ReviewSort } from '@/features/reviews/api'
import { REVIEW_BODY_MAX, reviewFormSchema, type ReviewFormValues } from '@/features/reviews/schemas'
import { Stars, StarRatingInput } from '@/components/star-rating'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import type { RatingDistribution, Review } from '@/types/api'

const SORTS: { value: ReviewSort; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'highest', label: 'Highest rated' },
  { value: 'lowest', label: 'Lowest rated' },
]

export function ReviewsPanel({ slug }: { slug: string }) {
  const { isAuthenticated } = useAuth()
  const location = useLocation()
  const [page, setPage] = React.useState(1)
  const [sort, setSort] = React.useState<ReviewSort>('newest')
  const [writing, setWriting] = React.useState(false)

  const { data, isPending } = useReviews(slug, page, sort)

  const summary = data?.meta.summary
  const reviews = data?.data ?? []
  const myReview = reviews.find((review) => review.isMine) ?? null
  const hasReviewed = Boolean(data?.meta.myReviewId)

  return (
    <section className="mt-20 border-t pt-14">
      <h2 className="text-center text-xs tracking-[0.14em] uppercase">Customer reviews</h2>

      {isPending ? (
        <ReviewsSkeleton />
      ) : (
        <>
          <div className="mx-auto mt-10 grid max-w-4xl items-center gap-10 sm:grid-cols-3">
            <div className="text-center sm:text-left">
              <Stars value={summary?.average ?? 0} size={18} className="justify-center sm:justify-start" />
              <p className="mt-3 text-2xl font-medium tabular-nums">
                {(summary?.average ?? 0).toFixed(2)} out of 5
              </p>
              <p className="text-muted-foreground mt-1 text-sm">
                Based on {summary?.total ?? 0} {summary?.total === 1 ? 'review' : 'reviews'}
              </p>
            </div>

            <Distribution
              distribution={summary?.distribution}
              total={summary?.total ?? 0}
            />

            <div className="flex justify-center sm:justify-end">
              {!isAuthenticated ? (
                <div className="text-center">
                  <p className="text-muted-foreground text-sm">Sign in to write a review</p>
                  <Button asChild variant="outline" className="mt-3">
                    <Link to={loginPathFor(location.pathname, location.search)}>Sign in</Link>
                  </Button>
                </div>
              ) : hasReviewed ? (
                <p className="text-muted-foreground text-center text-sm sm:text-right">
                  You have reviewed this product.
                  <br />
                  Edit it below.
                </p>
              ) : (
                <Button variant="outline" onClick={() => setWriting((open) => !open)}>
                  {writing ? 'Cancel review' : 'Write a review'}
                </Button>
              )}
            </div>
          </div>

          {/* Writing a new one. An existing review is edited in place, in its
              own card below, rather than in a second form up here. */}
          {isAuthenticated && writing && !hasReviewed && (
            <div className="mx-auto mt-12 max-w-4xl border-t pt-10">
              <h3 className="text-center text-sm font-medium">Write a review</h3>
              <ReviewForm
                slug={slug}
                onDone={() => {
                  setWriting(false)
                  // A new review is newest; showing page 1 in newest order is
                  // the only view guaranteed to contain it.
                  setPage(1)
                  setSort('newest')
                }}
                onCancel={() => setWriting(false)}
              />
            </div>
          )}

          {reviews.length === 0 ? (
            <p className="text-muted-foreground mt-12 text-center text-sm">
              No reviews yet.{' '}
              {isAuthenticated ? 'Be the first to review this product.' : 'Sign in to be the first.'}
            </p>
          ) : (
            <div className="mx-auto mt-14 max-w-4xl">
              <div className="flex items-center justify-between border-b pb-3">
                <p className="text-muted-foreground text-sm">
                  {data?.meta.total} {data?.meta.total === 1 ? 'review' : 'reviews'}
                </p>
                <label className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Sort</span>
                  <select
                    value={sort}
                    onChange={(event) => {
                      setSort(event.target.value as ReviewSort)
                      setPage(1)
                    }}
                    className="border-input focus-visible:outline-ring rounded-md border bg-transparent px-2 py-1.5 text-sm outline-none focus-visible:outline-2"
                  >
                    {SORTS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <ul className="divide-y">
                {reviews.map((review) => (
                  <li key={review.id} className="py-7">
                    <ReviewItem review={review} slug={slug} isMine={review.id === myReview?.id} />
                  </li>
                ))}
              </ul>

              {(data?.meta.totalPages ?? 1) > 1 && (
                <div className="mt-8 flex items-center justify-center gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((n) => n - 1)}
                  >
                    Previous
                  </Button>
                  <span className="text-muted-foreground text-sm tabular-nums">
                    {page} of {data?.meta.totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= (data?.meta.totalPages ?? 1)}
                    onClick={() => setPage((n) => n + 1)}
                  >
                    Next
                  </Button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}

function Distribution({
  distribution,
  total,
}: {
  distribution: RatingDistribution | undefined
  total: number
}) {
  return (
    <div className="space-y-1.5">
      {([5, 4, 3, 2, 1] as const).map((rating) => {
        const count = distribution?.[rating] ?? 0
        // 0/0 is NaN, which renders as width:"NaN%" and silently disappears.
        const percent = total > 0 ? (count / total) * 100 : 0
        return (
          <div key={rating} className="flex items-center gap-3">
            <Stars value={rating} size={12} />
            <div className="bg-secondary h-1.5 flex-1 overflow-hidden rounded-full">
              <div className="bg-foreground h-full rounded-full" style={{ width: `${percent}%` }} />
            </div>
            <span className="text-muted-foreground w-6 text-right text-xs tabular-nums">
              {count}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function ReviewItem({
  review,
  slug,
  isMine,
}: {
  review: Review
  slug: string
  isMine: boolean
}) {
  const [editing, setEditing] = React.useState(false)
  const remove = useDeleteReview(slug)

  if (editing) {
    return (
      <ReviewForm
        slug={slug}
        review={review}
        onDone={() => setEditing(false)}
        onCancel={() => setEditing(false)}
      />
    )
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Stars value={review.rating} />
        <span className="text-sm font-medium">{review.author}</span>
        {review.verifiedPurchase && (
          <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
            <BadgeCheck className="size-3.5" />
            Verified purchase
          </span>
        )}
        {/* Only ever reaches the author — nobody else is sent a hidden row. */}
        {review.status === 'HIDDEN' && (
          <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
            <EyeOff className="size-3.5" />
            Hidden by a moderator — only you can see this
          </span>
        )}
        <span className="text-muted-foreground ml-auto text-xs">
          {formatDate(review.createdAt)}
        </span>
      </div>

      <p className="mt-3 text-sm leading-relaxed whitespace-pre-line">{review.body}</p>

      {isMine && (
        <div className="mt-4 flex gap-4">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-4"
          >
            Edit
          </button>
          <button
            type="button"
            disabled={remove.isPending}
            onClick={() => {
              if (!window.confirm('Delete your review? This cannot be undone.')) return
              remove.mutate(review.id, {
                onSuccess: () => toast.success('Review deleted'),
                onError: (error) =>
                  toast.error(error instanceof ApiError ? error.message : 'Could not delete that'),
              })
            }}
            className="text-muted-foreground hover:text-destructive text-xs underline underline-offset-4 disabled:opacity-50"
          >
            {remove.isPending ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      )}
    </div>
  )
}

function ReviewForm({
  slug,
  review,
  onDone,
  onCancel,
}: {
  slug: string
  review?: Review
  onDone: () => void
  onCancel: () => void
}) {
  const create = useCreateReview(slug)
  const update = useUpdateReview(slug)
  const [banner, setBanner] = React.useState<string | null>(null)

  const {
    handleSubmit,
    register,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ReviewFormValues>({
    resolver: zodResolver(reviewFormSchema),
    defaultValues: { rating: review?.rating ?? 0, body: review?.body ?? '' },
  })

  const rating = watch('rating')
  const body = watch('body') ?? ''

  const onSubmit = handleSubmit(async (values) => {
    setBanner(null)
    try {
      if (review) await update.mutateAsync({ id: review.id, values })
      else await create.mutateAsync(values)
      toast.success(review ? 'Review updated' : 'Thanks for your review')
      onDone()
    } catch (error) {
      setBanner(
        error instanceof ApiError ? error.message : 'Something went wrong. Try again in a moment.',
      )
    }
  })

  return (
    <form onSubmit={onSubmit} noValidate className="mt-6 space-y-5">
      {banner && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{banner}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="review-rating">Rating</Label>
        <div>
          <StarRatingInput
            id="review-rating"
            value={rating ?? 0}
            // `shouldValidate` so picking a star clears the "pick a rating"
            // error immediately rather than on the next submit.
            onChange={(next) => setValue('rating', next, { shouldValidate: true })}
            disabled={isSubmitting}
          />
        </div>
        {errors.rating && <p className="text-destructive text-sm">{errors.rating.message}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="review-body">Your review</Label>
        <textarea
          id="review-body"
          rows={5}
          maxLength={REVIEW_BODY_MAX}
          placeholder="How do they fit? How do they wear?"
          aria-invalid={Boolean(errors.body)}
          className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-ring aria-invalid:border-destructive w-full resize-y rounded-md border bg-transparent px-3.5 py-2.5 text-base outline-none focus-visible:outline-2 focus-visible:-outline-offset-1"
          {...register('body')}
        />
        <div className="flex items-center justify-between">
          {errors.body ? (
            <p className="text-destructive text-sm">{errors.body.message}</p>
          ) : (
            <span />
          )}
          <span className="text-muted-foreground text-xs tabular-nums">
            {body.length}/{REVIEW_BODY_MAX}
          </span>
        </div>
      </div>

      <div className="flex justify-end gap-3">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : review ? 'Save changes' : 'Submit review'}
        </Button>
      </div>
    </form>
  )
}

function ReviewsSkeleton() {
  return (
    <div className="mx-auto mt-10 grid max-w-4xl gap-10 sm:grid-cols-3">
      <div className="space-y-3">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="space-y-2">
        {[0, 1, 2, 3, 4].map((n) => (
          <Skeleton key={n} className="h-3 w-full" />
        ))}
      </div>
      <div className="flex justify-end">
        <Skeleton className="h-10 w-32" />
      </div>
    </div>
  )
}
