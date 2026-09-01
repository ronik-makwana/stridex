import * as React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { MessageSquareQuote, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api-client'
import { useListParams } from '@/hooks/use-list-params'
import { useTestimonials } from '@/features/testimonials/queries'
import {
  useCreateTestimonial,
  useDeleteTestimonial,
  useSetTestimonialStatus,
  useUpdateTestimonial,
} from '@/features/testimonials/mutations'
import type { Testimonial } from '@/types/api'
import { PageHeader } from '@/components/page-header'
import { EmptyState } from '@/components/empty-state'
import { EntityModal } from '@/components/entity-modal'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { StatusBadge, STATUS_OPTIONS } from '@/components/status-badge'
import { DataTablePagination } from '@/components/data-table/data-table-pagination'
import { FilterBar, FilterSelect } from '@/components/data-table/filter-bar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const FORM_ID = 'testimonial-form'

const schema = z.object({
  quote: z.string().trim().min(10, 'A testimonial needs more than a few words').max(600),
  authorName: z.string().trim().min(1, 'Who said it?').max(120),
  authorRole: z.string().trim().max(120).optional(),
  /**
   * A string in the form and a number on the wire. '' means "no stars", which
   * is a real choice — see the API — and keeping it a string here avoids a
   * coercion that would make the field's type `unknown`.
   */
  rating: z.enum(['', '1', '2', '3', '4', '5']).optional(),
  imageUrl: z.union([z.literal(''), z.url('Enter a valid URL')]).optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']),
})

type Values = z.infer<typeof schema>

/**
 * Front-page quotes, and the screen says so: this is **not** where product
 * reviews are moderated. A review belongs to the customer who wrote it and
 * lives on their product's page; a testimonial is copy somebody chose to
 * publish, which is why it can be written here at all.
 */
export default function TestimonialsPage() {
  const params = useListParams<'status'>({ defaultSort: 'position:asc', filters: ['status'] })
  const { data, isPending, isFetching } = useTestimonials(params.toQuery())
  const createTestimonial = useCreateTestimonial()
  const updateTestimonial = useUpdateTestimonial()
  const setStatus = useSetTestimonialStatus()
  const deleteTestimonial = useDeleteTestimonial()

  const [editing, setEditing] = React.useState<Testimonial | 'new' | null>(null)
  const [deleting, setDeleting] = React.useState<Testimonial | null>(null)

  const rows = data?.data ?? []

  return (
    <div className="space-y-4">
      <PageHeader
        title="Testimonials"
        description="Quotes for the front page. Product reviews are moderated under Reviews."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus className="size-4" />
            Add testimonial
          </Button>
        }
      />

      <FilterBar
        search={params.q}
        onSearchChange={params.setSearch}
        searchPlaceholder="Search the quote or the name"
        onClear={params.clear}
        showClear={params.isFiltered}
      >
        <FilterSelect
          label="Status"
          value={params.filters.status}
          onChange={(value) => params.setFilter('status', value)}
          options={STATUS_OPTIONS}
        />
      </FilterBar>

      {isPending ? (
        <div className="space-y-3">
          {[0, 1].map((row) => (
            <Skeleton key={row} className="h-28 w-full rounded-lg" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={params.isFiltered ? undefined : MessageSquareQuote}
          title={params.isFiltered ? 'Nothing matches these filters' : 'No testimonials yet'}
          description={
            params.isFiltered
              ? 'Clear the filters to see everything.'
              : 'Add a quote and publish it to put it on the home page.'
          }
          action={
            params.isFiltered ? undefined : (
              <Button size="sm" onClick={() => setEditing('new')}>
                <Plus className="size-4" />
                Add testimonial
              </Button>
            )
          }
        />
      ) : (
        <ul className="space-y-3">
          {rows.map((testimonial) => (
            <li key={testimonial.id}>
              <article className="bg-card flex gap-4 rounded-lg border p-5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-relaxed">“{testimonial.quote}”</p>
                  <p className="text-muted-foreground mt-2 text-xs">
                    {testimonial.authorName}
                    {testimonial.authorRole ? ` · ${testimonial.authorRole}` : ''}
                    {testimonial.rating ? ` · ${testimonial.rating}★` : ''}
                  </p>
                </div>

                <div className="flex shrink-0 items-start gap-2">
                  <StatusBadge status={testimonial.status} />
                  {/* Publish is the one action worth a button of its own: it is
                      what puts the quote in front of customers. */}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      void setStatus
                        .mutateAsync({
                          id: testimonial.id,
                          status: testimonial.status === 'ACTIVE' ? 'DRAFT' : 'ACTIVE',
                        })
                        .then(() =>
                          toast.success(
                            testimonial.status === 'ACTIVE' ? 'Taken off the home page' : 'Published',
                          ),
                        )
                    }
                  >
                    {testimonial.status === 'ACTIVE' ? 'Unpublish' : 'Publish'}
                  </Button>
                  <Button variant="ghost" size="icon" aria-label="Edit" onClick={() => setEditing(testimonial)}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Delete"
                    onClick={() => setDeleting(testimonial)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}

      <DataTablePagination meta={data?.meta} onPageChange={params.setPage} isFetching={isFetching} />

      {editing && (
        <TestimonialForm
          testimonial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSubmit={async (values) => {
            const body = {
              ...values,
              authorRole: values.authorRole || null,
              rating: values.rating ? Number(values.rating) : null,
              imageUrl: values.imageUrl || null,
            }
            if (editing === 'new') await createTestimonial.mutateAsync(body)
            else await updateTestimonial.mutateAsync({ id: editing.id, values: body })
            toast.success(editing === 'new' ? 'Testimonial added' : 'Saved')
            setEditing(null)
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete this testimonial?`}
        description="It disappears from the home page immediately. Unpublishing keeps it here for later."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={async () => {
          if (!deleting) return
          try {
            await deleteTestimonial.mutateAsync(deleting.id)
            toast.success('Testimonial deleted')
          } catch (error) {
            toast.error(error instanceof ApiError ? error.message : 'Could not delete that')
          } finally {
            setDeleting(null)
          }
        }}
      />
    </div>
  )
}

function TestimonialForm({
  testimonial,
  onClose,
  onSubmit,
}: {
  testimonial: Testimonial | null
  onClose: () => void
  onSubmit: (values: Values) => Promise<void>
}) {
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      quote: testimonial?.quote ?? '',
      authorName: testimonial?.authorName ?? '',
      authorRole: testimonial?.authorRole ?? '',
      rating: testimonial?.rating ? (String(testimonial.rating) as Values['rating']) : '',
      imageUrl: testimonial?.imageUrl ?? '',
      status: testimonial?.status ?? 'DRAFT',
    },
  })
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = form

  const submit = handleSubmit(async (values) => {
    try {
      await onSubmit(values)
    } catch (error) {
      if (error instanceof ApiError && error.isFieldError) {
        for (const [field, message] of Object.entries(error.fields!)) {
          if (field in values) setError(field as keyof Values, { message })
        }
        return
      }
      toast.error(error instanceof ApiError ? error.message : 'Could not save that')
    }
  })

  return (
    <EntityModal
      open
      onOpenChange={(open) => !open && onClose()}
      title={testimonial ? 'Edit testimonial' : 'Add testimonial'}
      description="A quote for the home page. Publish it when it is ready to be seen."
      isDirty={isDirty}
      isSubmitting={isSubmitting}
      formId={FORM_ID}
    >
      <form id={FORM_ID} onSubmit={submit} noValidate className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="quote">Quote</Label>
          <Textarea id="quote" rows={4} aria-invalid={Boolean(errors.quote)} {...register('quote')} />
          {errors.quote && <p className="text-destructive text-sm">{errors.quote.message}</p>}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="authorName">Name</Label>
            <Input id="authorName" aria-invalid={Boolean(errors.authorName)} {...register('authorName')} />
            {errors.authorName && (
              <p className="text-destructive text-sm">{errors.authorName.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="authorRole">Context</Label>
            <Input id="authorRole" placeholder="Marathon runner, Surat" {...register('authorRole')} />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="rating">Stars</Label>
            <Select
              value={watch('rating') || 'none'}
              onValueChange={(value) =>
                setValue('rating', value === 'none' ? '' : (value as Values['rating']), {
                  shouldDirty: true,
                })
              }
            >
              <SelectTrigger id="rating" className="w-full">
                <SelectValue placeholder="No stars" />
              </SelectTrigger>
              <SelectContent>
                {/* Optional on purpose: a number nobody gave is worse than none. */}
                <SelectItem value="none">No stars</SelectItem>
                {[5, 4, 3, 2, 1].map((rating) => (
                  <SelectItem key={rating} value={String(rating)}>
                    {rating}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="status">Status</Label>
            <Select
              value={watch('status')}
              onValueChange={(value) => setValue('status', value as Values['status'], { shouldDirty: true })}
            >
              <SelectTrigger id="status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="imageUrl">Photo URL</Label>
          <Input id="imageUrl" placeholder="https://…" aria-invalid={Boolean(errors.imageUrl)} {...register('imageUrl')} />
          {errors.imageUrl && <p className="text-destructive text-sm">{errors.imageUrl.message}</p>}
        </div>
      </form>
    </EntityModal>
  )
}
