import type { UseFormReturn } from 'react-hook-form'
import { useBrands } from '@/features/brands/queries'
import type { ProductFormValues, ProductOutput } from '@/features/products/schemas'
import type { ProductCollectionRef } from '@/types/api'
import { SlugField } from '@/components/slug-field'
import { CategorySelect } from '@/components/category-select'
import { CollectionSelect } from '@/components/collection-select'
import { TagInput } from '@/components/tag-input'
import { STATUS_OPTIONS } from '@/components/status-badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const NONE = '__none__'

/**
 * Basic information. Lives inside the page's `<form>` so Enter submits, while
 * the organization fields opposite register into the same form from outside it
 * — nested forms are invalid HTML, and the media and variant panels below carry
 * their own controls.
 */
export function BasicInformation({
  form,
  isNew,
}: {
  form: UseFormReturn<ProductFormValues, unknown, ProductOutput>
  isNew: boolean
}) {
  const {
    register,
    setValue,
    watch,
    formState: { errors, isSubmitted },
  } = form

  const title = watch('title')
  const slug = watch('slug')

  return (
    <section className="bg-card space-y-5 rounded-lg border p-5">
      <h2 className="text-sm font-semibold">Basic information</h2>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="title">Title</Label>
          <Input
            id="title"
            autoComplete="off"
            placeholder="Nike Air Max 270"
            aria-invalid={Boolean(errors.title)}
            {...register('title')}
          />
          {errors.title && <p className="text-destructive text-sm">{errors.title.message}</p>}
        </div>

        <SlugField
          value={slug ?? ''}
          onChange={(value) =>
            setValue('slug', value, { shouldDirty: true, shouldValidate: isSubmitted })
          }
          source={title ?? ''}
          // A live product's slug is a URL the storefront already serves, and
          // possibly one somebody has shared. A new one has no history to break.
          initiallyLocked={!isNew}
          error={errors.slug?.message}
          hint="Used in storefront URLs. Unlock to edit."
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          rows={8}
          placeholder="What the customer is buying, in their words rather than the spec sheet's."
          aria-invalid={Boolean(errors.description)}
          {...register('description')}
        />
        {errors.description && (
          <p className="text-destructive text-sm">{errors.description.message}</p>
        )}
      </div>
    </section>
  )
}

/**
 * Status on its own, above everything else in the rail. It is the one field
 * that decides whether any of this is visible to a customer, and it changes far
 * more often than a brand or a category does — burying it under two pickers it
 * has nothing to do with made it look like a filing detail.
 */
export function StatusPanel({
  form,
}: {
  form: UseFormReturn<ProductFormValues, unknown, ProductOutput>
}) {
  const { setValue, watch } = form
  const status = watch('status')

  return (
    <section className="bg-card space-y-2 rounded-lg border p-5">
      <Label htmlFor="status" className="text-sm font-semibold">
        Status
      </Label>
      <Select
        value={status}
        onValueChange={(value) => setValue('status', value as never, { shouldDirty: true })}
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
      <p className="text-muted-foreground text-xs">
        Publish runs the readiness checklist. Setting Active here does not.
      </p>
    </section>
  )
}

/**
 * The rail. Four ways of filing the same product, in the order they get
 * decided: what made it, where it lives, what describes it, and what campaign
 * it is part of.
 *
 * Category is one and exclusive; tags and collections are many, and the
 * difference between them is who chooses. A tag is a property of the product —
 * waterproof, gore-tex, wide-fit — while a collection is a placement somebody
 * merchandised. Both save with the product, so one Save button settles the
 * whole panel.
 */
export function OrganizationPanel({
  form,
  collections = [],
}: {
  form: UseFormReturn<ProductFormValues, unknown, ProductOutput>
  /** The product's saved collections, for chip names before the list loads. */
  collections?: ProductCollectionRef[]
}) {
  const {
    setValue,
    watch,
    formState: { errors },
  } = form
  const { data: brands, isPending } = useBrands({ limit: 100, sort: 'name:asc' })

  const brandId = watch('brandId')
  const categoryId = watch('categoryId')
  const tags = watch('tags')
  const collectionIds = watch('collectionIds')

  const write = (field: 'brandId' | 'categoryId', value: string | null) =>
    setValue(field, value as never, { shouldDirty: true })

  return (
    <section className="bg-card space-y-4 rounded-lg border p-5">
      <h2 className="text-sm font-semibold">Organization</h2>

      <div className="space-y-2">
        <Label htmlFor="brandId">Brand</Label>
        <Select
          value={brandId || NONE}
          onValueChange={(value) => write('brandId', value === NONE ? null : value)}
          disabled={isPending}
        >
          <SelectTrigger id="brandId" className="w-full">
            <SelectValue placeholder={isPending ? 'Loading…' : 'No brand'} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>No brand</SelectItem>
            {(brands?.data ?? []).map((brand) => (
              <SelectItem key={brand.id} value={brand.id}>
                {brand.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <CategorySelect
        label="Category"
        value={categoryId}
        onChange={(value) => write('categoryId', value)}
        className="w-full"
      />

      <TagInput
        value={tags ?? []}
        onChange={(next) => setValue('tags', next, { shouldDirty: true })}
        // Zod reports the offending element, so the array-level error is the
        // one worth showing beside a control that holds all of them.
        error={errors.tags?.message ?? errors.tags?.find?.((issue) => issue?.message)?.message}
      />

      <CollectionSelect
        value={collectionIds ?? []}
        onChange={(next) => setValue('collectionIds', next, { shouldDirty: true })}
        known={collections}
        error={errors.collectionIds?.message}
      />
    </section>
  )
}
