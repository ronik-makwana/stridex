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
import { AlertCircle, Check, GripVertical, MoreHorizontal, Pencil, Plus, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api-client'
import { slugify } from '@/lib/slug'
import { cn } from '@/lib/utils'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/empty-state'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'

/** One row, flattened out of whichever entity owns it. */
export type ValueRow = {
  id: string
  value: string
  slug: string
  /** Only read when the panel is in swatch mode. */
  swatchHex?: string | null
  /** Products for an attribute value, variants for an option value. */
  usageCount: number
}

export type ValueDraft = { value: string; slug: string; swatchHex: string | null }

type ValuesPanelProps = {
  values: ValueRow[]
  isLoading?: boolean
  /** Colour picker per row. Variant options use it; attributes do not. */
  withSwatch?: boolean
  /** e.g. `(n) => n === 1 ? '1 product' : `${n} products`` */
  usageLabel: (count: number) => string
  title?: string
  hint?: string
  emptyTitle?: string
  emptyDescription?: string
  /** Each returns a promise so the row can show a spinner and keep server errors inline. */
  onCreate: (draft: ValueDraft) => Promise<unknown>
  onUpdate: (id: string, draft: ValueDraft) => Promise<unknown>
  onDelete: (id: string) => Promise<unknown>
  onReorder: (ids: string[]) => Promise<unknown>
}

const DEFAULT_SWATCH = '#000000'

/** Server field errors, keyed the way both value endpoints name their columns. */
type FieldErrors = { value?: string; slug?: string; swatchHex?: string; form?: string }

function toFieldErrors(error: unknown): FieldErrors {
  if (error instanceof ApiError && error.isFieldError) {
    const fields = error.fields!
    const known: FieldErrors = {}
    for (const [key, message] of Object.entries(fields)) {
      if (key === 'value' || key === 'slug' || key === 'swatchHex') known[key] = message
      else known.form = message
    }
    return Object.keys(known).length ? known : { form: error.message }
  }
  return { form: error instanceof ApiError ? error.message : 'Something went wrong. Try again.' }
}

// ─── the add / edit row ──────────────────────────────────────────────────────

function ValueForm({
  initial,
  withSwatch,
  submitLabel,
  onSubmit,
  onCancel,
  /** Add mode clears and stays open; edit mode closes. */
  keepOpenOnSuccess = false,
}: {
  initial?: ValueRow
  withSwatch: boolean
  submitLabel: string
  onSubmit: (draft: ValueDraft) => Promise<unknown>
  onCancel: () => void
  keepOpenOnSuccess?: boolean
}) {
  const [value, setValue] = React.useState(initial?.value ?? '')
  const [slug, setSlug] = React.useState(initial?.slug ?? '')
  const [swatchHex, setSwatchHex] = React.useState(initial?.swatchHex ?? null)
  // An existing row's slug is a URL somebody may have shared, so it stops
  // following the value. A new one follows until it is typed into.
  const [slugTouched, setSlugTouched] = React.useState(Boolean(initial))
  const [errors, setErrors] = React.useState<FieldErrors>({})
  const [pending, setPending] = React.useState(false)

  const effectiveSlug = slugTouched ? slug : slugify(value)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (pending) return

    if (!value.trim()) {
      setErrors({ value: 'Value is required' })
      return
    }
    if (!effectiveSlug) {
      setErrors({ slug: 'Enter a slug — the value has no letters or digits to derive one from' })
      return
    }

    setErrors({})
    setPending(true)
    try {
      await onSubmit({ value: value.trim(), slug: effectiveSlug, swatchHex })
      if (!keepOpenOnSuccess) {
        onCancel()
        return
      }
      // Cleared rather than closed: five values in a row is the normal case,
      // and reopening the form between each one is five extra clicks.
      setValue('')
      setSlug('')
      setSlugTouched(false)
      setSwatchHex(null)
    } catch (error) {
      setErrors(toFieldErrors(error))
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="bg-muted/30 space-y-2 px-3 py-2.5">
      <div className="flex flex-wrap items-start gap-2">
        {withSwatch && (
          <div className="flex items-center gap-1.5">
            <input
              type="color"
              // A null swatch has no colour to show, so the picker opens on
              // black while the row still reads as "no swatch" until touched.
              value={swatchHex ?? DEFAULT_SWATCH}
              onChange={(event) => setSwatchHex(event.target.value.toUpperCase())}
              aria-label="Swatch colour"
              className="border-input size-9 shrink-0 cursor-pointer rounded-md border bg-transparent p-1"
            />
            <Input
              value={swatchHex ?? ''}
              onChange={(event) => setSwatchHex(event.target.value.toUpperCase() || null)}
              placeholder="#000000"
              aria-label="Swatch hex"
              aria-invalid={Boolean(errors.swatchHex)}
              spellCheck={false}
              className="w-28 font-mono text-xs"
            />
          </div>
        )}

        <Input
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Value"
          aria-label="Value"
          aria-invalid={Boolean(errors.value)}
          className="min-w-40 flex-1"
        />

        <Input
          value={effectiveSlug}
          onChange={(event) => {
            setSlugTouched(true)
            setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-'))
          }}
          onBlur={(event) => slugTouched && setSlug(slugify(event.target.value))}
          placeholder="slug"
          aria-label="Slug"
          aria-invalid={Boolean(errors.slug)}
          spellCheck={false}
          className="w-40 font-mono text-xs"
        />

        <div className="flex items-center gap-1">
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? <Spinner /> : <Check className="size-4" />}
            {submitLabel}
          </Button>
          <Button type="button" size="icon" variant="ghost" className="size-8" onClick={onCancel}>
            <X className="size-4" />
            <span className="sr-only">Cancel</span>
          </Button>
        </div>
      </div>

      {(errors.value || errors.slug || errors.swatchHex) && (
        <p className="text-destructive text-xs">
          {errors.value ?? errors.slug ?? errors.swatchHex}
        </p>
      )}
      {errors.form && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{errors.form}</AlertDescription>
        </Alert>
      )}
    </form>
  )
}

// ─── one sortable row ────────────────────────────────────────────────────────

function SortableValueRow({
  row,
  withSwatch,
  usageLabel,
  disabled,
  onEdit,
  onDelete,
}: {
  row: ValueRow
  withSwatch: boolean
  usageLabel: (count: number) => string
  disabled: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.id,
    disabled,
  })

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-3 border-b px-3 py-2 last:border-b-0',
        isDragging && 'bg-muted relative z-10 rounded-md shadow-sm',
      )}
    >
      <button
        type="button"
        // The handle owns the drag, not the row: the kebab and the row text
        // stay clickable, and a stray drag cannot start from a menu.
        {...attributes}
        {...listeners}
        disabled={disabled}
        aria-label={`Reorder ${row.value}`}
        className="text-muted-foreground hover:text-foreground -ml-1 cursor-grab touch-none rounded p-1 transition-colors active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
      >
        <GripVertical className="size-4" />
      </button>

      {withSwatch &&
        (row.swatchHex ? (
          <span
            className="border-border size-5 shrink-0 rounded-full border shadow-xs"
            style={{ backgroundColor: row.swatchHex }}
            aria-hidden
          />
        ) : (
          // A placeholder rather than nothing: without it the rows below a
          // swatchless value shift left and the column stops being a column.
          <span
            className="border-border/60 size-5 shrink-0 rounded-full border border-dashed"
            aria-hidden
          />
        ))}

      <span className="min-w-0 flex-1 truncate text-sm font-medium">{row.value}</span>

      <span className="text-muted-foreground hidden w-40 truncate font-mono text-xs sm:block">
        {row.slug}
      </span>

      {withSwatch && (
        <span className="text-muted-foreground hidden w-20 font-mono text-xs md:block">
          {row.swatchHex ?? '—'}
        </span>
      )}

      <span className="text-muted-foreground w-32 text-right text-xs">
        {usageLabel(row.usageCount)}
      </span>

      <div data-row-action>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={`Actions for ${row.value}`}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil className="size-4" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2 className="size-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  )
}

// ─── the panel ───────────────────────────────────────────────────────────────

/**
 * The nested value list shared by attributes and variant options. The two
 * differ only in labels, whether rows carry a swatch, and what the usage count
 * counts — everything else here is the same screen twice, so it is written
 * once.
 *
 * Reordering is optimistic: the list settles where it was dropped and the
 * request follows. A failure snaps it back and says so, which is far less
 * jarring than a row that hangs mid-air until the server answers.
 */
export function ValuesPanel({
  values,
  isLoading = false,
  withSwatch = false,
  usageLabel,
  title = 'Values',
  hint,
  emptyTitle = 'No values yet',
  emptyDescription = 'Add the first one below.',
  onCreate,
  onUpdate,
  onDelete,
  onReorder,
}: ValuesPanelProps) {
  const [items, setItems] = React.useState(values)
  const [adding, setAdding] = React.useState(false)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [deleting, setDeleting] = React.useState<ValueRow | null>(null)
  const [deleteBlock, setDeleteBlock] = React.useState<string | null>(null)
  const [reordering, setReordering] = React.useState(false)

  // The server is the authority on order; local state only holds the optimistic
  // gap between a drop and the refetch that confirms it.
  React.useEffect(() => {
    setItems(values)
  }, [values])

  const sensors = useSensors(
    // A few pixels of slop, or every click on the handle registers as a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

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
      await onReorder(next.map((item) => item.id))
    } catch (error) {
      setItems(previous)
      toast.error(
        error instanceof ApiError ? error.message : 'Could not save the new order',
      )
    } finally {
      setReordering(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    try {
      await onDelete(deleting.id)
      toast.success(`${deleting.value} deleted`)
      setDeleting(null)
    } catch (error) {
      // 422 is the designed outcome, not a failure: products or variants still
      // point at this value. Keep the dialog open as the explanation.
      if (error instanceof ApiError && error.status === 422) {
        setDeleteBlock(error.reason ?? error.message)
        return
      }
      toast.error(error instanceof ApiError ? error.message : 'Could not delete this value')
      setDeleting(null)
    }
  }

  const startAdd = () => {
    setEditingId(null)
    setAdding(true)
  }

  return (
    <section className="bg-card rounded-lg border">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {hint && <p className="text-muted-foreground mt-0.5 text-xs">{hint}</p>}
        </div>
        <Button variant="outline" size="sm" onClick={startAdd} disabled={adding}>
          <Plus className="size-4" />
          Add value
        </Button>
      </header>

      {isLoading ? (
        <div className="space-y-3 p-4">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-8 w-full" />
          ))}
        </div>
      ) : items.length === 0 && !adding ? (
        <EmptyState
          title={emptyTitle}
          description={emptyDescription}
          action={
            <Button size="sm" onClick={startAdd}>
              <Plus className="size-4" />
              Add value
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
            items={items.map((item) => item.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul>
              {items.map((row) =>
                editingId === row.id ? (
                  <li key={row.id} className="border-b last:border-b-0">
                    <ValueForm
                      initial={row}
                      withSwatch={withSwatch}
                      submitLabel="Save"
                      onSubmit={(draft) => onUpdate(row.id, draft)}
                      onCancel={() => setEditingId(null)}
                    />
                  </li>
                ) : (
                  <SortableValueRow
                    key={row.id}
                    row={row}
                    withSwatch={withSwatch}
                    usageLabel={usageLabel}
                    // Dragging during a save would queue a second order the
                    // first request has not seen yet.
                    disabled={reordering || adding || editingId !== null}
                    onEdit={() => {
                      setAdding(false)
                      setEditingId(row.id)
                    }}
                    onDelete={() => {
                      setDeleteBlock(null)
                      setDeleting(row)
                    }}
                  />
                ),
              )}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {adding && (
        <div className="border-t">
          <ValueForm
            withSwatch={withSwatch}
            submitLabel="Add"
            keepOpenOnSuccess
            onSubmit={onCreate}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={deleteBlock ? `Cannot delete ${deleting?.value}` : `Delete ${deleting?.value}?`}
        description={deleteBlock ?? 'This cannot be undone.'}
        cancelLabel={deleteBlock ? 'Close' : 'Cancel'}
        confirmLabel={deleteBlock ? undefined : 'Delete'}
        variant="destructive"
        onConfirm={confirmDelete}
      />
    </section>
  )
}
