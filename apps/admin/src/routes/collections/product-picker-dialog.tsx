import * as React from 'react'
import { Search } from 'lucide-react'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useProducts } from '@/features/products/queries'
import { StatusBadge } from '@/components/status-badge'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'

/**
 * Multi-select, because adding one product at a time to a twenty-product
 * collection is twenty dialogs. Products already in the collection are shown
 * ticked and disabled rather than hidden — "why isn't it in the list" is a
 * worse question than "oh, it's already in".
 */
export function ProductPickerDialog({
  open,
  onOpenChange,
  existingIds,
  onAdd,
  isAdding,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  existingIds: string[]
  onAdd: (productIds: string[]) => Promise<unknown>
  isAdding?: boolean
}) {
  const [query, setQuery] = React.useState('')
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const debounced = useDebouncedValue(query, 300)

  const { data, isPending } = useProducts({
    limit: 25,
    sort: 'title:asc',
    ...(debounced.trim() ? { q: debounced.trim() } : {}),
  })

  React.useEffect(() => {
    if (!open) return
    setQuery('')
    setSelected(new Set())
  }, [open])

  const already = React.useMemo(() => new Set(existingIds), [existingIds])

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const submit = async () => {
    if (selected.size === 0) return
    await onAdd([...selected])
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !isAdding && onOpenChange(next)}>
      <DialogContent className="flex max-h-[calc(100svh-8rem)] max-w-xl flex-col gap-0 p-0">
        <DialogHeader className="border-b py-4 pr-12 pl-6">
          <DialogTitle>Add products</DialogTitle>
          <DialogDescription>
            They land at the end of the list. Drag to reorder afterwards.
          </DialogDescription>
        </DialogHeader>

        <div className="border-b px-6 py-3">
          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search title or SKU"
              aria-label="Search products"
              className="h-9 pl-8"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {isPending ? (
            <div className="space-y-2 p-6">
              {Array.from({ length: 5 }, (_, index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          ) : (data?.data ?? []).length === 0 ? (
            <p className="text-muted-foreground px-6 py-10 text-center text-sm">
              No products match that search.
            </p>
          ) : (
            <ul className="py-1">
              {(data?.data ?? []).map((product) => {
                const inCollection = already.has(product.id)
                return (
                  <li key={product.id}>
                    <label
                      className={cnLabel(inCollection)}
                      aria-disabled={inCollection || undefined}
                    >
                      <Checkbox
                        checked={inCollection || selected.has(product.id)}
                        disabled={inCollection}
                        onCheckedChange={() => toggle(product.id)}
                      />
                      {product.coverUrl ? (
                        <img
                          src={product.coverUrl}
                          alt=""
                          loading="lazy"
                          className="bg-muted size-9 shrink-0 rounded border object-cover"
                        />
                      ) : (
                        <span className="bg-muted size-9 shrink-0 rounded border" aria-hidden />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{product.title}</span>
                        <span className="text-muted-foreground block truncate text-xs">
                          {product.brand?.name ?? 'No brand'} · {product.categoryPath ?? 'No category'}
                        </span>
                      </span>
                      {inCollection ? (
                        <span className="text-muted-foreground shrink-0 text-xs">Already in</span>
                      ) : (
                        <StatusBadge status={product.status} />
                      )}
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <DialogFooter className="border-t px-6 py-4">
          <span className="text-muted-foreground mr-auto text-sm">
            {selected.size} selected
          </span>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isAdding}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={selected.size === 0 || isAdding}>
            {isAdding && <Spinner />}
            Add {selected.size > 0 ? selected.size : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const cnLabel = (disabled: boolean) =>
  [
    'flex w-full items-center gap-3 px-6 py-2 transition-colors',
    disabled ? 'opacity-55' : 'hover:bg-accent cursor-pointer',
  ].join(' ')
