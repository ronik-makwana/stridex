import * as React from 'react'
import { Plus, Search, X } from 'lucide-react'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useProducts } from '@/features/products/queries'
import { useCategories } from '@/features/categories/queries'
import { useCollections } from '@/features/collections/queries'
import { useCustomers } from '@/features/customers/queries'
import type { DiscountRef } from '@/types/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'

/**
 * "Which products / categories / collections / customers does this apply to?"
 * — the same question four times, so one control answers it four times.
 *
 * The dialog edits a **copy**. Ticking a box is a change the operator is still
 * considering, and a dialog with a Save button that had already applied itself
 * would make Cancel a lie. Nothing leaves here until Save; closing any other
 * way discards it.
 *
 * The chips outside are the saved set, so removing one there is the same edit
 * as unticking it and saving — and both still wait for the discount's own Save
 * button, like every other field on the form.
 */

type Option = { id: string; name: string; hint?: string }

function PickerField({
  label,
  emptyText,
  addLabel,
  editLabel,
  dialogTitle,
  dialogDescription,
  searchPlaceholder,
  options,
  isLoading,
  search,
  onSearch,
  value,
  onChange,
  /** Names for ids the current search cannot see, so a chip never goes blank. */
  known,
  error,
  max = 200,
}: {
  label: string
  emptyText: string
  addLabel: string
  editLabel: string
  dialogTitle: string
  dialogDescription: string
  searchPlaceholder: string
  options: Option[]
  isLoading: boolean
  search: string
  onSearch: (value: string) => void
  value: string[]
  onChange: (next: string[]) => void
  known: DiscountRef[]
  error?: string
  max?: number
}) {
  const [open, setOpen] = React.useState(false)
  const [draft, setDraft] = React.useState<string[]>(value)

  React.useEffect(() => {
    if (!open) return
    onSearch('')
    setDraft(value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  /**
   * Two sources, both needed: what the discount was loaded with, and what the
   * list can currently see. A row ticked and then searched away would otherwise
   * lose its name.
   */
  const namesById = React.useMemo(() => {
    const names = new Map<string, string>()
    for (const ref of known) names.set(ref.id, ref.name)
    for (const option of options) names.set(option.id, option.name)
    return names
  }, [known, options])

  const selected = new Set(draft)
  const full = draft.length >= max

  const toggle = (id: string) =>
    setDraft((current) => {
      if (current.includes(id)) return current.filter((entry) => entry !== id)
      if (current.length >= max) return current
      return [...current, id]
    })

  return (
    <div className="space-y-2">
      <Label>{label}</Label>

      {value.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((id) => (
            <Badge key={id} variant="secondary" className="gap-1 py-1 pr-1">
              <span className="max-w-[16rem] truncate">{namesById.get(id) ?? 'Selected'}</span>
              <button
                type="button"
                aria-label={`Remove ${namesById.get(id) ?? 'selection'}`}
                className="hover:bg-background/60 rounded-sm p-0.5"
                onClick={() => onChange(value.filter((entry) => entry !== id))}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">{emptyText}</p>
      )}

      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        {value.length > 0 ? editLabel : addLabel}
      </Button>

      {error && <p className="text-destructive text-sm">{error}</p>}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[calc(100svh-8rem)] flex-col gap-0 p-0">
          <DialogHeader className="border-b py-4 pr-12 pl-6">
            <DialogTitle>{dialogTitle}</DialogTitle>
            <DialogDescription>{dialogDescription}</DialogDescription>
          </DialogHeader>

          <div className="border-b px-6 py-3">
            <div className="relative">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
              <Input
                autoFocus
                value={search}
                onChange={(event) => onSearch(event.target.value)}
                placeholder={searchPlaceholder}
                className="pl-8"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {isLoading ? (
              <div className="text-muted-foreground flex items-center justify-center gap-2 py-10 text-sm">
                <Spinner />
                Loading
              </div>
            ) : options.length === 0 ? (
              <p className="text-muted-foreground px-4 py-10 text-center text-sm">
                Nothing matches that.
              </p>
            ) : (
              <ul>
                {options.map((option) => {
                  const checked = selected.has(option.id)
                  return (
                    <li key={option.id}>
                      <label
                        className="hover:bg-accent flex cursor-pointer items-center gap-3 rounded-sm px-3 py-2 text-sm"
                        // A full list still lets you untick, or there would be
                        // no way back from hitting the limit.
                        aria-disabled={full && !checked}
                      >
                        <Checkbox
                          checked={checked}
                          disabled={full && !checked}
                          onCheckedChange={() => toggle(option.id)}
                        />
                        <span className="min-w-0 flex-1 truncate">{option.name}</span>
                        {option.hint && (
                          <span className="text-muted-foreground shrink-0 text-xs">
                            {option.hint}
                          </span>
                        )}
                      </label>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <DialogFooter className="border-t px-6 py-4">
            <span className="text-muted-foreground mr-auto text-xs">
              {draft.length} selected
            </span>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                onChange(draft)
                setOpen(false)
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/**
 * One wrapper per resource rather than a hook passed in as a prop: each of
 * these calls exactly one query hook, unconditionally, which is the only shape
 * the rules of hooks actually allow.
 */

export function ProductPicker(props: {
  value: string[]
  onChange: (next: string[]) => void
  known: DiscountRef[]
  error?: string
}) {
  const [search, setSearch] = React.useState('')
  const q = useDebouncedValue(search.trim(), 300)
  const { data, isPending } = useProducts({ limit: 50, sort: 'title:asc', ...(q ? { q } : {}) })

  return (
    <PickerField
      {...props}
      label="Products"
      emptyText="No products chosen yet."
      addLabel="Select products"
      editLabel="Edit products"
      dialogTitle="Products"
      dialogDescription="The discount applies to the lines that match these products."
      searchPlaceholder="Search products"
      search={search}
      onSearch={setSearch}
      isLoading={isPending}
      options={(data?.data ?? []).map((product) => ({
        id: product.id,
        name: product.title,
        hint: product.status !== 'ACTIVE' ? product.status.toLowerCase() : undefined,
      }))}
    />
  )
}

export function CategoryPicker(props: {
  value: string[]
  onChange: (next: string[]) => void
  known: DiscountRef[]
  error?: string
}) {
  const [search, setSearch] = React.useState('')
  const q = useDebouncedValue(search.trim(), 300)
  const { data, isPending } = useCategories({ limit: 100, sort: 'name:asc', ...(q ? { q } : {}) })

  return (
    <PickerField
      {...props}
      label="Categories"
      emptyText="No categories chosen yet."
      addLabel="Select categories"
      editLabel="Edit categories"
      dialogTitle="Categories"
      dialogDescription="Every product in these categories is covered."
      searchPlaceholder="Search categories"
      search={search}
      onSearch={setSearch}
      isLoading={isPending}
      options={(data?.data ?? []).map((category) => {
        // Immediate parent only, matching what a saved discount sends back.
        const parent = category.ancestors.at(-1)
        return {
          id: category.id,
          name: parent ? `${parent.name} > ${category.name}` : category.name,
        }
      })}
    />
  )
}

export function CollectionPicker(props: {
  value: string[]
  onChange: (next: string[]) => void
  known: DiscountRef[]
  error?: string
}) {
  const [search, setSearch] = React.useState('')
  const q = useDebouncedValue(search.trim(), 300)
  const { data, isPending } = useCollections({ limit: 100, sort: 'name:asc', ...(q ? { q } : {}) })

  return (
    <PickerField
      {...props}
      label="Collections"
      emptyText="No collections chosen yet."
      addLabel="Select collections"
      editLabel="Edit collections"
      dialogTitle="Collections"
      dialogDescription="Manual and dynamic both work — a dynamic collection is read when the discount is applied."
      searchPlaceholder="Search collections"
      search={search}
      onSearch={setSearch}
      isLoading={isPending}
      options={(data?.data ?? []).map((collection) => ({
        id: collection.id,
        name: collection.name,
        hint: collection.type === 'DYNAMIC' ? 'dynamic' : undefined,
      }))}
    />
  )
}

export function CustomerPicker(props: {
  value: string[]
  onChange: (next: string[]) => void
  known: DiscountRef[]
  error?: string
}) {
  const [search, setSearch] = React.useState('')
  const q = useDebouncedValue(search.trim(), 300)
  const { data, isPending } = useCustomers({ limit: 50, sort: 'created_at:desc', ...(q ? { q } : {}) })

  return (
    <PickerField
      {...props}
      label="Customers"
      emptyText="No customers chosen yet."
      addLabel="Select customers"
      editLabel="Edit customers"
      dialogTitle="Customers"
      dialogDescription="Only these accounts can use the code."
      searchPlaceholder="Search by name or email"
      search={search}
      onSearch={setSearch}
      isLoading={isPending}
      options={(data?.data ?? []).map((customer) => ({
        id: customer.id,
        name: customer.name ?? customer.email,
        hint: customer.name ? customer.email : undefined,
      }))}
    />
  )
}
