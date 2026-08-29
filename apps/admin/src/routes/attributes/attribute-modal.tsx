import * as React from 'react'
import { useNavigate } from 'react-router'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { AlertCircle } from 'lucide-react'
import { ApiError } from '@/lib/api-client'
import {
  attributeSchema,
  type AttributeFormValues,
  type AttributeValues,
} from '@/features/attributes/schemas'
import { useCreateAttribute } from '@/features/attributes/mutations'
import { isListAttributeType, type AttributeType } from '@/types/api'
import { EntityModal } from '@/components/entity-modal'
import { SlugField } from '@/components/slug-field'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ATTRIBUTE_TYPES, attributeTypeLabel } from './attribute-type'

const FORM_ID = 'attribute-form'

const EMPTY: AttributeFormValues = {
  name: '',
  slug: '',
  type: 'SELECT',
  unit: '',
  isFilterable: true,
  isSuggested: false,
}

/**
 * Create only. Editing happens on the detail page, where the value list lives —
 * splitting the two would mean an operator changes the type in one place and
 * discovers what it did to the values in another.
 */
export function AttributeModal({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const createAttribute = useCreateAttribute()
  const [banner, setBanner] = React.useState<string | null>(null)

  const form = useForm<AttributeFormValues, unknown, AttributeValues>({
    resolver: zodResolver(attributeSchema),
    defaultValues: EMPTY,
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

  // The modal stays mounted across openings, so each one reloads the form
  // rather than leaving the previous attempt's values behind.
  React.useEffect(() => {
    if (!open) return
    setBanner(null)
    reset(EMPTY)
  }, [open, reset])

  const name = watch('name')
  const slug = watch('slug')
  const type = watch('type')

  /**
   * `setValue` with `shouldValidate` would mark the slug invalid the moment the
   * form opens — it derives from an empty name and immediately fails its own
   * "required" rule. Validating only after the first submit attempt is what RHF
   * does for registered inputs; this controlled field has to opt in by hand.
   */
  const writeSlug = (value: string) =>
    setValue('slug', value, { shouldDirty: true, shouldValidate: isSubmitted })

  const onSubmit = handleSubmit(async (values) => {
    setBanner(null)
    try {
      const attribute = await createAttribute.mutateAsync(values)
      onOpenChange(false)
      // Straight to the detail page: a SELECT with no values is half an
      // attribute, and the value list is the next thing anyone wants.
      void navigate(`/attributes/${attribute.id}`)
    } catch (error) {
      if (error instanceof ApiError && error.isFieldError) {
        // A 409 on the slug belongs on the slug input, not in a toast the
        // operator has to remember while retyping.
        for (const [field, message] of Object.entries(error.fields!)) {
          if (field in EMPTY) setError(field as keyof AttributeFormValues, { message })
          else setBanner(message)
        }
        return
      }
      setBanner(
        error instanceof ApiError ? error.message : 'Something went wrong. Try again in a moment.',
      )
    }
  })

  return (
    <EntityModal
      open={open}
      onOpenChange={onOpenChange}
      title="Add attribute"
      isDirty={isDirty}
      isSubmitting={isSubmitting}
      submitLabel="Create attribute"
      formId={FORM_ID}
    >
      <form id={FORM_ID} onSubmit={onSubmit} noValidate className="space-y-5">
        {banner && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{banner}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            autoFocus
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
          error={errors.slug?.message}
          hint="Used by storefront filters. Unlock to edit."
        />

        <Controller
          control={control}
          name="type"
          render={({ field }) => (
            <div className="space-y-2">
              <Label htmlFor="type">Type</Label>
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="type" className="w-full">
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
                {isListAttributeType(field.value as AttributeType)
                  ? "The type can't be changed once values exist."
                  : "The type can't be changed once products use it."}
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

        <fieldset className="space-y-3">
          <legend className="sr-only">Options</legend>

          <Controller
            control={control}
            name="isFilterable"
            render={({ field }) => (
              <div className="flex items-start gap-2.5">
                <Checkbox
                  id="isFilterable"
                  checked={field.value}
                  onCheckedChange={(checked) => field.onChange(checked === true)}
                  className="mt-0.5"
                />
                <div className="grid gap-0.5">
                  <Label htmlFor="isFilterable" className="font-normal">
                    Filterable on storefront
                  </Label>
                  <p className="text-muted-foreground text-xs">
                    Appears as a filter in the category sidebar.
                  </p>
                </div>
              </div>
            )}
          />

          <Controller
            control={control}
            name="isSuggested"
            render={({ field }) => (
              <div className="flex items-start gap-2.5">
                <Checkbox
                  id="isSuggested"
                  checked={field.value}
                  onCheckedChange={(checked) => field.onChange(checked === true)}
                  className="mt-0.5"
                />
                <div className="grid gap-0.5">
                  <Label htmlFor="isSuggested" className="font-normal">
                    Suggested on new products
                  </Label>
                  <p className="text-muted-foreground text-xs">
                    Pre-filled on the product form so the attributes block is never empty.
                  </p>
                </div>
              </div>
            )}
          />
        </fieldset>
      </form>
    </EntityModal>
  )
}
