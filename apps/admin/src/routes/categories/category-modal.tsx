import * as React from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { AlertCircle } from 'lucide-react'
import { ApiError } from '@/lib/api-client'
import {
  categorySchema,
  type CategoryFormValues,
  type CategoryValues,
} from '@/features/categories/schemas'
import { useCreateCategory, useUpdateCategory } from '@/features/categories/mutations'
import { descendantIds, flatten, subtreeHeight } from '@/features/categories/tree'
import { MAX_CATEGORY_DEPTH, type Category } from '@/types/api'
import { EntityModal } from '@/components/entity-modal'
import { SlugField } from '@/components/slug-field'
import { STATUS_OPTIONS } from '@/components/status-badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

const FORM_ID = 'category-form'

/**
 * The form carries "no parent" as `''`, which the schema turns into `null`.
 * Radix refuses an empty `SelectItem` value, so the picker — and only the
 * picker — swaps in a sentinel.
 */
const ROOT = ''
const ROOT_ITEM = '__root__'

const EMPTY: CategoryFormValues = {
  name: '',
  slug: '',
  description: '',
  parentId: ROOT,
  status: 'ACTIVE',
}

type ParentOption = { id: string; label: string; depth: number; disabled: boolean; reason?: string }

/**
 * Every category that could legally be the parent, in tree order.
 *
 * Two are excluded outright — the category itself and everything under it,
 * since either would put a branch inside itself. The rest stay listed but go
 * disabled when the branch being moved would not fit under them, so the reason
 * is visible where the choice is made rather than arriving as a 422.
 */
function parentOptions(tree: Category[], editing: Category | undefined): ParentOption[] {
  const excluded = editing
    ? new Set([editing.id, ...descendantIds(editing)])
    : new Set<string>()
  const height = editing ? subtreeHeight(editing) : 0

  return flatten(tree)
    .filter((item) => !excluded.has(item.id))
    .map((item) => {
      const wouldSit = item.depth + 1
      const tooDeep = wouldSit + height > MAX_CATEGORY_DEPTH - 1
      return {
        id: item.id,
        label: item.category.name,
        depth: item.depth,
        disabled: tooDeep,
        reason: tooDeep ? 'too deep' : undefined,
      }
    })
}

export function CategoryModal({
  open,
  onOpenChange,
  category,
  tree,
  defaultParentId = null,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Absent means create. */
  category?: Category
  /** The whole tree, for the parent picker. */
  tree: Category[]
  /** Pre-selected parent on create — what "Add subcategory" passes. */
  defaultParentId?: string | null
}) {
  const isEdit = Boolean(category)
  const createCategory = useCreateCategory()
  const updateCategory = useUpdateCategory()
  const [banner, setBanner] = React.useState<string | null>(null)

  const form = useForm<CategoryFormValues, unknown, CategoryValues>({
    resolver: zodResolver(categorySchema),
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
  // rather than leaving the previous category's values behind.
  React.useEffect(() => {
    if (!open) return
    setBanner(null)
    reset(
      category
        ? {
            name: category.name,
            slug: category.slug,
            description: category.description ?? '',
            parentId: category.parentId ?? ROOT,
            status: category.status,
          }
        : { ...EMPTY, parentId: defaultParentId ?? ROOT },
    )
  }, [open, category, defaultParentId, reset])

  const name = watch('name')
  const slug = watch('slug')

  const options = React.useMemo(() => parentOptions(tree, category), [tree, category])

  /**
   * `setValue` with `shouldValidate` would mark the slug invalid the moment the
   * form opens — it derives from an empty name and immediately fails its own
   * "required" rule. Validating only after the first submit attempt is what
   * RHF's default mode does for registered inputs; this controlled field has
   * to opt in by hand.
   */
  const writeSlug = (value: string) =>
    setValue('slug', value, { shouldDirty: true, shouldValidate: isSubmitted })

  const onSubmit = handleSubmit(async (values) => {
    setBanner(null)
    try {
      if (category) await updateCategory.mutateAsync({ id: category.id, values })
      else await createCategory.mutateAsync(values)
      onOpenChange(false)
    } catch (error) {
      if (error instanceof ApiError && error.isFieldError) {
        // A 409 on the slug belongs on the slug input, not in a toast the
        // operator has to remember while retyping.
        for (const [field, message] of Object.entries(error.fields!)) {
          if (field in EMPTY) setError(field as keyof CategoryFormValues, { message })
          else setBanner(message)
        }
        return
      }
      // A 422 here is a rejected move — a cycle or the depth cap — and it
      // belongs in the form beside the parent select that caused it.
      setBanner(
        error instanceof ApiError
          ? [error.message, error.reason].filter(Boolean).join(' — ')
          : 'Something went wrong. Try again in a moment.',
      )
    }
  })

  return (
    <EntityModal
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? `Edit ${category!.name}` : 'Add category'}
      description={
        isEdit ? undefined : 'Categories are the storefront’s navigation. A product sits in one.'
      }
      isDirty={isDirty}
      isSubmitting={isSubmitting}
      submitLabel={isEdit ? 'Save changes' : 'Create category'}
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
          initiallyLocked={isEdit}
          error={errors.slug?.message}
          hint="Used in storefront URLs. Unlock to edit."
        />

        <Controller
          control={control}
          name="parentId"
          render={({ field }) => (
            <div className="space-y-2">
              <Label htmlFor="parentId">Parent</Label>
              <Select
                value={field.value || ROOT_ITEM}
                onValueChange={(value) => field.onChange(value === ROOT_ITEM ? ROOT : value)}
              >
                <SelectTrigger id="parentId" aria-invalid={Boolean(errors.parentId)}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ROOT_ITEM}>Top level</SelectItem>
                  {options.map((option) => (
                    <SelectItem key={option.id} value={option.id} disabled={option.disabled}>
                      {/* Indentation carries the hierarchy: two categories can
                          share a name under different parents. */}
                      <span style={{ paddingLeft: option.depth * 14 }}>
                        {option.label}
                        {option.reason && (
                          <span className="text-muted-foreground ml-2 text-xs">
                            ({option.reason})
                          </span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.parentId ? (
                <p className="text-destructive text-sm">{errors.parentId.message}</p>
              ) : (
                <p className="text-muted-foreground text-xs">
                  Moving a category takes everything under it. The tree nests{' '}
                  {MAX_CATEGORY_DEPTH} levels deep.
                </p>
              )}
            </div>
          )}
        />

        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            rows={3}
            aria-invalid={Boolean(errors.description)}
            placeholder="Optional. Shown on the storefront category page."
            {...register('description')}
          />
          {errors.description && (
            <p className="text-destructive text-sm">{errors.description.message}</p>
          )}
        </div>

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
                Only active categories appear on the storefront. Status is per category — a draft
                parent does not hide its children.
              </p>
            </fieldset>
          )}
        />
      </form>
    </EntityModal>
  )
}
