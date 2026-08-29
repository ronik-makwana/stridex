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
import { GripVertical, ListChecks, Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAttributes } from '@/features/attributes/queries'
import { emptyEntry, type AttributeEntry } from '@/features/products/attributes'
import type { Attribute } from '@/types/api'
import { EmptyState } from '@/components/empty-state'
import { EntityPicker, PickerFooterLink } from '@/components/entity-picker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const NONE = '__none__'

/**
 * The control for one attribute, chosen by its type. This is the whole reason
 * the definition rides along on every row: a SELECT is a dropdown, a
 * MULTI_SELECT is a row of toggles, and a NUMBER needs its unit printed beside
 * the input or nobody knows whether 280 means grams or millimetres.
 */
function ValueControl({
  attribute,
  entry,
  onChange,
}: {
  attribute: Attribute
  entry: AttributeEntry
  onChange: (next: AttributeEntry) => void
}) {
  const values = attribute.values ?? []

  switch (attribute.type) {
    case 'SELECT':
      return (
        <Select
          value={entry.valueIds[0] ?? NONE}
          onValueChange={(value) =>
            onChange({ ...entry, valueIds: value === NONE ? [] : [value] })
          }
        >
          <SelectTrigger size="sm" className="w-full" aria-label={attribute.name}>
            <SelectValue placeholder="Choose a value" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>No value</SelectItem>
            {values.map((value) => (
              <SelectItem key={value.id} value={value.id}>
                {value.value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )

    case 'MULTI_SELECT':
      return (
        <div className="flex flex-wrap gap-1.5">
          {values.length === 0 && (
            <p className="text-muted-foreground text-xs">This attribute has no values yet.</p>
          )}
          {values.map((value) => {
            const selected = entry.valueIds.includes(value.id)
            return (
              <button
                key={value.id}
                type="button"
                aria-pressed={selected}
                onClick={() =>
                  onChange({
                    ...entry,
                    valueIds: selected
                      ? entry.valueIds.filter((id) => id !== value.id)
                      : [...entry.valueIds, value.id],
                  })
                }
                className={cn(
                  'rounded-full border px-2.5 py-1 text-xs transition-colors',
                  selected
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'hover:bg-accent',
                )}
              >
                {value.value}
              </button>
            )
          })}
        </div>
      )

    case 'BOOLEAN':
      return (
        <RadioGroup
          value={entry.boolean === null ? '' : entry.boolean ? 'yes' : 'no'}
          onValueChange={(value) => onChange({ ...entry, boolean: value === 'yes' })}
          className="flex items-center gap-4"
        >
          <div className="flex items-center gap-1.5">
            <RadioGroupItem value="yes" id={`${attribute.id}-yes`} />
            <Label htmlFor={`${attribute.id}-yes`} className="text-sm font-normal">
              Yes
            </Label>
          </div>
          <div className="flex items-center gap-1.5">
            <RadioGroupItem value="no" id={`${attribute.id}-no`} />
            <Label htmlFor={`${attribute.id}-no`} className="text-sm font-normal">
              No
            </Label>
          </div>
        </RadioGroup>
      )

    case 'NUMBER':
      return (
        <div className="flex items-center gap-2">
          <Input
            value={entry.number}
            onChange={(event) => onChange({ ...entry, number: event.target.value })}
            inputMode="decimal"
            placeholder="0"
            aria-label={attribute.name}
            className="h-8 max-w-32"
          />
          {attribute.unit && (
            <span className="text-muted-foreground text-sm">{attribute.unit}</span>
          )}
        </div>
      )

    case 'TEXT':
      return (
        <Input
          value={entry.text}
          onChange={(event) => onChange({ ...entry, text: event.target.value })}
          placeholder="Value"
          aria-label={attribute.name}
          className="h-8"
        />
      )
  }
}

function SortableAttributeRow({
  attribute,
  entry,
  onChange,
  onRemove,
}: {
  attribute: Attribute
  entry: AttributeEntry
  onChange: (next: AttributeEntry) => void
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: entry.attributeId,
  })

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
        aria-label={`Reorder ${attribute.name}`}
        className="text-muted-foreground hover:text-foreground mt-1.5 -ml-1 cursor-grab touch-none rounded p-1 transition-colors active:cursor-grabbing"
      >
        <GripVertical className="size-4" />
      </button>

      <div className="w-40 shrink-0 pt-1.5">
        <p className="truncate text-sm font-medium">{attribute.name}</p>
        {attribute.isFilterable && (
          <p className="text-muted-foreground text-[10px] uppercase">Filterable</p>
        )}
      </div>

      <div className="min-w-0 flex-1 pt-0.5">
        <ValueControl attribute={attribute} entry={entry} onChange={onChange} />
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 shrink-0"
        onClick={onRemove}
        aria-label={`Remove ${attribute.name}`}
      >
        <X className="size-4" />
      </Button>
    </li>
  )
}

/**
 * Attributes are picked per product, not inherited from a category — so this
 * block starts empty on a brand new product and the pre-fill matters. Anything
 * an operator flagged "suggested" is added the moment the editor opens on a new
 * product; everything else is one search away.
 */
export function ProductAttributesPanel({
  entries,
  onChange,
}: {
  entries: AttributeEntry[]
  onChange: (next: AttributeEntry[]) => void
}) {
  const { data, isPending } = useAttributes({
    limit: 100,
    sort: 'position:asc',
    withValues: true,
  })
  const [picking, setPicking] = React.useState(false)

  const definitions = React.useMemo(
    () => new Map((data?.data ?? []).map((attribute) => [attribute.id, attribute])),
    [data],
  )

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = entries.findIndex((entry) => entry.attributeId === active.id)
    const to = entries.findIndex((entry) => entry.attributeId === over.id)
    if (from === -1 || to === -1) return
    onChange(arrayMove(entries, from, to))
  }

  const available = (data?.data ?? [])
    .filter((attribute) => !entries.some((entry) => entry.attributeId === attribute.id))
    .map((attribute) => ({
      id: attribute.id,
      label: attribute.name,
      hint: attribute.type.replace('_', ' ').toLowerCase(),
    }))

  return (
    <section className="bg-card rounded-lg border">
      <header className="flex items-start justify-between gap-3 border-b px-5 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Attributes</h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            The spec table on the product page, and what the storefront filters on. Order is the
            order customers read them in.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => setPicking(true)}
          disabled={isPending}
        >
          <Plus className="size-4" />
          Add attribute
        </Button>
      </header>

      {isPending ? (
        <div className="space-y-3 p-5">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-8 w-full" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="No attributes on this product"
          description="Gender, Material, Sport — whatever a customer would filter or compare on."
          action={
            <Button size="sm" onClick={() => setPicking(true)}>
              <Plus className="size-4" />
              Add attribute
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
          <SortableContext
            items={entries.map((entry) => entry.attributeId)}
            strategy={verticalListSortingStrategy}
          >
            <ul>
              {entries.map((entry) => {
                const attribute = definitions.get(entry.attributeId)
                // An attribute deleted in another tab leaves a row pointing at
                // nothing. Say so rather than rendering a blank control.
                if (!attribute) {
                  return (
                    <li
                      key={entry.attributeId}
                      className="text-muted-foreground flex items-center justify-between gap-3 border-b px-5 py-3 text-sm last:border-b-0"
                    >
                      <span>This attribute no longer exists.</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          onChange(entries.filter((row) => row.attributeId !== entry.attributeId))
                        }
                      >
                        Remove row
                      </Button>
                    </li>
                  )
                }

                return (
                  <SortableAttributeRow
                    key={entry.attributeId}
                    attribute={attribute}
                    entry={entry}
                    onChange={(next) =>
                      onChange(
                        entries.map((row) => (row.attributeId === next.attributeId ? next : row)),
                      )
                    }
                    onRemove={() =>
                      onChange(entries.filter((row) => row.attributeId !== entry.attributeId))
                    }
                  />
                )
              })}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      <EntityPicker
        open={picking}
        onOpenChange={setPicking}
        title="Add attribute"
        description="Everything not already on this product."
        searchPlaceholder="Search attributes"
        items={available}
        onPick={(id) => onChange([...entries, emptyEntry(id)])}
        emptyTitle="Every attribute is already here"
        emptyDescription="Create a new one if this product needs something the catalogue does not have yet."
        footer={
          <PickerFooterLink label="Create a new attribute" to="/attributes" />
        }
      />
    </section>
  )
}
