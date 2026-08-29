import * as React from 'react'
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
import { GripVertical, Layers, Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useVariantOptions } from '@/features/variant-options/queries'
import type { VariantOption } from '@/types/api'
import { EmptyState } from '@/components/empty-state'
import { EntityPicker, PickerFooterLink } from '@/components/entity-picker'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

/** How many options a product may build variants from. Mirrors the API's cap. */
export const MAX_OPTIONS = 3

/** Which values to tick when an option is added and no variant exists to infer from. */
export type Selection = Record<string, string[]>

/**
 * Ticking every value by default is right until it isn't: Colour × Size at
 * twelve and thirteen values is 156 SKUs nobody asked for. So a small list
 * arrives ready to generate and a long one waits to be told — with "Select all"
 * one click away either way.
 */
const AUTO_TICK_LIMIT = 8

export function defaultValueIds(values: { id: string }[] | null | undefined): string[] {
  const list = values ?? []
  return list.length > 0 && list.length <= AUTO_TICK_LIMIT ? list.map((value) => value.id) : []
}

function SortableOptionRow({
  option,
  index,
  selected,
  invalid,
  removeBlockedReason,
  onToggleValue,
  onSelectAll,
  onRemove,
}: {
  option: VariantOption
  index: number
  selected: string[]
  /** Nothing ticked, and the operator has tried to submit. */
  invalid?: boolean
  /** Set when variants are already built on this option. Disables removal. */
  removeBlockedReason?: string
  onToggleValue: (valueId: string) => void
  onSelectAll: () => void
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: option.id,
  })

  const values = option.values ?? []
  const allSelected = values.length > 0 && values.every((value) => selected.includes(value.id))

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-start gap-3 border-b px-5 py-3 last:border-b-0',
        isDragging && 'bg-muted relative z-10 rounded-md shadow-sm',
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${option.name}`}
        className="text-muted-foreground hover:text-foreground mt-1 -ml-1 cursor-grab touch-none rounded p-1 transition-colors active:cursor-grabbing"
      >
        <GripVertical className="size-4" />
      </button>

      <div className="w-32 shrink-0">
        {/* The position is the whole point of the drag: it decides the SKU
            token order and the order the storefront's pickers appear in. */}
        <p className="text-muted-foreground text-[10px] uppercase">Option {index + 1}</p>
        <p className="truncate text-sm font-medium">{option.name}</p>
      </div>

      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap gap-1.5">
          {values.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              This option has no values yet — add some before generating.
            </p>
          ) : (
            values.map((value) => {
              const isSelected = selected.includes(value.id)
              return (
                <button
                  key={value.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => onToggleValue(value.id)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors',
                    isSelected
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'hover:bg-accent',
                  )}
                >
                  {value.swatchHex && (
                    <span
                      className="border-background/50 size-3 rounded-full border"
                      style={{ backgroundColor: value.swatchHex }}
                      aria-hidden
                    />
                  )}
                  {value.value}
                </button>
              )
            })
          )}
        </div>

        {values.length > 0 && (
          <div
            className={cn(
              'flex items-center gap-2 text-xs',
              invalid ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            <button
              type="button"
              onClick={onSelectAll}
              className="underline-offset-2 hover:underline"
            >
              {allSelected ? 'Clear all' : 'Select all'}
            </button>
            <span>·</span>
            <span>
              {invalid
                ? 'Tick at least one value'
                : `${selected.length} of ${values.length} ticked`}
            </span>
          </div>
        )}
      </div>

      {/*
        Disabled rather than hidden when variants exist. The server refuses the
        removal anyway — `product_variant_options` cannot be dropped from under
        a variant that carries its values — and finding that out at Save, three
        edits later, is a worse way to learn it than a greyed control saying so.
      */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 shrink-0"
        onClick={onRemove}
        disabled={Boolean(removeBlockedReason)}
        title={removeBlockedReason ?? `Remove ${option.name}`}
        aria-label={removeBlockedReason ?? `Remove ${option.name}`}
      >
        <X className="size-4" />
      </Button>
    </li>
  )
}

/**
 * The Variants card's top half: which options this product varies by, in what
 * order, and which of their values it actually stocks.
 *
 * Every catalogue option is added by default, because a shoe varies by colour
 * and size essentially always — but each row can be removed, because "always"
 * is not "without exception": a single-colourway sandal has no Colour
 * dimension, and a Width option added to the catalogue next year must not
 * become mandatory on products that do not have widths.
 *
 * What is enforced instead is narrower and holds in every case: an option that
 * *stays* must have at least one value ticked. Otherwise the product carries a
 * column its variants can never fill.
 *
 * Shared by the create screen and the editor. Options are plain ids, so they
 * can be chosen before the product exists and saved with it — which is what
 * spares the operator a second round trip before generating.
 */
export function VariantOptionsPicker({
  variantOptionIds,
  onOptionsChange,
  selection,
  onSelectionChange,
  description,
  emptyDescription = 'This product will sell as a single SKU. Add an option back if it varies by colour or size.',
  invalidOptionIds = [],
  removeBlockedReason,
  children,
}: {
  variantOptionIds: string[]
  onOptionsChange: (next: string[]) => void
  selection: Selection
  onSelectionChange: (next: Selection) => void
  description?: string
  emptyDescription?: string
  /** Options with nothing ticked, once a submit has been attempted. */
  invalidOptionIds?: string[]
  /** Why removal is unavailable right now — set once variants exist. */
  removeBlockedReason?: string
  /** Generate and the grid on the editor; nothing on the create screen. */
  children?: React.ReactNode
}) {
  const { data, isPending } = useVariantOptions({
    limit: 100,
    sort: 'position:asc',
    withValues: true,
  })
  const [picking, setPicking] = React.useState(false)

  const definitions = React.useMemo(
    () => new Map((data?.data ?? []).map((option) => [option.id, option])),
    [data],
  )

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = variantOptionIds.indexOf(String(active.id))
    const to = variantOptionIds.indexOf(String(over.id))
    if (from === -1 || to === -1) return
    onOptionsChange(arrayMove(variantOptionIds, from, to))
  }

  const available = (data?.data ?? [])
    .filter((option) => !variantOptionIds.includes(option.id))
    .map((option) => ({
      id: option.id,
      label: option.name,
      hint: `${option.valueCount} ${option.valueCount === 1 ? 'value' : 'values'}`,
    }))

  const addOption = (id: string) => {
    onOptionsChange([...variantOptionIds, id])
    const option = definitions.get(id)
    // Ticked on the way in rather than left to the operator: an option added
    // and then forgotten about generates nothing, and the failure is silent.
    if (option) onSelectionChange({ ...selection, [id]: defaultValueIds(option.values) })
  }

  return (
    <section className="bg-card rounded-lg border">
      <header className="flex items-start justify-between gap-3 border-b px-5 py-3">
        {/* min-w-0 + flex-1 lets the copy shrink. Without it a long description
            pushes the action onto its own line and it reads as a stray button. */}
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Variants</h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {description ??
              "Options decide what a variant is. Order matters — it drives the SKU and the storefront's pickers."}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => setPicking(true)}
          disabled={isPending || variantOptionIds.length >= MAX_OPTIONS}
          title={
            variantOptionIds.length >= MAX_OPTIONS
              ? `${MAX_OPTIONS} options is the most a variant grid stays usable at`
              : undefined
          }
        >
          <Plus className="size-4" />
          Add option
        </Button>
      </header>

      {isPending ? (
        <div className="space-y-3 p-5">
          {Array.from({ length: 2 }, (_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      ) : variantOptionIds.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No options on this product"
          description={emptyDescription}
          action={
            <Button type="button" size="sm" onClick={() => setPicking(true)}>
              <Plus className="size-4" />
              Add option
            </Button>
          }
          className="py-10"
        />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={variantOptionIds} strategy={verticalListSortingStrategy}>
            <ul>
              {variantOptionIds.map((optionId, index) => {
                const option = definitions.get(optionId)
                // An option deleted in another tab leaves a row pointing at
                // nothing. Say so rather than rendering an empty control.
                if (!option) {
                  return (
                    <li
                      key={optionId}
                      className="text-muted-foreground flex items-center justify-between gap-3 border-b px-5 py-3 text-sm last:border-b-0"
                    >
                      {/* Not a way to drop an option — the only row with a
                          control is one pointing at an option somebody deleted
                          from the catalogue in another tab. */}
                      <span>This option was deleted from the catalogue.</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          onOptionsChange(variantOptionIds.filter((id) => id !== optionId))
                        }
                      >
                        Clear row
                      </Button>
                    </li>
                  )
                }

                const selected = selection[optionId] ?? []
                const values = option.values ?? []

                return (
                  <SortableOptionRow
                    key={optionId}
                    option={option}
                    index={index}
                    selected={selected}
                    invalid={invalidOptionIds.includes(optionId)}
                    removeBlockedReason={removeBlockedReason}
                    onToggleValue={(valueId) =>
                      onSelectionChange({
                        ...selection,
                        [optionId]: selected.includes(valueId)
                          ? selected.filter((id) => id !== valueId)
                          : [...selected, valueId],
                      })
                    }
                    onSelectAll={() =>
                      onSelectionChange({
                        ...selection,
                        [optionId]:
                          selected.length === values.length ? [] : values.map((value) => value.id),
                      })
                    }
                    onRemove={() =>
                      onOptionsChange(variantOptionIds.filter((id) => id !== optionId))
                    }
                  />
                )
              })}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {children}

      <EntityPicker
        open={picking}
        onOpenChange={setPicking}
        title="Add variant option"
        description="What this product's variants differ by."
        searchPlaceholder="Search options"
        items={available}
        onPick={addOption}
        emptyTitle="Every option is already here"
        emptyDescription="Create a new one if this product varies by something the catalogue does not have yet."
        footer={<PickerFooterLink label="Create a new variant option" to="/variant-options" />}
      />
    </section>
  )
}
