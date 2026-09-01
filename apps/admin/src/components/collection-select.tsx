import * as React from 'react'
import { Layers, Plus, Search, X } from 'lucide-react'
import { useCollections } from '@/features/collections/queries'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import type { ProductCollectionRef } from '@/types/api'
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
 * Which manual collections a product is in, edited from the product's side.
 *
 * Manual only, and not as a filter that could be switched off: a dynamic
 * collection decides its membership by running its rules, so there is no row
 * here to tick or untick. Offering one would be a checkbox that does nothing.
 *
 * The chips are the answer to the question the panel asks — "what is this in?"
 * — and the dialog is where it changes, because the list is long enough that
 * searching is the normal way to use it rather than the fallback.
 */
export function CollectionSelect({
  value,
  onChange,
  /** The names the product was loaded with, so chips render before the list arrives. */
  known = [],
  label = 'Collections',
  max = 50,
  error,
}: {
  value: string[]
  onChange: (next: string[]) => void
  known?: ProductCollectionRef[]
  label?: string
  max?: number
  error?: string
}) {
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const q = useDebouncedValue(search.trim(), 300)
  /**
   * The dialog edits a copy. Ticking a box is a change the operator is still
   * considering — a dialog with a Save button that had already applied itself
   * would make Cancel a lie — so nothing leaves here until Save, and closing
   * any other way discards it.
   */
  const [draft, setDraft] = React.useState<string[]>(value)

  const { data, isPending, isFetching } = useCollections({
    type: 'MANUAL',
    limit: 100,
    sort: 'name:asc',
    ...(q ? { q } : {}),
  })

  // Opening starts from what is saved on the form: neither the last search nor
  // an abandoned set of ticks carries over.
  React.useEffect(() => {
    if (!open) return
    setSearch('')
    setDraft(value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  /**
   * Names come from two places and both are needed: the loaded product knows
   * what it is in, and the list knows everything it could be in. A collection
   * ticked in the dialog and then searched away would otherwise lose its chip.
   */
  const namesById = React.useMemo(() => {
    const names = new Map<string, string>()
    for (const collection of known) names.set(collection.id, collection.name)
    for (const collection of data?.data ?? []) names.set(collection.id, collection.name)
    return names
  }, [known, data])

  const selected = new Set(draft)
  const full = draft.length >= max

  const toggle = (id: string) => {
    setDraft((current) => {
      if (current.includes(id)) return current.filter((entry) => entry !== id)
      if (current.length >= max) return current
      return [...current, id]
    })
  }

  const apply = () => {
    onChange(draft)
    setOpen(false)
  }

  // The chips outside the dialog are the saved set, so removing one there is
  // the same edit as unticking it and pressing Save — it still waits for the
  // product's own Save button like every other field in this panel.
  const removeChip = (id: string) => onChange(value.filter((entry) => entry !== id))

  const rows = data?.data ?? []

  return (
    <div className="space-y-2">
      <Label>{label}</Label>

      {value.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((id) => (
            <Badge key={id} variant="secondary" className="gap-1 py-1 pr-1">
              {/* An id with no name is one loaded from a collection this list has
                  not seen — better a placeholder than a blank chip. */}
              <span className="truncate">{namesById.get(id) ?? 'Collection'}</span>
              <button
                type="button"
                aria-label={`Remove from ${namesById.get(id) ?? 'collection'}`}
                className="hover:bg-background/60 rounded-sm p-0.5"
                onClick={() => removeChip(id)}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">Not in any manual collection.</p>
      )}

      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        {value.length > 0 ? 'Edit collections' : 'Add to collection'}
      </Button>

      {error && <p className="text-destructive text-sm">{error}</p>}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[calc(100svh-8rem)] flex-col gap-0 p-0">
          <DialogHeader className="border-b py-4 pr-12 pl-6">
            <DialogTitle>Collections</DialogTitle>
            <DialogDescription>
              Manual collections only. A dynamic one picks its products by rules.
            </DialogDescription>
          </DialogHeader>

          <div className="border-b px-6 py-3">
            <div className="relative">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
              <Input
                autoFocus
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search collections"
                className="pl-8"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {isPending ? (
              <div className="text-muted-foreground flex items-center justify-center gap-2 py-10 text-sm">
                <Spinner />
                Loading collections
              </div>
            ) : rows.length === 0 ? (
              <div className="text-muted-foreground px-4 py-10 text-center text-sm">
                <Layers className="mx-auto mb-2 size-5" />
                {q
                  ? 'No manual collection matches that.'
                  : 'There are no manual collections yet. Create one from Collections.'}
              </div>
            ) : (
              <ul>
                {rows.map((collection) => {
                  const checked = selected.has(collection.id)
                  return (
                    <li key={collection.id}>
                      <label
                        className="hover:bg-accent flex cursor-pointer items-center gap-3 rounded-sm px-3 py-2 text-sm"
                        // A full list still lets you untick, or there would be no
                        // way back from hitting the limit.
                        aria-disabled={full && !checked}
                      >
                        <Checkbox
                          checked={checked}
                          disabled={full && !checked}
                          onCheckedChange={() => toggle(collection.id)}
                        />
                        <span className="min-w-0 flex-1 truncate">{collection.name}</span>
                        <span className="text-muted-foreground text-xs">
                          {collection.productCount}
                        </span>
                        {collection.status !== 'ACTIVE' && (
                          <Badge variant="muted">{collection.status.toLowerCase()}</Badge>
                        )}
                      </label>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <DialogFooter className="border-t px-6 py-3 sm:justify-between">
            <p className="text-muted-foreground text-xs">
              {isFetching && !isPending ? 'Searching…' : `${draft.length} selected`}
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="button" size="sm" onClick={apply}>
                Save
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
