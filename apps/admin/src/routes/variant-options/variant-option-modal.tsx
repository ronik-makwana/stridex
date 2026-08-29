import * as React from 'react'
import { useNavigate } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { AlertCircle } from 'lucide-react'
import { ApiError } from '@/lib/api-client'
import {
  variantOptionSchema,
  type VariantOptionFormValues,
  type VariantOptionValues,
} from '@/features/variant-options/schemas'
import { useCreateVariantOption } from '@/features/variant-options/mutations'
import { EntityModal } from '@/components/entity-modal'
import { SlugField } from '@/components/slug-field'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const FORM_ID = 'variant-option-form'

const EMPTY: VariantOptionFormValues = { name: '', slug: '' }

/**
 * Create only. Editing happens on the detail page, where the value list lives —
 * an option with no values cannot generate a single variant, so the point of
 * creating one is to get to that list.
 */
export function VariantOptionModal({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const createOption = useCreateVariantOption()
  const [banner, setBanner] = React.useState<string | null>(null)

  const form = useForm<VariantOptionFormValues, unknown, VariantOptionValues>({
    resolver: zodResolver(variantOptionSchema),
    defaultValues: EMPTY,
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

  // The modal stays mounted across openings, so each one reloads the form
  // rather than leaving the previous attempt's values behind.
  React.useEffect(() => {
    if (!open) return
    setBanner(null)
    reset(EMPTY)
  }, [open, reset])

  const name = watch('name')
  const slug = watch('slug')

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
      const option = await createOption.mutateAsync(values)
      onOpenChange(false)
      void navigate(`/variant-options/${option.id}`)
    } catch (error) {
      if (error instanceof ApiError && error.isFieldError) {
        // A 409 on the slug belongs on the slug input, not in a toast the
        // operator has to remember while retyping.
        for (const [field, message] of Object.entries(error.fields!)) {
          if (field in EMPTY) setError(field as keyof VariantOptionFormValues, { message })
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
      title="Add variant option"
      description="Options are what variants are built from — Colour, Size. Each product picks which ones it uses."
      isDirty={isDirty}
      isSubmitting={isSubmitting}
      submitLabel="Create option"
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
            placeholder="Colour"
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
          hint="Used in storefront URLs. Unlock to edit."
        />
      </form>
    </EntityModal>
  )
}
