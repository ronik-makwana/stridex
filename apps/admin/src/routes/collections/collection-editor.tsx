import * as React from 'react'
import { useNavigate, useParams } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { AlertCircle, ArrowLeft, Lock, Package, SearchX, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { formatCount, formatDate, formatRelative } from '@/lib/format'
import { useCollection } from '@/features/collections/queries'
import {
  useCreateCollection,
  useDeleteCollection,
  useUpdateCollection,
} from '@/features/collections/mutations'
import {
  collectionSchema,
  type CollectionFormValues,
  type CollectionOutput,
} from '@/features/collections/schemas'
import type { Collection, CollectionType, RuleDraft } from '@/types/api'
import { PageHeader } from '@/components/page-header'
import { EmptyState } from '@/components/empty-state'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { MediaUploader } from '@/components/media-uploader'
import { SlugField } from '@/components/slug-field'
import { StatusBadge, STATUS_OPTIONS } from '@/components/status-badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ManualProductsPanel } from './manual-products-panel'
import { RuleBuilder } from './rule-builder'

const FORM_ID = 'collection-form'

const toFormValues = (collection: Collection): CollectionFormValues => ({
  name: collection.name,
  slug: collection.slug,
  description: collection.description ?? '',
  imageUrl: collection.imageUrl ?? '',
  type: collection.type,
  matchType: collection.matchType,
  status: collection.status,
})

const toDrafts = (collection: Collection): RuleDraft[] =>
  (collection.rules ?? []).map((rule) => ({
    field: rule.field,
    operator: rule.operator,
    value: rule.value,
  }))

function applyFieldErrors(
  error: unknown,
  setError: (field: keyof CollectionFormValues, message: string) => void,
  setBanner: (message: string) => void,
) {
  if (error instanceof ApiError && error.isFieldError) {
    for (const [field, message] of Object.entries(error.fields!)) {
      if (field === 'name' || field === 'slug' || field === 'description') setError(field, message)
      else setBanner(message)
    }
    return
  }
  setBanner(
    error instanceof ApiError ? error.message : 'Something went wrong. Try again in a moment.',
  )
}

/**
 * The segmented control the spec asks for. It swaps the lower half of the
 * editor, so it is deliberately not a dropdown — this is the decision that
 * determines what the rest of the screen even is, and a two-option select
 * hides that.
 */
function TypeToggle({
  value,
  onChange,
  disabled,
}: {
  value: CollectionType
  onChange: (next: CollectionType) => void
  disabled?: boolean
}) {
  const options: { value: CollectionType; label: string; hint: string }[] = [
    { value: 'MANUAL', label: 'Manual', hint: 'You pick the products, in your order' },
    { value: 'DYNAMIC', label: 'Dynamic', hint: 'Rules pick them, and keep up as the catalogue changes' },
  ]

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={disabled}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
            value === option.value ? 'border-primary bg-accent/50' : 'hover:bg-accent/30',
          )}
        >
          <span className="block text-sm font-medium">{option.label}</span>
          <span className="text-muted-foreground block text-xs">{option.hint}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * Sits in the main column, directly above the half of the editor it controls —
 * the choice and its consequence read as one thing that way. In the rail it was
 * a setting off to the side that silently swapped the screen underneath it.
 */
function TypePanel({
  value,
  onChange,
}: {
  value: CollectionType
  onChange: (next: CollectionType) => void
}) {
  return (
    <section className="bg-card space-y-3 rounded-lg border p-5">
      <Label className="text-sm font-semibold">Type</Label>
      <TypeToggle value={value} onChange={onChange} />
    </section>
  )
}

function BasicFields({
  form,
  isNew,
}: {
  form: ReturnType<typeof useForm<CollectionFormValues, unknown, CollectionOutput>>
  isNew: boolean
}) {
  const {
    register,
    setValue,
    watch,
    formState: { errors, isSubmitted },
  } = form

  const name = watch('name')
  const slug = watch('slug')

  return (
    <section className="bg-card space-y-5 rounded-lg border p-5">
      <h2 className="text-sm font-semibold">Basic information</h2>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            autoComplete="off"
            placeholder="Summer Sale"
            aria-invalid={Boolean(errors.name)}
            {...register('name')}
          />
          {errors.name && <p className="text-destructive text-sm">{errors.name.message}</p>}
        </div>

        <SlugField
          value={slug ?? ''}
          onChange={(value) =>
            setValue('slug', value, { shouldDirty: true, shouldValidate: isSubmitted })
          }
          source={name ?? ''}
          initiallyLocked={!isNew}
          error={errors.slug?.message}
          hint="Used in storefront URLs. Unlock to edit."
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          rows={4}
          placeholder="What ties these products together, in the shopper's words."
          {...register('description')}
        />
      </div>
    </section>
  )
}

// ─── new ─────────────────────────────────────────────────────────────────────

export function NewCollectionPage() {
  const navigate = useNavigate()
  const createCollection = useCreateCollection()

  const [banner, setBanner] = React.useState<string | null>(null)
  const [rules, setRules] = React.useState<RuleDraft[]>([])

  const form = useForm<CollectionFormValues, unknown, CollectionOutput>({
    resolver: zodResolver(collectionSchema),
    defaultValues: {
      name: '',
      slug: '',
      description: '',
      imageUrl: '',
      type: 'MANUAL',
      matchType: 'ALL',
      status: 'DRAFT',
    },
  })

  const type = form.watch('type')
  const matchType = form.watch('matchType')

  const onSubmit = form.handleSubmit(async (values) => {
    setBanner(null)
    try {
      const created = await createCollection.mutateAsync({
        ...values,
        // Rules travel with the create so a dynamic collection is never saved
        // in a state that matches nothing.
        ...(values.type === 'DYNAMIC' ? { rules } : {}),
      })
      void navigate(`/collections/${created.id}`, { replace: true })
    } catch (error) {
      applyFieldErrors(error, (field, message) => form.setError(field, { message }), setBanner)
    }
  })

  return (
    <div className="space-y-4">
      <PageHeader
        backTo="/collections"
        backLabel="Back to collections"
        title="Create collection"
        actions={
          <Button type="submit" form={FORM_ID} disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && <Spinner />}
            Create collection
          </Button>
        }
      />

      {banner && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{banner}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4">
          <form id={FORM_ID} onSubmit={onSubmit} noValidate>
            <BasicFields form={form} isNew />
          </form>

          <TypePanel
            value={type}
            onChange={(next) => form.setValue('type', next, { shouldDirty: true })}
          />

          {type === 'DYNAMIC' ? (
            <RuleBuilder
              matchType={matchType}
              onMatchTypeChange={(next) =>
                form.setValue('matchType', next, { shouldDirty: true })
              }
              rules={rules}
              onRulesChange={setRules}
            />
          ) : (
            <section className="bg-card rounded-lg border">
              <header className="border-b px-5 py-3">
                <h2 className="text-muted-foreground text-sm font-semibold">Products</h2>
                <p className="text-muted-foreground/80 mt-0.5 text-xs">
                  Curated by hand, in your order.
                </p>
              </header>
              <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
                <div className="bg-muted text-muted-foreground flex size-9 items-center justify-center rounded-full">
                  <Package className="size-4" aria-hidden />
                </div>
                {/* A pinned product needs a collection to be pinned to. */}
                <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
                  <Lock className="size-3.5" aria-hidden />
                  Available once the collection exists
                </p>
              </div>
            </section>
          )}
        </div>

        <aside className="space-y-4">
          <StatusPanel form={form} />
          <ImagePanel form={form} />
        </aside>
      </div>
    </div>
  )
}

/**
 * One image per collection — the tile a campaign shelf or a landing page leads
 * with. It uploads on selection like a brand logo, so the form only ever
 * carries a URL and a slow upload never blocks Save.
 */
function ImagePanel({
  form,
}: {
  form: ReturnType<typeof useForm<CollectionFormValues, unknown, CollectionOutput>>
}) {
  const imageUrl = form.watch('imageUrl')

  return (
    <section className="bg-card rounded-lg border p-5">
      <MediaUploader
        folder="collections"
        value={imageUrl || null}
        onChange={(url) => form.setValue('imageUrl', url ?? '', { shouldDirty: true })}
        label="Image"
        hint="Shown on the collection tile and its landing page. PNG, JPEG, WebP, GIF or SVG."
        error={form.formState.errors.imageUrl?.message}
      />
    </section>
  )
}

function StatusPanel({
  form,
}: {
  form: ReturnType<typeof useForm<CollectionFormValues, unknown, CollectionOutput>>
}) {
  const status = form.watch('status')
  return (
    <section className="bg-card space-y-2 rounded-lg border p-5">
      <Label htmlFor="status" className="text-sm font-semibold">
        Status
      </Label>
      <Select
        value={status}
        onValueChange={(value) =>
          form.setValue('status', value as CollectionOutput['status'], { shouldDirty: true })
        }
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
        Only active collections appear on the storefront.
      </p>
    </section>
  )
}

// ─── edit ────────────────────────────────────────────────────────────────────

export default function CollectionEditorPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: collection, isPending, error } = useCollection(id)

  if (isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="space-y-4">
            <Skeleton className="h-56 w-full rounded-lg" />
            <Skeleton className="h-64 w-full rounded-lg" />
          </div>
          <Skeleton className="h-48 w-full rounded-lg" />
        </div>
      </div>
    )
  }

  if (error) {
    const missing = error instanceof ApiError && error.status === 404
    return (
      <EmptyState
        icon={SearchX}
        title={missing ? 'That collection no longer exists' : 'Could not load this collection'}
        description={missing ? undefined : error.message}
        action={
          <Button variant="outline" size="sm" onClick={() => void navigate('/collections')}>
            <ArrowLeft className="size-4" />
            Back to collections
          </Button>
        }
      />
    )
  }

  // Keyed on the id so switching collections remounts the form rather than
  // leaving the previous one's values in it.
  return <CollectionEditor key={collection.id} collection={collection} />
}

function CollectionEditor({ collection }: { collection: Collection }) {
  const navigate = useNavigate()
  const updateCollection = useUpdateCollection()
  const deleteCollection = useDeleteCollection()

  const [banner, setBanner] = React.useState<string | null>(null)
  const [deleting, setDeleting] = React.useState(false)
  const [rules, setRules] = React.useState<RuleDraft[]>(() => toDrafts(collection))

  const form = useForm<CollectionFormValues, unknown, CollectionOutput>({
    resolver: zodResolver(collectionSchema),
    defaultValues: toFormValues(collection),
  })

  const type = form.watch('type')
  const matchType = form.watch('matchType')

  const savedRules = JSON.stringify(toDrafts(collection))
  const rulesDirty = JSON.stringify(rules) !== savedRules
  const isDirty = form.formState.isDirty || rulesDirty

  React.useEffect(() => {
    if (rulesDirty) return
    setRules(toDrafts(collection))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedRules])

  const onSubmit = form.handleSubmit(async (values) => {
    setBanner(null)
    try {
      const saved = await updateCollection.mutateAsync({
        id: collection.id,
        values: { ...values, ...(values.type === 'DYNAMIC' ? { rules } : {}) },
      })
      // Re-seeded from the response, not from what was submitted: the server may
      // have adjusted a derived slug.
      form.reset(toFormValues(saved))
      setRules(toDrafts(saved))
    } catch (error) {
      applyFieldErrors(error, (field, message) => form.setError(field, { message }), setBanner)
    }
  })

  const confirmDelete = async () => {
    try {
      await deleteCollection.mutateAsync(collection.id)
      toast.success(`${collection.name} deleted`)
      void navigate('/collections')
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not delete this collection')
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        backTo="/collections"
        backLabel="Back to collections"
        title={collection.name}
        actions={
          <>
            <StatusBadge status={collection.status} />
            <Button
              type="button"
              onClick={() => void onSubmit()}
              disabled={!isDirty || form.formState.isSubmitting}
            >
              {form.formState.isSubmitting && <Spinner />}
              Save
            </Button>
            <Button variant="outline" size="icon" onClick={() => setDeleting(true)} aria-label="Delete">
              <Trash2 className="size-4" />
            </Button>
          </>
        }
      />

      {banner && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{banner}</AlertDescription>
        </Alert>
      )}

      {collection.ruleError && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>
            {collection.ruleError}. Check the conditions below — one of them points at something
            that has been deleted.
          </AlertDescription>
        </Alert>
      )}

      {isDirty && (
        <p className="text-muted-foreground text-xs">
          Unsaved changes.
          {type === 'MANUAL' && ' Products save on their own — everything else waits for Save.'}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4">
          <form id={FORM_ID} onSubmit={onSubmit} noValidate>
            <BasicFields form={form} isNew={false} />
          </form>

          <TypePanel
            value={type}
            onChange={(next) => form.setValue('type', next, { shouldDirty: true })}
          />

          {type === 'DYNAMIC' ? (
            <RuleBuilder
              matchType={matchType}
              onMatchTypeChange={(next) =>
                form.setValue('matchType', next, { shouldDirty: true })
              }
              rules={rules}
              onRulesChange={setRules}
            />
          ) : (
            <ManualProductsPanel collectionId={collection.id} />
          )}
        </div>

        <aside className="space-y-4">
          <StatusPanel form={form} />
          <ImagePanel form={form} />

          <section className="bg-card text-muted-foreground space-y-1.5 rounded-lg border p-5 text-xs">
            <p>
              Holds{' '}
              <span className="text-foreground">{formatCount(collection.productCount)}</span>{' '}
              {collection.productCount === 1 ? 'product' : 'products'}
            </p>
            <p>
              Created <span className="text-foreground">{formatDate(collection.createdAt)}</span>
            </p>
            <p>
              Updated <span className="text-foreground">{formatRelative(collection.updatedAt)}</span>
            </p>
          </section>
        </aside>
      </div>

      <ConfirmDialog
        open={deleting}
        onOpenChange={(open) => !open && setDeleting(false)}
        title={`Delete ${collection.name}?`}
        description="The products themselves are untouched — only this grouping goes."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={confirmDelete}
      />
    </div>
  )
}
