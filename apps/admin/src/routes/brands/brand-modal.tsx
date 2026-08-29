import * as React from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { AlertCircle } from 'lucide-react'
import { ApiError } from '@/lib/api-client'
import { brandSchema, type BrandFormValues, type BrandValues } from '@/features/brands/schemas'
import { useCreateBrand, useUpdateBrand } from '@/features/brands/mutations'
import type { Brand } from '@/types/api'
import { EntityModal } from '@/components/entity-modal'
import { MediaUploader } from '@/components/media-uploader'
import { SlugField } from '@/components/slug-field'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { STATUS_OPTIONS } from '@/components/status-badge'

const FORM_ID = 'brand-form'

const EMPTY: BrandFormValues = { name: '', slug: '', logoUrl: '', status: 'ACTIVE' }

export function BrandModal({
  open,
  onOpenChange,
  brand,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Absent means create. */
  brand?: Brand
}) {
  const isEdit = Boolean(brand)
  const createBrand = useCreateBrand()
  const updateBrand = useUpdateBrand()
  const [banner, setBanner] = React.useState<string | null>(null)

  const form = useForm<BrandFormValues, unknown, BrandValues>({
    resolver: zodResolver(brandSchema),
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
  // rather than leaving the previous brand's values behind.
  React.useEffect(() => {
    if (!open) return
    setBanner(null)
    reset(
      brand
        ? {
            name: brand.name,
            slug: brand.slug,
            logoUrl: brand.logoUrl ?? '',
            status: brand.status,
          }
        : EMPTY,
    )
  }, [open, brand, reset])

  const name = watch('name')
  const slug = watch('slug')
  const logoUrl = watch('logoUrl')

  /**
   * `setValue` with `shouldValidate` would mark a field invalid the moment the
   * form opens — the slug derives from an empty name and immediately fails its
   * own "required" rule. Validating only after the first submit attempt is
   * what RHF's default mode does for registered inputs; these two controlled
   * fields have to opt in by hand.
   */
  const writeField = (field: 'slug' | 'logoUrl', value: string) =>
    setValue(field, value, { shouldDirty: true, shouldValidate: isSubmitted })

  const onSubmit = handleSubmit(async (values) => {
    setBanner(null)
    try {
      if (brand) await updateBrand.mutateAsync({ id: brand.id, values })
      else await createBrand.mutateAsync(values)
      onOpenChange(false)
    } catch (error) {
      if (error instanceof ApiError && error.isFieldError) {
        // A 409 on the slug belongs on the slug input, not in a toast the
        // operator has to remember while retyping.
        for (const [field, message] of Object.entries(error.fields!)) {
          if (field in EMPTY) setError(field as keyof BrandFormValues, { message })
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
      title={isEdit ? `Edit ${brand!.name}` : 'Add brand'}
      description={isEdit ? undefined : 'Brands group products and give the storefront a filter.'}
      isDirty={isDirty}
      isSubmitting={isSubmitting}
      submitLabel={isEdit ? 'Save changes' : 'Create brand'}
      formId={FORM_ID}
    >
      <form id={FORM_ID} onSubmit={onSubmit} noValidate className="space-y-5">
        {banner && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{banner}</AlertDescription>
          </Alert>
        )}

        <MediaUploader
          folder="brands"
          label="Logo"
          value={logoUrl || null}
          onChange={(url) => writeField('logoUrl', url ?? '')}
          error={errors.logoUrl?.message}
          fallback={
            <span className="text-sm font-semibold uppercase">{name.trim()[0] ?? '?'}</span>
          }
        />

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
          onChange={(value) => writeField('slug', value)}
          source={name}
          initiallyLocked={isEdit}
          error={errors.slug?.message}
          hint="Used in storefront URLs. Unlock to edit."
        />

        <Controller
          control={control}
          name="status"
          render={({ field }) => (
            <fieldset className="space-y-2">
              <legend className="text-sm leading-none font-medium">Status</legend>
              <RadioGroup
                value={field.value}
                onValueChange={field.onChange}
                className="flex flex-wrap gap-4 pt-1"
              >
                {STATUS_OPTIONS.map((option) => (
                  <div key={option.value} className="flex items-center gap-2">
                    <RadioGroupItem value={option.value} id={`status-${option.value}`} />
                    <Label htmlFor={`status-${option.value}`} className="font-normal">
                      {option.label}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
              <p className="text-muted-foreground text-xs">
                Only active brands appear on the storefront.
              </p>
            </fieldset>
          )}
        />
      </form>
    </EntityModal>
  )
}
