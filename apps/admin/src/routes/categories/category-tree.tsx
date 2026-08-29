import * as React from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Archive,
  ChevronRight,
  CircleDot,
  CornerDownRight,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Category, CategoryMove, EntityStatus } from '@/types/api'
import {
  childrenOf,
  descendantIds,
  flatten,
  subtreeHeight,
  type FlatCategory,
} from '@/features/categories/tree'
import { StatusBadge } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/** Pixels of indent per level. Also the drag distance that changes a level. */
const INDENT = 28

// ─── where a drag would land ─────────────────────────────────────────────────

type Projection = { depth: number; parentId: string | null }

/**
 * A tree drag has two axes: vertical picks the slot, horizontal picks the
 * depth. Depth is clamped by the neighbours the row lands between — you can
 * only ever become a child of the row above, and never shallower than the row
 * below, because either would orphan something.
 */
function project(
  items: FlatCategory[],
  activeIndex: number,
  overIndex: number,
  offsetLeft: number,
  maxDepth: number,
): Projection {
  const reordered = arrayMoved(items, activeIndex, overIndex)
  const previous = reordered[overIndex - 1]
  const next = reordered[overIndex + 1]

  const dragged = items[activeIndex]
  const wanted = dragged.depth + Math.round(offsetLeft / INDENT)

  const deepest = previous ? previous.depth + 1 : 0
  const shallowest = next ? next.depth : 0
  // The whole branch travels with the row, so it is the deepest leaf under it
  // that has to fit inside the cap.
  const allowed = Math.min(deepest, maxDepth - 1 - subtreeHeight(dragged.category))

  const depth = Math.max(shallowest, Math.min(wanted, Math.max(allowed, 0)))

  const parentId = (() => {
    if (depth === 0 || !previous) return null
    if (depth === previous.depth) return previous.parentId
    if (depth > previous.depth) return previous.id
    // Landed shallower than the row above: the new parent is whichever row
    // further up is already sitting at this depth.
    return (
      reordered
        .slice(0, overIndex)
        .reverse()
        .find((item) => item.depth === depth)?.parentId ?? null
    )
  })()

  return { depth, parentId }
}

/** `arrayMove` from @dnd-kit/sortable, inlined to stay typed on FlatCategory. */
function arrayMoved(items: FlatCategory[], from: number, to: number): FlatCategory[] {
  const next = [...items]
  next.splice(to < 0 ? next.length + to : to, 0, next.splice(from, 1)[0])
  return next
}

// ─── one row ─────────────────────────────────────────────────────────────────

type RowHandlers = {
  onToggle: (id: string) => void
  onEdit: (category: Category) => void
  onAddChild: (category: Category) => void
  onSetStatus: (category: Category, status: EntityStatus) => void
  onDelete: (category: Category) => void
}

/** No-ops for the drag overlay, which is a picture of a row rather than one. */
const INERT: RowHandlers = {
  onToggle: () => {},
  onEdit: () => {},
  onAddChild: () => {},
  onSetStatus: () => {},
  onDelete: () => {},
}

type RowProps = RowHandlers & {
  item: FlatCategory
  /** Overridden while dragging, so the row shows the depth it would land at. */
  depth: number
  collapsed: boolean
  dragDisabled: boolean
  /** The handle's props, or nothing at all in the overlay. */
  handle?: React.HTMLAttributes<HTMLButtonElement>
}

/**
 * Presentation only. `useSortable` lives in the wrapper below rather than here,
 * because the drag overlay renders this same row outside the SortableContext,
 * where that hook has nothing to attach to.
 */
function Row({
  item,
  depth,
  collapsed,
  dragDisabled,
  handle,
  onToggle,
  onEdit,
  onAddChild,
  onSetStatus,
  onDelete,
}: RowProps) {
  const { category } = item

  // Always offer the status the category is not currently in.
  const nextStatus: EntityStatus = category.status === 'ACTIVE' ? 'DRAFT' : 'ACTIVE'

  return (
    <div
      className="hover:bg-muted/40 flex items-center gap-2 py-1.5 pr-2 transition-colors"
      style={{ paddingLeft: 8 + depth * INDENT }}
    >
      <button
        type="button"
        // The handle owns the drag, not the row: the chevron and the kebab stay
        // clickable, and a stray drag cannot start from a menu.
        {...handle}
        disabled={dragDisabled}
        aria-label={`Reorder ${category.name}`}
        className="text-muted-foreground hover:text-foreground cursor-grab touch-none rounded p-1 transition-colors active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-30"
      >
        <GripVertical className="size-4" />
      </button>

      {item.hasChildren ? (
        <button
          type="button"
          onClick={() => onToggle(category.id)}
          aria-label={collapsed ? `Expand ${category.name}` : `Collapse ${category.name}`}
          aria-expanded={!collapsed}
          className="text-muted-foreground hover:text-foreground rounded p-0.5 transition-colors"
        >
          <ChevronRight className={cn('size-4 transition-transform', !collapsed && 'rotate-90')} />
        </button>
      ) : (
        // A spacer, not nothing: without it every leaf shifts left and the
        // indent stops reading as a level.
        <span className="size-5 shrink-0" aria-hidden />
      )}

      <span className="min-w-0 flex-1 truncate text-sm font-medium">
        {category.name}
        <span className="text-muted-foreground ml-2 font-mono text-xs">{category.slug}</span>
      </span>

      <Badge variant="outline" className="hidden font-mono text-[10px] sm:inline-flex">
        L{depth}
      </Badge>

      <span
        className="text-muted-foreground w-16 text-right text-xs tabular-nums"
        // The tree shows the rolled-up number, so a branch never reads as empty
        // while holding hundreds of products further down.
        title={
          category.totalProductCount === category.productCount
            ? undefined
            : `${category.productCount} directly in this category`
        }
      >
        {category.totalProductCount}
      </span>

      <StatusBadge status={category.status} />

      <div data-row-action>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={`Actions for ${category.name}`}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onSelect={() => onEdit(category)}>
              <Pencil className="size-4" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAddChild(category)}>
              <CornerDownRight className="size-4" />
              Add subcategory
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onSetStatus(category, nextStatus)}>
              {nextStatus === 'ACTIVE' ? (
                <CircleDot className="size-4" />
              ) : (
                <Archive className="size-4" />
              )}
              Set to {nextStatus === 'ACTIVE' ? 'active' : 'draft'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => onDelete(category)}>
              <Trash2 className="size-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

/** The list row: everything above, wired to dnd-kit and given its own `<li>`. */
function SortableRow(props: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.item.id,
    disabled: props.dragDisabled,
  })

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'border-b last:border-b-0',
        // The row keeps its place in the list as a hole; the DragOverlay is
        // what follows the cursor, so the tree does not reflow under it.
        isDragging && 'opacity-40',
      )}
    >
      <Row
        {...props}
        handle={{ ...attributes, ...listeners } as React.HTMLAttributes<HTMLButtonElement>}
      />
    </li>
  )
}

// ─── the tree ────────────────────────────────────────────────────────────────

type CategoryTreeProps = {
  nodes: Category[]
  collapsed: ReadonlySet<string>
  onToggle: (id: string) => void
  /** True while a search is filtering: the rows on screen are not the tree. */
  dragDisabled?: boolean
  maxDepth: number
  onEdit: (category: Category) => void
  onAddChild: (category: Category) => void
  onSetStatus: (category: Category, status: EntityStatus) => void
  onDelete: (category: Category) => void
  /** Resolves when the server has settled the order; rejects to roll back. */
  onMove: (moves: CategoryMove[], movedId: string, parentId: string | null) => Promise<unknown>
}

export function CategoryTree({
  nodes,
  collapsed,
  onToggle,
  dragDisabled = false,
  maxDepth,
  onEdit,
  onAddChild,
  onSetStatus,
  onDelete,
  onMove,
}: CategoryTreeProps) {
  const [activeId, setActiveId] = React.useState<string | null>(null)
  const [overId, setOverId] = React.useState<string | null>(null)
  const [offsetLeft, setOffsetLeft] = React.useState(0)

  const visible = React.useMemo(() => flatten(nodes, collapsed), [nodes, collapsed])

  /**
   * A branch travels with the row that owns it, so its descendants leave the
   * sortable list for the duration — otherwise the drag would try to drop a
   * node between its own children.
   */
  const items = React.useMemo(() => {
    if (!activeId) return visible
    const active = visible.find((item) => item.id === activeId)
    if (!active) return visible
    const hidden = new Set(descendantIds(active.category))
    return visible.filter((item) => !hidden.has(item.id))
  }, [visible, activeId])

  const activeIndex = activeId ? items.findIndex((item) => item.id === activeId) : -1
  const overIndex = overId ? items.findIndex((item) => item.id === overId) : -1

  const projected =
    activeIndex !== -1 && overIndex !== -1
      ? project(items, activeIndex, overIndex, offsetLeft, maxDepth)
      : null

  const activeItem = activeIndex !== -1 ? items[activeIndex] : null

  const sensors = useSensors(
    // A few pixels of slop, or every click on the handle registers as a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  )

  const reset = () => {
    setActiveId(null)
    setOverId(null)
    setOffsetLeft(0)
  }

  const handleDragStart = ({ active }: DragStartEvent) => {
    setActiveId(String(active.id))
    setOverId(String(active.id))
  }

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    const projection = projected
    const dragged = activeItem
    reset()

    if (!projection || !dragged || !over) return

    const parentId = projection.parentId
    // Dropped on itself under the same parent: the sibling row is untouched and
    // it reinserts at the index it already had, so there is nothing to send.
    if (parentId === dragged.parentId && String(active.id) === String(over.id)) return

    // The sibling row comes from the tree, not from the visible rows: a drop
    // into a collapsed branch has siblings that are not on screen, and they
    // still have to keep their places.
    const siblings = childrenOf(nodes, parentId).filter((node) => node.id !== dragged.id)

    // Where among them the row landed — the nearest row above it that shares
    // its new parent, or the very start when there is none.
    const reordered = arrayMoved(items, activeIndex, overIndex)
    const above = reordered
      .slice(0, reordered.findIndex((item) => item.id === dragged.id))
      .reverse()
      .find((item) => (item.parentId ?? null) === parentId)
    const insertAt = above ? siblings.findIndex((node) => node.id === above.id) + 1 : 0

    const ordered = [
      ...siblings.slice(0, insertAt),
      dragged.category,
      ...siblings.slice(insertAt),
    ]

    // The whole sibling row is sent, not just the row that moved: positions
    // then arrive unambiguous and the server has nothing to guess at.
    void onMove(
      ordered.map((node, index) => ({ id: node.id, parentId, position: index })),
      dragged.id,
      parentId,
    )
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragMove={({ delta }: DragMoveEvent) => setOffsetLeft(delta.x)}
      onDragOver={({ over }: DragOverEvent) => setOverId(over ? String(over.id) : null)}
      onDragEnd={handleDragEnd}
      onDragCancel={reset}
    >
      <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
        <ul>
          {items.map((item) => (
            <SortableRow
              key={item.id}
              item={item}
              depth={item.id === activeId && projected ? projected.depth : item.depth}
              collapsed={collapsed.has(item.id)}
              dragDisabled={dragDisabled}
              onToggle={onToggle}
              onEdit={onEdit}
              onAddChild={onAddChild}
              onSetStatus={onSetStatus}
              onDelete={onDelete}
            />
          ))}
        </ul>
      </SortableContext>

      {/* The overlay is what follows the cursor. Without it the row is torn out
          of the list and every sibling reflows around a moving target. */}
      <DragOverlay>
        {activeItem ? (
          <div className="bg-card rounded-md border shadow-lg">
            <Row item={activeItem} depth={0} collapsed dragDisabled {...INERT} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
