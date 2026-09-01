import * as React from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { FormProvider, useForm, useFormContext } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { AlertCircle, ChevronDown, CirclePlay, CircleStop, Copy, Tag, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api-client'
import { formatDate } from '@/lib/format'
import { useDiscount } from '@/features/discounts/queries'
import {
  useCreateDiscount,
  useDeleteDiscount,
  useSetDiscountState,
  useUpdateDiscount,
} from '@/features/discounts/mutations'
import { discountFormSchema, type DiscountFormValues } from '@/features/discounts/schemas'
import type { DiscountValues } from '@/features/discounts/api'
import type { Discount, DiscountKind } from '@/types/api'
import { PageHeader } from '@/components/page-header'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { DiscountForm, type Selections } from './discount-form'
import { DiscountStateBadge } from './state-badge'

const FORM_ID = 'discount-form'

const EMPTY_SELECTIONS: Selections = {
  productIds: [],
  categoryIds: [],
  collectionIds: [],
  customerIds: [],
}

const EMPTY_KNOWN = { products: [], categories: [], collections: [], customers: [] }

/** Local date and time parts, so the pickers show the operator's own clock. */
function splitDate(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: '', time: '' }
  const at = new Date(iso)
  const pad = (value: number) => String(value).padStart(2, '0')
  return {
    date: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`,
    time: `${pad(at.getHours())}:${pad(at.getMinutes())}`,
  }
}

function defaultsForNew(): DiscountFormValues {
  const now = splitDate(new Date().toISOString())
  return {
    code: '',
    type: 'PERCENT',
    value: '',
    capEnabled: false,
    maxDiscountAmount: '',
    appliesTo: 'PRODUCTS',
    eligibility: 'ALL_CUSTOMERS',
    minRequirement: 'NONE',
    minCartValue: '',
    minQuantity: '',
    excludeExpensiveShipping: false,
    maxShippingAmount: '',
    limitTotal: false,
    usageLimit: '',
    onePerCustomer: false,
    combinesWithProduct: false,
    combinesWithOrder: false,
    combinesWithShipping: false,
    startsAtDate: now.date,
    startsAtTime: now.time,
    hasEndDate: false,
    endsAtDate: '',
    endsAtTime: '',
  }
}

function toFormValues(discount: Discount): DiscountFormValues {
  const starts = splitDate(discount.startsAt)
  const ends = splitDate(discount.endsAt)
  return {
    code: discount.code,
    type: discount.type,
    value: String(Number(discount.value)),
    capEnabled: discount.maxDiscountAmount !== null,
    maxDiscountAmount: discount.maxDiscountAmount ? String(Number(discount.maxDiscountAmount)) : '',
    appliesTo: discount.appliesTo ?? 'PRODUCTS',
    eligibility: discount.eligibility,
    minRequirement: discount.minRequirement,
    minCartValue: discount.minCartValue ? String(Number(discount.minCartValue)) : '',
    minQuantity: discount.minQuantity ? String(discount.minQuantity) : '',
    excludeExpensiveShipping: discount.maxShippingAmount !== null,
    maxShippingAmount: discount.maxShippingAmount
      ? String(Number(discount.maxShippingAmount))
      : '',
    limitTotal: discount.usageLimit !== null,
    usageLimit: discount.usageLimit ? String(discount.usageLimit) : '',
    onePerCustomer: discount.perUserLimit === 1,
    combinesWithProduct: discount.combinesWithProduct,
    combinesWithOrder: discount.combinesWithOrder,
    combinesWithShipping: discount.combinesWithShipping,
    startsAtDate: starts.date,
    startsAtTime: starts.time,
    hasEndDate: Boolean(discount.endsAt),
    endsAtDate: ends.date,
    endsAtTime: ends.time,
  }
}

/**
 * The form's strings become the API's numbers here, and only here.
 *
 * Fields belonging to an unchosen branch are sent as null rather than as
 * whatever the input still holds: an operator who typed a minimum, changed
 * their mind and switched to "no minimum" did not mean to keep the number.
 */
function toApiValues(
  values: DiscountFormValues,
  selections: Selections,
  kind: DiscountKind,
): DiscountValues {
  const startsAt = new Date(`${values.startsAtDate}T${values.startsAtTime || '00:00'}`)
  const endsAt = values.hasEndDate
    ? new Date(`${values.endsAtDate}T${values.endsAtTime || '23:59'}`)
    : null

  return {
    code: values.code,
    // No internal note in the form: the code and its rules are the whole of
    // what a discount is here.
    description: null,
    kind,
    type: values.type,
    value: Number(values.value),
    maxDiscountAmount:
      values.type === 'PERCENT' && values.capEnabled ? Number(values.maxDiscountAmount) : null,
    // An order discount applies to the cart: it has no targets, and sending
    // any would be sending state from a form branch nobody filled in.
    appliesTo: kind === 'PRODUCT' ? values.appliesTo : null,
    productIds: kind === 'PRODUCT' && values.appliesTo === 'PRODUCTS' ? selections.productIds : [],
    categoryIds:
      kind === 'PRODUCT' && values.appliesTo === 'CATEGORIES' ? selections.categoryIds : [],
    collectionIds:
      kind === 'PRODUCT' && values.appliesTo === 'COLLECTIONS' ? selections.collectionIds : [],
    eligibility: values.eligibility,
    customerIds: values.eligibility === 'SPECIFIC_CUSTOMERS' ? selections.customerIds : [],
    minRequirement: values.minRequirement,
    minCartValue: values.minRequirement === 'PURCHASE_AMOUNT' ? Number(values.minCartValue) : null,
    minQuantity: values.minRequirement === 'ITEM_QUANTITY' ? Number(values.minQuantity) : null,
    maxShippingAmount:
      kind === 'SHIPPING' && values.excludeExpensiveShipping
        ? Number(values.maxShippingAmount)
        : null,
    usageLimit: values.limitTotal ? Number(values.usageLimit) : null,
    // The tick is a limit of one. Left off it is unlimited per person.
    perUserLimit: values.onePerCustomer ? 1 : null,
    combinesWithProduct: values.combinesWithProduct,
    combinesWithOrder: values.combinesWithOrder,
    // A shipping discount cannot sit beside another one whatever is ticked, so
    // it never claims it can.
    combinesWithShipping: kind === 'SHIPPING' ? false : values.combinesWithShipping,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt ? endsAt.toISOString() : null,
  }
}

/**
 * A 422 from the server names the field. The id lists are not react-hook-form
 * fields, so their messages land beside the picker instead — the operator still
 * gets told where to look (§16).
 */
function useServerErrors() {
  const [banner, setBanner] = React.useState<string | null>(null)
  const [selectionErrors, setSelectionErrors] = React.useState<
    Partial<Record<keyof Selections, string>>
  >({})

  const clear = () => {
    setBanner(null)
    setSelectionErrors({})
  }

  const clearSelectionError = (field: keyof Selections) =>
    setSelectionErrors((current) => {
      if (!current[field]) return current
      const next = { ...current }
      delete next[field]
      return next
    })

  const apply = (error: unknown, setFieldError: (field: string, message: string) => void) => {
    clear()
    if (error instanceof ApiError && error.fields) {
      const selection: Partial<Record<keyof Selections, string>> = {}
      for (const [field, message] of Object.entries(error.fields)) {
        if (['productIds', 'categoryIds', 'collectionIds', 'customerIds'].includes(field)) {
          selection[field as keyof Selections] = message
        } else {
          setFieldError(field, message)
        }
      }
      setSelectionErrors(selection)
      if (Object.keys(error.fields).length === 0) setBanner(error.message)
      return
    }
    setBanner(
      error instanceof ApiError ? error.message : 'Something went wrong. Try again in a moment.',
    )
  }

  return { banner, setBanner, selectionErrors, clearSelectionError, apply, clear }
}

// ─── the shared shell ────────────────────────────────────────────────────────

function Editor({
  kind,
  title,
  backLabel,
  submitLabel,
  defaultValues,
  initialSelections,
  known,
  discount,
  onSubmit,
  onDelete,
  onToggleState,
  onDuplicate,
}: {
  kind: DiscountKind
  title: string
  backLabel: string
  submitLabel: string
  defaultValues: DiscountFormValues
  initialSelections: Selections
  known: Pick<Discount, 'products' | 'categories' | 'collections' | 'customers'>
  discount?: Discount
  onSubmit: (values: DiscountValues) => Promise<void>
  onDelete?: () => Promise<void>
  /** Saved discounts only: nothing to duplicate or stop until it exists. */
  onToggleState?: () => Promise<void>
  onDuplicate?: () => void
}) {
  const [selections, setSelections] = React.useState(initialSelections)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const { banner, selectionErrors, clearSelectionError, apply, clear } = useServerErrors()

  /**
   * A server error about the selection is answered by changing the selection,
   * so it goes the moment that happens. Leaving it up would have the form
   * telling an operator to choose a product underneath the product they just
   * chose.
   */
  const changeSelections = (next: Selections) => {
    for (const key of Object.keys(next) as (keyof Selections)[]) {
      if (next[key] !== selections[key]) clearSelectionError(key)
    }
    setSelections(next)
  }

  const form = useForm<DiscountFormValues>({
    resolver: zodResolver(discountFormSchema),
    defaultValues,
  })

  const submit = form.handleSubmit(async (values) => {
    clear()
    try {
      await onSubmit(toApiValues(values, selections, kind))
    } catch (error) {
      apply(error, (field, message) =>
        form.setError(field as keyof DiscountFormValues, { message }),
      )
    }
  })

  return (
    <div className="space-y-4">
      <PageHeader
        backTo="/discounts"
        backLabel={backLabel}
        title={title}
        badge={discount ? <DiscountStateBadge state={discount.state} /> : undefined}
        actions={
          <div className="flex items-center gap-2">
            {onDuplicate && (
              <Button type="button" variant="outline" onClick={onDuplicate}>
                <Copy className="size-4" />
                Duplicate
              </Button>
            )}

            {/*
              Everything that changes the discount without going through the
              form lives behind one menu, so the header does not grow a button
              per verb. Activate and deactivate are the same slot: a discount is
              either running or it is not.
            */}
            {discount && (onToggleState || onDelete) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline">
                    More actions
                    <ChevronDown className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  {onToggleState && (
                    <DropdownMenuItem onSelect={() => void onToggleState()}>
                      {discount.state === 'EXPIRED' ? (
                        <>
                          <CirclePlay className="size-4" />
                          Activate
                        </>
                      ) : (
                        <>
                          <CircleStop className="size-4" />
                          Deactivate
                        </>
                      )}
                    </DropdownMenuItem>
                  )}
                  {onDelete && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => setConfirmDelete(true)}
                      >
                        <Trash2 className="size-4" />
                        Delete
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            <Button type="submit" form={FORM_ID} disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting && <Spinner />}
              {submitLabel}
            </Button>
          </div>
        }
      />

      {banner && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{banner}</AlertDescription>
        </Alert>
      )}

      <form id={FORM_ID} onSubmit={submit} noValidate>
        <FormProvider {...form}>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <DiscountForm
            kind={kind}
            selections={selections}
            onSelectionsChange={changeSelections}
            known={known}
            selectionErrors={selectionErrors}
          />

          <aside className="space-y-4">
            <Summary kind={kind} selections={selections} discount={discount} />
          </aside>
        </div>
        </FormProvider>
      </form>

      {onDelete && (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title="Delete this discount?"
          description="A discount that has already been used cannot be deleted — archive it instead."
          confirmLabel="Delete"
          variant="destructive"
          onConfirm={onDelete}
        />
      )}
    </div>
  )
}

/**
 * The card on the right, and it reads the **form**, not the saved discount.
 *
 * A summary that only appears after saving is a summary that cannot help with
 * the decision it is summarising. This one fills in as the operator types, so
 * "what have I actually just built" is answerable before they commit to it —
 * which is the only moment the question is worth asking.
 *
 * `usedCount` is the exception: it is a fact about the past and only exists
 * once there is a discount to have a past.
 */
/** Indian grouping: ₹2,000, not ₹2000. The card is read at a glance. */
const grouped = (value: string | number) => Number(value).toLocaleString('en-IN')

function Summary({
  kind,
  selections,
  discount,
}: {
  kind: DiscountKind
  selections: Selections
  discount?: Discount
}) {
  const { watch } = useFormContext<DiscountFormValues>()
  const values = watch()

  const amount =
    values.value === ''
      ? null
      : values.type === 'PERCENT'
        ? `${Number(values.value)}% off`
        : `₹${grouped(values.value)} off`

  const cap =
    values.type === 'PERCENT' && values.capEnabled && values.maxDiscountAmount
      ? `, up to ₹${grouped(values.maxDiscountAmount)}`
      : ''

  const chosen =
    values.appliesTo === 'PRODUCTS'
      ? { count: selections.productIds.length, one: 'product', many: 'products' }
      : values.appliesTo === 'CATEGORIES'
        ? { count: selections.categoryIds.length, one: 'category', many: 'categories' }
        : { count: selections.collectionIds.length, one: 'collection', many: 'collections' }

  const combines = [
    values.combinesWithProduct && 'product',
    values.combinesWithOrder && 'order',
    values.combinesWithShipping && 'shipping',
  ].filter(Boolean) as string[]

  const today = new Date()
  const startsToday =
    values.startsAtDate ===
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
      today.getDate(),
    ).padStart(2, '0')}`

  const details = [
    kind === 'ORDER'
      ? 'The whole cart'
      : kind === 'SHIPPING'
        ? values.excludeExpensiveShipping && values.maxShippingAmount
          ? `Delivery up to ₹${grouped(values.maxShippingAmount)}`
          : 'Any delivery service'
        : chosen.count === 0
        ? `No ${chosen.many} chosen yet`
        : `${chosen.count} ${chosen.count === 1 ? chosen.one : chosen.many}`,
    values.eligibility === 'ALL_CUSTOMERS'
      ? 'All customers'
      : selections.customerIds.length === 0
        ? 'No customers chosen yet'
        : `${selections.customerIds.length} customer${selections.customerIds.length === 1 ? '' : 's'}`,
    values.minRequirement === 'NONE'
      ? 'No minimum purchase requirement'
      : values.minRequirement === 'PURCHASE_AMOUNT'
        ? values.minCartValue
          ? `Minimum purchase of ₹${grouped(values.minCartValue)}`
          : 'Minimum purchase amount'
        : values.minQuantity
          ? `Minimum of ${grouped(values.minQuantity)} items`
          : 'Minimum quantity of items',
    values.limitTotal && values.usageLimit
      ? `Limited to ${grouped(values.usageLimit)} uses`
      : values.limitTotal
        ? 'Limited number of uses'
        : 'No usage limits',
    values.onePerCustomer ? 'One use per customer' : null,
    combines.length === 0
      ? "Can't combine with other discounts"
      : `Combines with ${combines.join(', ')} discounts`,
    !values.startsAtDate
      ? null
      : values.hasEndDate && values.endsAtDate
        ? `Active ${startsToday ? 'from today' : `from ${formatDate(values.startsAtDate)}`} until ${formatDate(values.endsAtDate)}`
        : `Active from ${startsToday ? 'today' : formatDate(values.startsAtDate)}`,
    discount ? `Used ${discount.usedCount} time${discount.usedCount === 1 ? '' : 's'}` : null,
  ].filter(Boolean) as string[]

  return (
    <section className="bg-card space-y-4 rounded-lg border p-5">
      <div>
        {/* The code, or the absence of one said plainly — a blank space here
            reads as a card that failed to load. */}
        <h2 className="text-sm font-semibold">
          {values.code ? (
            <span className="font-mono">{values.code.toUpperCase()}</span>
          ) : (
            'No discount code yet'
          )}
        </h2>
        <p className="text-muted-foreground text-xs">Code</p>
      </div>

      <div>
        <h3 className="text-sm font-semibold">Type</h3>
        <p className="mt-1 text-sm">
          {amount
            ? `${amount}${cap}`
            : kind === 'ORDER'
              ? 'Amount off order'
              : kind === 'SHIPPING'
                ? 'Amount off delivery'
                : 'Amount off products'}
        </p>
        <p className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-xs">
          <Tag className="size-3.5" />
          {kind === 'ORDER'
            ? 'Order discount'
            : kind === 'SHIPPING'
              ? 'Shipping discount'
              : 'Product discount'}
        </p>
      </div>

      <div>
        <h3 className="text-sm font-semibold">Details</h3>
        <ul className="text-muted-foreground mt-1.5 space-y-1 text-xs">
          {details.map((line) => (
            <li key={line} className="flex gap-2">
              <span aria-hidden>•</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

// ─── new ─────────────────────────────────────────────────────────────────────

type DuplicateState = {
  kind: DiscountKind
  values: DiscountFormValues
  selections: Selections
  known: Pick<Discount, 'products' | 'categories' | 'collections' | 'customers'>
}

export function NewDiscountPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const createDiscount = useCreateDiscount()

  /**
   * Duplicate lands here with the original's settings and a blank code.
   *
   * It prefills rather than saving a copy, because there is no draft state to
   * park one in: a duplicate that saved itself would be a second live discount
   * the moment it was made, with a code nobody chose. Nothing exists until
   * Create is pressed.
   */
  const duplicated = (location.state as DuplicateState | null) ?? null
  /**
   * `?kind=ORDER` — chosen from the list's Create menu. Not a field on the form:
   * it decides which questions the form asks, so it has to be settled before
   * the form renders.
   */
  const kind: DiscountKind =
    duplicated?.kind ??
    (['ORDER', 'SHIPPING'].includes(new URLSearchParams(location.search).get('kind') ?? '')
      ? (new URLSearchParams(location.search).get('kind') as DiscountKind)
      : 'PRODUCT')

  return (
    <Editor
      kind={kind}
      title={
        duplicated
          ? 'Duplicate discount'
          : kind === 'ORDER'
            ? 'Create order discount'
            : kind === 'SHIPPING'
              ? 'Create shipping discount'
              : 'Create product discount'
      }
      backLabel="Back to discounts"
      submitLabel="Create discount"
      defaultValues={duplicated?.values ?? defaultsForNew()}
      initialSelections={duplicated?.selections ?? EMPTY_SELECTIONS}
      known={duplicated?.known ?? EMPTY_KNOWN}
      onSubmit={async (values) => {
        const created = await createDiscount.mutateAsync(values)
        toast.success(`${created.code} created`)
        void navigate(`/discounts/${created.id}`, { replace: true })
      }}
    />
  )
}

// ─── edit ────────────────────────────────────────────────────────────────────

export default function DiscountEditorPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: discount, isPending, error } = useDiscount(id)
  const updateDiscount = useUpdateDiscount(id!)
  const deleteDiscount = useDeleteDiscount()
  const setDiscountState = useSetDiscountState()

  if (isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-64" />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="space-y-4">
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    )
  }

  if (error || !discount) {
    return (
      <Alert variant="destructive">
        <AlertCircle />
        <AlertDescription>
          {error instanceof ApiError ? error.message : 'That discount could not be loaded.'}
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <Editor
      key={discount.id}
      kind={discount.kind}
      title={discount.code}
      backLabel="Back to discounts"
      submitLabel="Save changes"
      discount={discount}
      defaultValues={toFormValues(discount)}
      initialSelections={{
        productIds: discount.products.map((row) => row.id),
        categoryIds: discount.categories.map((row) => row.id),
        collectionIds: discount.collections.map((row) => row.id),
        customerIds: discount.customers.map((row) => row.id),
      }}
      known={discount}
      onSubmit={async (values) => {
        await updateDiscount.mutateAsync(values)
        toast.success('Discount saved')
      }}
      onToggleState={async () => {
        const action = discount.state === 'EXPIRED' ? 'ACTIVATE' : 'DEACTIVATE'
        try {
          const next = await setDiscountState.mutateAsync({ id: discount.id, action })
          toast.success(
            action === 'ACTIVATE'
              ? `${next.code} is live — the end date was cleared`
              : `${next.code} ended just now`,
          )
        } catch (stateError) {
          toast.error(
            stateError instanceof ApiError ? stateError.message : 'Could not change that',
          )
        }
      }}
      onDuplicate={() =>
        void navigate('/discounts/new', {
          state: {
            // A blank code: two discounts cannot share one, and picking a
            // near-miss for the operator is how the wrong code goes out.
            values: { ...toFormValues(discount), code: '' },
            selections: {
              productIds: discount.products.map((row) => row.id),
              categoryIds: discount.categories.map((row) => row.id),
              collectionIds: discount.collections.map((row) => row.id),
              customerIds: discount.customers.map((row) => row.id),
            },
            known: discount,
            kind: discount.kind,
          } satisfies DuplicateState,
        })
      }
      onDelete={async () => {
        try {
          await deleteDiscount.mutateAsync(discount.id)
          toast.success(`${discount.code} deleted`)
          void navigate('/discounts', { replace: true })
        } catch (deleteError) {
          toast.error(
            deleteError instanceof ApiError
              ? deleteError.message
              : 'That discount could not be deleted',
          )
        }
      }}
    />
  )
}
