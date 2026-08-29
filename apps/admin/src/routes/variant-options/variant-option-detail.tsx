import * as React from 'react'
import { useNavigate, useParams } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { AlertCircle, ArrowLeft, SearchX, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api-client'
import {
  variantOptionSchema,
  type VariantOptionFormValues,
  type VariantOptionValues,
} from '@/features/variant-options/schemas'
import { useVariantOption } from '@/features/variant-options/queries'
import {
  useCreateOptionValue,
  useDeleteOptionValue,
  useDeleteVariantOption,
  useReorderOptionValues,
  useUpdateOptionValue,
  useUpdateVariantOption,
} from '@/features/variant-options/mutations'
import type { VariantOption } from '@/types/api'
import { PageHeader } from '@/components/page-header'
import { EmptyState } from '@/components/empty-state'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { SlugField } from '@/components/slug-field'
import { ValuesPanel, type ValueRow } from '@/components/values-panel'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'

const FORM_ID = 'variant-option-detail-form'

const toFormValues = (option: VariantOption): VariantOptionFormValues => ({
  name: option.name,
  slug: option.slug,
})

const variantsLabel = (count: number) =>
  count === 0 ? 'unused' : `${count} ${count === 1 ? 'variant' : 'variants'}`

export default function VariantOptionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: option, isPending, error } = useVariantOption(id)

  if (isPending) return <DetailSkeleton />

  if (error) {
    const missing = error instanceof ApiError && error.status === 404
    return (
      <EmptyState
        icon={SearchX}
        title={missing ? 'That option no longer exists' : 'Could not load this option'}
        description={missing ? undefined : error.message}
        action={
          <Button variant="outline" size="sm" onClick={() => void navigate('/variant-options')}>
            <ArrowLeft className="size-4" />
            Back to variant options
          </Button>
        }
      />
    )
  }

  // Keyed on the id so switching options remounts the form rather than leaving
  // the previous one's values in it.
  return <VariantOptionDetail key={option.id} option={option} />
}

function VariantOptionDetail({ option }: { option: VariantOption }) {
  const navigate = useNavigate()
  const updateOption = useUpdateVariantOption()
  const deleteOption = useDeleteVariantOption()

  const createValue = useCreateOptionValue(option.id)
  const updateValue = useUpdateOptionValue(option.id)
  const deleteValue = useDeleteOptionValue(option.id)
  const reorderValues = useReorderOptionValues(option.id)

  const [banner, setBanner] = React.useState<string | null>(null)
  const [deleting, setDeleting] = React.useState(false)
  const [deleteBlock, setDeleteBlock] = React.useState<string | null>(null)

  const form = useForm<VariantOptionFormValues, unknown, VariantOptionValues>({
    resolver: zodResolver(variantOptionSchema),
    defaultValues: toFormValues(option),
  })
  const {
    register,
    handleSubmit,
    reset,
    setError,
    setValue,
    watch,
    formState: { errors, isDirty, isSubmitted, isSubmitting },
  } = form

  const name = watch('name')
  const slug = watch('slug')

  const writeSlug = (value: string) =>
    setValue('slug', value, { shouldDirty: true, shouldValidate: isSubmitted })

  const onSubmit = handleSubmit(async (submitted) => {
    setBanner(null)
    try {
      const saved = await updateOption.mutateAsync({ id: option.id, values: submitted })
      // Re-seeded from the response, not from the submitted values: the server
      // may have adjusted a derived slug, and the form should show what is
      // actually stored.
      reset(toFormValues(saved))
    } catch (error) {
      if (error instanceof ApiError && error.isFieldError) {
        for (const [field, message] of Object.entries(error.fields!)) {
          if (field === 'name' || field === 'slug') setError(field, { message })
          else setBanner(message)
        }
        return
      }
      setBanner(
        error instanceof ApiError ? error.message : 'Something went wrong. Try again in a moment.',
      )
    }
  })

  const confirmDelete = async () => {
    try {
      await deleteOption.mutateAsync(option.id)
      toast.success(`${option.name} deleted`)
      void navigate('/variant-options')
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        setDeleteBlock(error.reason ?? error.message)
        return
      }
      toast.error(error instanceof ApiError ? error.message : 'Could not delete this option')
      setDeleting(false)
    }
  }

  const rows: ValueRow[] = (option.values ?? []).map((value) => ({
    id: value.id,
    value: value.value,
    slug: value.slug,
    swatchHex: value.swatchHex,
    usageCount: value.variantCount,
  }))

  return (
    <div className="space-y-4">
      <PageHeader
        backTo="/variant-options"
        backLabel="Back to variant options"
        title={option.name}
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteBlock(null)
                setDeleting(true)
              }}
            >
              <Trash2 className="size-4" />
              Delete
            </Button>
            <Button type="submit" form={FORM_ID} disabled={!isDirty || isSubmitting}>
              {isSubmitting && <Spinner />}
              Save
            </Button>
          </>
        }
      />

      <form
        id={FORM_ID}
        onSubmit={onSubmit}
        noValidate
        className="bg-card space-y-5 rounded-lg border p-5"
      >
        {banner && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{banner}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              autoComplete="off"
              aria-invalid={Boolean(errors.name)}
              {...register('name')}
            />
            {errors.name && <p className="text-destructive text-sm">{errors.name.message}</p>}
          </div>

          <SlugField
            value={slug}
            onChange={writeSlug}
            source={name}
            // An existing slug is a URL the storefront already uses.
            initiallyLocked
            error={errors.slug?.message}
            hint="Used in storefront URLs. Unlock to edit."
          />
        </div>
      </form>

      <ValuesPanel
        values={rows}
        withSwatch
        usageLabel={variantsLabel}
        hint="Drag to set the order the storefront shows them in. A swatch is only used for colours."
        emptyDescription="Add the choices this option offers, one per row."
        onCreate={(draft) => createValue.mutateAsync(draft)}
        onUpdate={(valueId, draft) => updateValue.mutateAsync({ id: valueId, values: draft })}
        onDelete={(valueId) => deleteValue.mutateAsync(valueId)}
        onReorder={(ids) => reorderValues.mutateAsync(ids)}
      />

      <ConfirmDialog
        open={deleting}
        onOpenChange={(open) => !open && setDeleting(false)}
        title={deleteBlock ? `Cannot delete ${option.name}` : `Delete ${option.name}?`}
        description={
          deleteBlock ?? 'This deletes its values too. Options used by products cannot be deleted.'
        }
        cancelLabel={deleteBlock ? 'Close' : 'Cancel'}
        confirmLabel={deleteBlock ? undefined : 'Delete'}
        variant="destructive"
        onConfirm={confirmDelete}
      />
    </div>
  )
}

function DetailSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-40 w-full rounded-lg" />
      <Skeleton className="h-48 w-full rounded-lg" />
    </div>
  )
}
