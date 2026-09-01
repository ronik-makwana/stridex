import * as React from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  AlertCircle,
  ArrowLeft,
  Copy,
  ImageIcon,
  MoreHorizontal,
  SearchX,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api-client'
import { formatDate, formatRelative } from '@/lib/format'
import { useAttributes } from '@/features/attributes/queries'
import { useVariantOptions } from '@/features/variant-options/queries'
import { useProduct } from '@/features/products/queries'
import {
  useCreateProduct,
  useDeleteProduct,
  useSetProductStatus,
  useUpdateProduct,
} from '@/features/products/mutations'
import {
  emptyEntry,
  serializeEntries,
  toDrafts,
  toEntries,
  type AttributeEntry,
} from '@/features/products/attributes'
import {
  productSchema,
  type ProductFormValues,
  type ProductOutput,
} from '@/features/products/schemas'
import type { Product } from '@/types/api'
import { PageHeader } from '@/components/page-header'
import { EmptyState } from '@/components/empty-state'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { StatusBadge } from '@/components/status-badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { BasicInformation, OrganizationPanel, StatusPanel } from './product-form'
import { ProductAttributesPanel } from './product-attributes-panel'
import { ProductMediaPanel } from './product-media-panel'
import { ProductVariantsPanel } from './product-variants-panel'
import {
  MAX_OPTIONS,
  VariantOptionsPicker,
  defaultValueIds,
  type Selection,
} from './variant-options-picker'
import { LockedPanel } from './locked-panel'
import { PublishMenu } from './publish-menu'
import { DuplicateProductDialog } from './duplicate-product-dialog'

const FORM_ID = 'product-form'

const toFormValues = (product: Product): ProductFormValues => ({
  title: product.title,
  slug: product.slug,
  description: product.description ?? '',
  brandId: product.brandId ?? '',
  categoryId: product.categoryId ?? '',
  status: product.status,
  // Names, not ids: a tag is created by typing it, so the form holds what was
  // typed and the server resolves it to a row.
  tags: (product.tags ?? []).map((tag) => tag.name),
  collectionIds: (product.collections ?? []).map((collection) => collection.id),
})

/** Server field errors → the form control that owns them. */
function applyFieldErrors(
  error: unknown,
  setError: (field: keyof ProductFormValues, message: string) => void,
  setBanner: (message: string) => void,
) {
  if (error instanceof ApiError && error.isFieldError) {
    for (const [field, message] of Object.entries(error.fields!)) {
      if (
        field === 'title' ||
        field === 'slug' ||
        field === 'description' ||
        field === 'tags' ||
        field === 'collectionIds'
      ) {
        setError(field, message)
      } else {
        setBanner(message)
      }
    }
    return
  }
  setBanner(
    error instanceof ApiError ? error.message : 'Something went wrong. Try again in a moment.',
  )
}

// ─── new ─────────────────────────────────────────────────────────────────────

/**
 * Deliberately smaller than the editor. Media and variants both need a product
 * id to hang off, and the alternative — holding uploads and generated SKUs in
 * memory until a Create button is pressed — is a long way to build a form that
 * loses everything on one failed request.
 *
 * So: name it, file it, create it, and land in the full editor.
 */
export function NewProductPage() {
  const navigate = useNavigate()
  const createProduct = useCreateProduct()
  const { data: attributes } = useAttributes({ limit: 100, sort: 'position:asc' })
  // Same query the picker below runs, so this is a cache read rather than a
  // second request.
  const { data: options } = useVariantOptions({
    limit: 100,
    sort: 'position:asc',
    withValues: true,
  })

  const [banner, setBanner] = React.useState<string | null>(null)
  const [entries, setEntries] = React.useState<AttributeEntry[]>([])
  const [seeded, setSeeded] = React.useState(false)
  const [optionsSeeded, setOptionsSeeded] = React.useState(false)
  // Errors on the option rows appear after a failed submit, not while the
  // operator is still ticking — a form that goes red before you have finished
  // filling it in is nagging, not helping.
  const [showOptionErrors, setShowOptionErrors] = React.useState(false)
  // Options are plain ids, so they can be chosen before the product exists and
  // saved with it. That is what removes the second round trip: after Create,
  // generate is live immediately rather than one more save away.
  const [variantOptionIds, setVariantOptionIds] = React.useState<string[]>([])
  const [selection, setSelection] = React.useState<Selection>({})

  const form = useForm<ProductFormValues, unknown, ProductOutput>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      title: '',
      slug: '',
      description: '',
      brandId: '',
      categoryId: '',
      status: 'DRAFT',
      tags: [],
      collectionIds: [],
    },
  })

  // Attributes are picked per product rather than inherited from a category, so
  // the block would otherwise open empty on every new product. Anything flagged
  // suggested is the cheap fix for that, and it is why the flag exists.
  React.useEffect(() => {
    if (seeded || !attributes) return
    setEntries(
      attributes.data
        .filter((attribute) => attribute.isSuggested)
        .map((attribute) => emptyEntry(attribute.id)),
    )
    setSeeded(true)
  }, [attributes, seeded])

  /**
   * Every option in the catalogue is added up front. In a shoe store a product
   * varies by Colour and Size essentially always, so starting empty means the
   * same two clicks on every product forever — and an option nobody added is an
   * option nobody notices is missing until the variants come out wrong.
   *
   * Removing one is a single ✕, which is the cheaper mistake to make.
   */
  React.useEffect(() => {
    if (optionsSeeded || !options) return
    const picked = options.data.slice(0, MAX_OPTIONS)
    setVariantOptionIds(picked.map((option) => option.id))
    setSelection(
      Object.fromEntries(picked.map((option) => [option.id, defaultValueIds(option.values)])),
    )
    setOptionsSeeded(true)
  }, [options, optionsSeeded])

  const definitions = React.useMemo(
    () => new Map((attributes?.data ?? []).map((attribute) => [attribute.id, attribute])),
    [attributes],
  )

  /**
   * An option with nothing ticked generates nothing, and the product ends up
   * saved with a column its variants will never fill. Caught here rather than
   * at generate time, because by then the operator has moved on.
   */
  const untickedOptionIds = variantOptionIds.filter(
    (optionId) => (selection[optionId] ?? []).length === 0,
  )

  const onSubmit = form.handleSubmit(async (values) => {
    setBanner(null)

    if (untickedOptionIds.length > 0) {
      setShowOptionErrors(true)
      setBanner(
        untickedOptionIds.length === 1
          ? 'One variant option has no values ticked. Tick at least one, or remove the option.'
          : `${untickedOptionIds.length} variant options have no values ticked. Tick at least one on each, or remove them.`,
      )
      return
    }

    try {
      const created = await createProduct.mutateAsync({
        ...values,
        attributes: toDrafts(entries, definitions),
        variantOptions: variantOptionIds.map((variantOptionId) => ({ variantOptionId })),
      })
      // The ticked values travel with the navigation. They are a choice the
      // operator already made, and re-ticking them in the editor would be the
      // most annoying possible way to start.
      void navigate(`/products/${created.id}`, {
        replace: true,
        state: { optionSelection: selection },
      })
    } catch (error) {
      applyFieldErrors(
        error,
        (field, message) => form.setError(field, { message }),
        setBanner,
      )
    }
  })

  return (
    <div className="space-y-4">
      <PageHeader
        backTo="/products"
        backLabel="Back to products"
        title="Create product"
        actions={
          <Button type="submit" form={FORM_ID} disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && <Spinner />}
            Create product
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
            <BasicInformation form={form} isNew />
          </form>

          {/* Same order as the editor, so nothing appears to move after saving. */}
          <LockedPanel
            icon={ImageIcon}
            title="Media"
            description="Drag to order. The first image is the cover the storefront leads with."
            reason="Available once the product exists"
          />

          <ProductAttributesPanel entries={entries} onChange={setEntries} />

          <VariantOptionsPicker
            variantOptionIds={variantOptionIds}
            onOptionsChange={setVariantOptionIds}
            selection={selection}
            onSelectionChange={setSelection}
            description="Tick the values you stock, and remove any option this product does not vary by. Variants are generated once the product exists."
            emptyDescription="Add Colour and Size in the catalogue first — a variant is one value from each."
            invalidOptionIds={showOptionErrors ? untickedOptionIds : []}
          />
        </div>

        <aside className="space-y-4">
          <StatusPanel form={form} />
          <OrganizationPanel form={form} />
        </aside>
      </div>
    </div>
  )
}

// ─── edit ────────────────────────────────────────────────────────────────────

export default function ProductEditorPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: product, isPending, error } = useProduct(id)

  if (isPending) return <EditorSkeleton />

  if (error) {
    const missing = error instanceof ApiError && error.status === 404
    return (
      <EmptyState
        icon={SearchX}
        title={missing ? 'That product no longer exists' : 'Could not load this product'}
        description={missing ? undefined : error.message}
        action={
          <Button variant="outline" size="sm" onClick={() => void navigate('/products')}>
            <ArrowLeft className="size-4" />
            Back to products
          </Button>
        }
      />
    )
  }

  // Keyed on the id so switching products remounts the form rather than leaving
  // the previous one's values in it.
  return <ProductEditor key={product.id} product={product} />
}

function ProductEditor({ product }: { product: Product }) {
  const navigate = useNavigate()
  const location = useLocation()
  const updateProduct = useUpdateProduct()
  const setStatus = useSetProductStatus()
  const deleteProduct = useDeleteProduct()
  const { data: attributes } = useAttributes({ limit: 100, sort: 'position:asc' })

  const [banner, setBanner] = React.useState<string | null>(null)
  const [duplicating, setDuplicating] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [deleteBlock, setDeleteBlock] = React.useState<string | null>(null)

  const form = useForm<ProductFormValues, unknown, ProductOutput>({
    resolver: zodResolver(productSchema),
    defaultValues: toFormValues(product),
  })

  // Attributes and options are not form fields — they are lists two panels own
  // — but they save with the product, so the page holds them and the dirty
  // check spans all three.
  const [entries, setEntries] = React.useState<AttributeEntry[]>(() =>
    toEntries(product.attributes ?? []),
  )
  const [variantOptionIds, setVariantOptionIds] = React.useState<string[]>(() =>
    (product.variantOptions ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((row) => row.variantOptionId),
  )

  const savedEntries = React.useMemo(
    () => serializeEntries(toEntries(product.attributes ?? [])),
    [product.attributes],
  )
  const savedOptionIds = React.useMemo(
    () =>
      (product.variantOptions ?? [])
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((row) => row.variantOptionId)
        .join(','),
    [product.variantOptions],
  )

  const attributesDirty = serializeEntries(entries) !== savedEntries
  const optionsDirty = variantOptionIds.join(',') !== savedOptionIds
  const isDirty = form.formState.isDirty || attributesDirty || optionsDirty

  // The panels below re-seed from the server after every save, so a refetch
  // triggered elsewhere (a duplicate, another tab) does not strand local edits.
  React.useEffect(() => {
    if (attributesDirty) return
    setEntries(toEntries(product.attributes ?? []))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedEntries])

  React.useEffect(() => {
    if (optionsDirty) return
    setVariantOptionIds(savedOptionIds ? savedOptionIds.split(',') : [])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedOptionIds])

  const definitions = React.useMemo(
    () => new Map((attributes?.data ?? []).map((attribute) => [attribute.id, attribute])),
    [attributes],
  )

  const onSubmit = form.handleSubmit(runSave)

  /**
   * The same save the button performs, awaitable and honest about failing —
   * the variants panel calls it before generating, and has to know whether the
   * options actually reached the server. Wrapped by hand rather than awaiting
   * `handleSubmit`, whose promise resolves either way when validation is what
   * failed.
   */
  const save = () =>
    new Promise<void>((resolve, reject) => {
      void form.handleSubmit(
        async (values) => {
          try {
            await runSave(values)
            resolve()
          } catch (error) {
            reject(error)
          }
        },
        () => reject(new Error('Fix the errors on this form first')),
      )()
    })

  async function runSave(values: ProductOutput) {
    setBanner(null)
    try {
      const saved = await updateProduct.mutateAsync({
        id: product.id,
        values: {
          ...values,
          attributes: toDrafts(entries, definitions),
          variantOptions: variantOptionIds.map((variantOptionId) => ({ variantOptionId })),
        },
      })
      // Re-seeded from the response, not from what was submitted: the server may
      // have adjusted a derived slug, and the form should show what is stored.
      form.reset(toFormValues(saved))
      setEntries(toEntries(saved.attributes ?? []))
    } catch (error) {
      applyFieldErrors(error, (field, message) => form.setError(field, { message }), setBanner)
      throw error
    }
  }

  const confirmDelete = async () => {
    try {
      await deleteProduct.mutateAsync(product.id)
      toast.success(`${product.title} deleted`)
      void navigate('/products')
    } catch (error) {
      // 422 is the designed outcome, not a failure: this product has sold.
      if (error instanceof ApiError && error.status === 422) {
        setDeleteBlock(error.reason ?? error.message)
        return
      }
      toast.error(error instanceof ApiError ? error.message : 'Could not delete this product')
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        backTo="/products"
        backLabel="Back to products"
        title={product.title}
        actions={
          <>
            <StatusBadge status={product.status} />

            {product.status !== 'ACTIVE' && (
              <PublishMenu productId={product.id} disabled={isDirty} />
            )}

            <Button type="button" onClick={() => void onSubmit()} disabled={!isDirty || form.formState.isSubmitting}>
              {form.formState.isSubmitting && <Spinner />}
              Save
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="More actions">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onSelect={() => setDuplicating(true)}>
                  <Copy className="size-4" />
                  Duplicate
                </DropdownMenuItem>
                {product.status !== 'DRAFT' && (
                  <DropdownMenuItem
                    onSelect={() =>
                      void setStatus.mutateAsync({ id: product.id, status: 'DRAFT' })
                    }
                  >
                    Set to draft
                  </DropdownMenuItem>
                )}
                {product.status !== 'ARCHIVED' && (
                  <DropdownMenuItem
                    onSelect={() =>
                      void setStatus.mutateAsync({ id: product.id, status: 'ARCHIVED' })
                    }
                  >
                    Archive
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => {
                    setDeleteBlock(null)
                    setDeleting(true)
                  }}
                >
                  <Trash2 className="size-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      {banner && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{banner}</AlertDescription>
        </Alert>
      )}

      {isDirty && (
        <p className="text-muted-foreground text-xs">
          Unsaved changes. Media and variants save on their own — everything else waits for Save.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4">
          <form id={FORM_ID} onSubmit={onSubmit} noValidate>
            <BasicInformation form={form} isNew={false} />
          </form>

          <ProductMediaPanel productId={product.id} media={product.media ?? []} />

          <ProductAttributesPanel entries={entries} onChange={setEntries} />

          <ProductVariantsPanel
            product={product}
            variantOptionIds={variantOptionIds}
            onOptionsChange={setVariantOptionIds}
            hasUnsavedOptions={optionsDirty}
            onSaveOptions={save}
            initialSelection={
              (location.state as { optionSelection?: Selection } | null)?.optionSelection
            }
          />
        </div>

        <aside className="space-y-4">
          <StatusPanel form={form} />
          <OrganizationPanel form={form} collections={product.collections ?? []} />

          <section className="bg-card text-muted-foreground space-y-1.5 rounded-lg border p-5 text-xs">
            <p>
              Created <span className="text-foreground">{formatDate(product.createdAt)}</span>
            </p>
            <p>
              Updated <span className="text-foreground">{formatRelative(product.updatedAt)}</span>
            </p>
            <p>
              First published{' '}
              <span className="text-foreground">
                {product.publishedAt ? formatDate(product.publishedAt) : 'never'}
              </span>
            </p>
            <p className="pt-1.5">
              <span className="text-foreground">{product.variantCount}</span>{' '}
              {product.variantCount === 1 ? 'variant' : 'variants'} ·{' '}
              <span className="text-foreground">{product.mediaCount}</span>{' '}
              {product.mediaCount === 1 ? 'image' : 'images'}
            </p>
          </section>
        </aside>
      </div>

      <DuplicateProductDialog
        product={product}
        open={duplicating}
        onOpenChange={setDuplicating}
      />

      {/*
        Two dialogs in one. Before the attempt it asks to confirm; after a 422
        it becomes the explanation. Retrying a blocked delete would fail
        identically, so there is no confirm button on that side.
      */}
      <ConfirmDialog
        open={deleting}
        onOpenChange={(open) => !open && setDeleting(false)}
        title={deleteBlock ? `Cannot delete ${product.title}` : `Delete ${product.title}?`}
        description={
          deleteBlock ??
          'This deletes its images, variants and stock. Products that have sold cannot be deleted — archive those instead.'
        }
        cancelLabel={deleteBlock ? 'Close' : 'Cancel'}
        confirmLabel={deleteBlock ? undefined : 'Delete'}
        variant="destructive"
        onConfirm={confirmDelete}
      />
    </div>
  )
}

function EditorSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-5 w-24" />
      <Skeleton className="h-8 w-64" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4">
          <Skeleton className="h-64 w-full rounded-lg" />
          <Skeleton className="h-48 w-full rounded-lg" />
          <Skeleton className="h-48 w-full rounded-lg" />
        </div>
        <Skeleton className="h-72 w-full rounded-lg" />
      </div>
    </div>
  )
}
