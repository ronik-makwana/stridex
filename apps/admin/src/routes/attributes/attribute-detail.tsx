import * as React from 'react'
import { useNavigate, useParams } from 'react-router'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { AlertCircle, ArrowLeft, SearchX, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api-client'
import {
  attributeSchema,
  type AttributeFormValues,
  type AttributeValues,
} from '@/features/attributes/schemas'
import { useAttribute } from '@/features/attributes/queries'
import {
  useCreateAttributeValue,
  useDeleteAttribute,
  useDeleteAttributeValue,
  useReorderAttributeValues,
  useUpdateAttribute,
  useUpdateAttributeValue,
} from '@/features/attributes/mutations'
import { isListAttributeType, type Attribute, type AttributeType } from '@/types/api'
import { PageHeader } from '@/components/page-header'
import { EmptyState } from '@/components/empty-state'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { SlugField } from '@/components/slug-field'
import { ValuesPanel, type ValueRow } from '@/components/values-panel'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ATTRIBUTE_TYPES, attributeTypeLabel } from './attribute-type'

const FORM_ID = 'attribute-detail-form'

const toFormValues = (attribute: Attribute): AttributeFormValues => ({
  name: attribute.name,
  slug: attribute.slug,
  type: attribute.type,
  unit: attribute.unit ?? '',
  isFilterable: attribute.isFilterable,
  isSuggested: attribute.isSuggested,
})

const products = (count: number) => `${count} ${count === 1 ? 'product' : 'products'}`

/** Row label: a value with no products reads better as a word than as "0 products". */
const productsLabel = (count: number) => (count === 0 ? 'unused' : products(count))

export default function AttributeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: attribute, isPending, error } = useAttribute(id)

  if (isPending) return <DetailSkeleton />

  if (error) {
    const missing = error instanceof ApiError && error.status === 404
    return (
      <EmptyState
        icon={SearchX}
        title={missing ? 'That attribute no longer exists' : 'Could not load this attribute'}
        description={missing ? undefined : error.message}
        action={
          <Button variant="outline" size="sm" onClick={() => void navigate('/attributes')}>
            <ArrowLeft className="size-4" />
            Back to attributes
          </Button>
        }
      />
    )
  }

  // Keyed on the id so switching attributes remounts the form rather than
  // leaving the previous one's values in it.
  return <AttributeDetail key={attribute.id} attribute={attribute} />
}

function AttributeDetail({ attribute }: { attribute: Attribute }) {
  const navigate = useNavigate()
  const updateAttribute = useUpdateAttribute()
  const deleteAttribute = useDeleteAttribute()

  const createValue = useCreateAttributeValue(attribute.id)
  const updateValue = useUpdateAttributeValue(attribute.id)
  const deleteValue = useDeleteAttributeValue(attribute.id)
  const reorderValues = useReorderAttributeValues(attribute.id)

  const [banner, setBanner] = React.useState<string | null>(null)
  const [deleting, setDeleting] = React.useState(false)
  const [deleteBlock, setDeleteBlock] = React.useState<string | null>(null)

  const form = useForm<AttributeFormValues, unknown, AttributeValues>({
    resolver: zodResolver(attributeSchema),
    defaultValues: toFormValues(attribute),
  })
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    setValue,
    watch,
    formState: { errors, isDirty, isSubmitted, isSubmitting },
  } = form

  const name = watch('name')
  const slug = watch('slug')
  const type = watch('type')

  const values = attribute.values ?? []
  const hasValueList = isListAttributeType(attribute.type)

  /**
   * The type decides which column each product row populates. Once values exist
   * or products have answered it, changing it would strand those rows — so the
   * control is disabled with the reason next to it, rather than left enabled to
   * be rejected on save.
   */
  const typeLocked = attribute.valueCount > 0 || attribute.productCount > 0
  const typeLockReason =
    attribute.valueCount > 0
      ? `Delete its ${attribute.valueCount} values first, or create a new attribute.`
      : `${attribute.productCount} products already answer this attribute.`

  const writeSlug = (value: string) =>
    setValue('slug', value, { shouldDirty: true, shouldValidate: isSubmitted })

  const onSubmit = handleSubmit(async (submitted) => {
    setBanner(null)
    try {
      const saved = await updateAttribute.mutateAsync({ id: attribute.id, values: submitted })
      // Re-seeded from the response, not from the submitted values: the server
      // may have adjusted a derived slug, and the form should show what is
      // actually stored.
      reset(toFormValues(saved))
    } catch (error) {
      if (error instanceof ApiError && error.isFieldError) {
        for (const [field, message] of Object.entries(error.fields!)) {
          if (field in attribute) setError(field as keyof AttributeFormValues, { message })
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
      await deleteAttribute.mutateAsync(attribute.id)
      toast.success(`${attribute.name} deleted`)
      void navigate('/attributes')
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        setDeleteBlock(error.reason ?? error.message)
        return
      }
      toast.error(error instanceof ApiError ? error.message : 'Could not delete this attribute')
      setDeleting(false)
    }
  }

  const rows: ValueRow[] = values.map((value) => ({
    id: value.id,
    value: value.value,
    slug: value.slug,
    usageCount: value.productCount,
  }))

  return (
    <div className="space-y-4">
      <PageHeader
        backTo="/attributes"
        backLabel="Back to attributes"
        title={attribute.name}
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
            // An existing slug is a URL storefront filters already use.
            initiallyLocked
            error={errors.slug?.message}
            hint="Used by storefront filters. Unlock to edit."
          />

          <Controller
            control={control}
            name="type"
            render={({ field }) => (
              <div className="space-y-2">
                <Label htmlFor="type">Type</Label>
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  disabled={typeLocked}
                >
                  <SelectTrigger
                    id="type"
                    className="w-full"
                    title={typeLocked ? typeLockReason : undefined}
                  >
                    {/* Radix mirrors the selected item's children into the trigger,
                        which would drag the hint up with it. The label is passed
                        explicitly so the hint stays where it is useful: the menu. */}
                    <SelectValue>{attributeTypeLabel(field.value as AttributeType)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {ATTRIBUTE_TYPES.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        <span className="flex flex-col items-start">
                          <span>{option.label}</span>
                          <span className="text-muted-foreground text-xs">{option.hint}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground text-xs">
                  {typeLocked ? `Type cannot change. ${typeLockReason}` : 'Not yet in use, so the type is still free to change.'}
                </p>
              </div>
            )}
          />

          {type === 'NUMBER' && (
            <div className="space-y-2">
              <Label htmlFor="unit">Unit</Label>
              <Input
                id="unit"
                placeholder="g, mm, cm"
                autoComplete="off"
                aria-invalid={Boolean(errors.unit)}
                {...register('unit')}
              />
              {errors.unit ? (
                <p className="text-destructive text-sm">{errors.unit.message}</p>
              ) : (
                <p className="text-muted-foreground text-xs">
                  Shown after the value — "280 g". Leave empty for none.
                </p>
              )}
            </div>
          )}
        </div>

        <fieldset className="flex flex-wrap gap-x-8 gap-y-3 border-t pt-4">
          <legend className="sr-only">Options</legend>

          <Controller
            control={control}
            name="isFilterable"
            render={({ field }) => (
              <div className="flex items-center gap-2.5">
                <Checkbox
                  id="isFilterable"
                  checked={field.value}
                  onCheckedChange={(checked) => field.onChange(checked === true)}
                />
                <Label htmlFor="isFilterable" className="font-normal">
                  Filterable on storefront
                </Label>
              </div>
            )}
          />

          <Controller
            control={control}
            name="isSuggested"
            render={({ field }) => (
              <div className="flex items-center gap-2.5">
                <Checkbox
                  id="isSuggested"
                  checked={field.value}
                  onCheckedChange={(checked) => field.onChange(checked === true)}
                />
                <Label htmlFor="isSuggested" className="font-normal">
                  Suggested on new products
                </Label>
              </div>
            )}
          />
        </fieldset>
      </form>

      {/*
        Only SELECT and MULTI_SELECT have a value list. For the other three the
        value is typed on each product, so an empty panel here would suggest
        something is missing when nothing is.
      */}
      {hasValueList ? (
        <ValuesPanel
          values={rows}
          usageLabel={productsLabel}
          hint="The choices this attribute offers. Drag to set the order the storefront shows them in."
          emptyDescription="Add the choices this attribute offers, one per row."
          onCreate={(draft) =>
            createValue.mutateAsync({ value: draft.value, slug: draft.slug })
          }
          onUpdate={(valueId, draft) =>
            updateValue.mutateAsync({
              id: valueId,
              values: { value: draft.value, slug: draft.slug },
            })
          }
          onDelete={(valueId) => deleteValue.mutateAsync(valueId)}
          onReorder={(ids) => reorderValues.mutateAsync(ids)}
        />
      ) : (
        <p className="text-muted-foreground text-sm">
          {attribute.type === 'BOOLEAN'
            ? 'Yes/no attributes have no value list — each product answers with a checkbox.'
            : 'This type has no value list — the value is entered on each product.'}
        </p>
      )}

      <ConfirmDialog
        open={deleting}
        onOpenChange={(open) => !open && setDeleting(false)}
        title={deleteBlock ? `Cannot delete ${attribute.name}` : `Delete ${attribute.name}?`}
        description={
          deleteBlock ??
          'This deletes its values too. Attributes in use by products cannot be deleted.'
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
      <Skeleton className="h-5 w-24" />
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-56 w-full rounded-lg" />
      <Skeleton className="h-40 w-full rounded-lg" />
    </div>
  )
}
