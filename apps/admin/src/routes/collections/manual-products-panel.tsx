import * as React from 'react'
import { Link } from 'react-router'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Package, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { useCollectionProducts } from '@/features/collections/queries'
import {
  useAddCollectionProducts,
  useRemoveCollectionProduct,
  useReorderCollectionProducts,
} from '@/features/collections/mutations'
import type { Product } from '@/types/api'
import { EmptyState } from '@/components/empty-state'
import { StatusBadge } from '@/components/status-badge'
import { DataTablePagination } from '@/components/data-table/data-table-pagination'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ProductPickerDialog } from './product-picker-dialog'

function SortableProductRow({
  product,
  position,
  disabled,
  onRemove,
}: {
  product: Product
  position: number
  disabled: boolean
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: product.id,
    disabled,
  })

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-3 border-b px-5 py-2.5 last:border-b-0',
        isDragging && 'bg-muted relative z-10 rounded-md shadow-sm',
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        disabled={disabled}
        aria-label={`Reorder ${product.title}`}
        className="text-muted-foreground hover:text-foreground -ml-1 cursor-grab touch-none rounded p-1 transition-colors active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
      >
        <GripVertical className="size-4" />
      </button>

      {/* The order is the merchandising, so the number is shown rather than
          left to be counted off the screen. */}
      <span className="text-muted-foreground w-6 shrink-0 text-right text-xs tabular-nums">
        {position}
      </span>

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

      <div className="min-w-0 flex-1">
        <Link
          to={`/products/${product.id}`}
          className="block truncate text-sm font-medium underline-offset-2 hover:underline"
        >
          {product.title}
        </Link>
        <p className="text-muted-foreground truncate text-xs">
          {product.brand?.name ?? 'No brand'} · {product.categoryPath ?? 'No category'}
        </p>
      </div>

      <StatusBadge status={product.status} />

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 shrink-0"
        onClick={onRemove}
        aria-label={`Remove ${product.title} from this collection`}
      >
        <X className="size-4" />
      </Button>
    </li>
  )
}

/**
 * A manual collection is an ordered list somebody curated, so the order is the
 * product — position 1 is what the storefront leads with. Everything here saves
 * immediately: pinning a product is not a draft state, and a Save button on top
 * of a drag would be one confirmation too many.
 */
export function ManualProductsPanel({ collectionId }: { collectionId: string }) {
  const [page, setPage] = React.useState(1)
  const { data, isPending } = useCollectionProducts(collectionId, page)

  const addProducts = useAddCollectionProducts(collectionId)
  const removeProduct = useRemoveCollectionProduct(collectionId)
  const reorder = useReorderCollectionProducts(collectionId)

  const [picking, setPicking] = React.useState(false)
  const [items, setItems] = React.useState<Product[]>([])
  const [reordering, setReordering] = React.useState(false)

  // The server is the authority on order; local state only holds the optimistic
  // gap between a drop and the refetch that confirms it.
  React.useEffect(() => {
    setItems(data?.data ?? [])
  }, [data])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const paged = (data?.meta?.totalPages ?? 1) > 1

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const from = items.findIndex((item) => item.id === active.id)
    const to = items.findIndex((item) => item.id === over.id)
    if (from === -1 || to === -1) return

    const previous = items
    const next = arrayMove(items, from, to)
    setItems(next)
    setReordering(true)

    try {
      // The endpoint rewrites every position, so it needs the whole list — which
      // is why dragging is disabled once the list is paged.
      await reorder.mutateAsync(next.map((item) => item.id))
    } catch (error) {
      setItems(previous)
      toast.error(error instanceof ApiError ? error.message : 'Could not save the new order')
    } finally {
      setReordering(false)
    }
  }

  return (
    <section className="bg-card rounded-lg border">
      <header className="flex items-start justify-between gap-3 border-b px-5 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Products</h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Curated by hand, in this order. Position 1 is what the storefront leads with.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => setPicking(true)}
        >
          <Plus className="size-4" />
          Add products
        </Button>
      </header>

      {isPending ? (
        <div className="space-y-3 p-5">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Package}
          title="Nothing in this collection yet"
          description="Pick the products it should hold. You can reorder them once they are in."
          action={
            <Button type="button" size="sm" onClick={() => setPicking(true)}>
              <Plus className="size-4" />
              Add products
            </Button>
          }
          className="py-10"
        />
      ) : (
        <>
          {paged && (
            // Reordering rewrites every position from one array, so it can only
            // be trusted when the whole list is on screen. Saying so beats a
            // drag that silently renumbers page 2.
            <p className="text-muted-foreground border-b px-5 py-2 text-xs">
              Dragging is off while this list is paged — the order is written from the full list.
            </p>
          )}

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={items.map((item) => item.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul>
                {items.map((product, index) => (
                  <SortableProductRow
                    key={product.id}
                    product={product}
                    position={(page - 1) * 25 + index + 1}
                    disabled={reordering || paged}
                    onRemove={() => void removeProduct.mutateAsync(product.id)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        </>
      )}

      {data?.meta && data.meta.totalPages > 1 && (
        <div className="border-t px-5 py-3">
          <DataTablePagination meta={data.meta} onPageChange={setPage} />
        </div>
      )}

      <ProductPickerDialog
        open={picking}
        onOpenChange={setPicking}
        existingIds={items.map((item) => item.id)}
        isAdding={addProducts.isPending}
        onAdd={(productIds) => addProducts.mutateAsync(productIds)}
      />
    </section>
  )
}
