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
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, ImagePlus, MoreHorizontal, Star, Tag, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { ACCEPTED_MEDIA_TYPES, MAX_MEDIA_BYTES } from '@/features/products/api'
import {
  useDeleteMedia,
  useReorderMedia,
  useUpdateMedia,
  useUploadMedia,
} from '@/features/products/mutations'
import type { ProductMedia } from '@/types/api'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'

const formatSize = (bytes: number) => `${Math.round(bytes / 1024 / 1024)}MB`

/** One file in flight. Progress is per file, because they finish out of order. */
type Upload = { id: string; name: string; percent: number; error?: string }

function SortableMedia({
  media,
  disabled,
  onSetCover,
  onEditAlt,
  onDelete,
}: {
  media: ProductMedia
  disabled: boolean
  onSetCover: () => void
  onEditAlt: () => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: media.id,
    disabled,
  })

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'group bg-muted relative aspect-square overflow-hidden rounded-lg border',
        isDragging && 'z-10 shadow-lg',
      )}
    >
      {media.type === 'VIDEO' ? (
        <video src={media.url} className="size-full object-cover" muted playsInline />
      ) : (
        <img
          src={media.url}
          alt={media.altText ?? ''}
          loading="lazy"
          className="size-full object-cover"
        />
      )}

      {media.isCover && (
        <span className="bg-background/90 absolute top-1.5 left-1.5 rounded px-1.5 py-0.5 text-[10px] font-medium shadow-sm">
          Cover
        </span>
      )}

      <button
        type="button"
        // The handle owns the drag, not the tile: the menu stays clickable and
        // a stray drag cannot start from it.
        {...attributes}
        {...listeners}
        disabled={disabled}
        aria-label={`Reorder ${media.altText ?? 'image'}`}
        className="bg-background/80 absolute bottom-1.5 left-1.5 cursor-grab touch-none rounded p-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 active:cursor-grabbing disabled:cursor-not-allowed"
      >
        <GripVertical className="size-3.5" />
      </button>

      <div className="absolute top-1.5 right-1.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="secondary"
              size="icon"
              className="size-7 shadow-sm"
              aria-label="Image actions"
            >
              <MoreHorizontal className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onSelect={onSetCover} disabled={media.isCover}>
              <Star className="size-4" />
              Set as cover
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onEditAlt}>
              <Tag className="size-4" />
              Alt text
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

/**
 * The gallery. Files go straight from the browser to object storage — the API
 * signs a URL, the browser PUTs to it, and only then is a row recorded. Node
 * never touches an image byte, which is what keeps a 20MB drop from tying up a
 * request the rest of the admin is waiting on.
 *
 * Order is the payload: position 0 is the cover, and "Set as cover" is the same
 * reorder call with that image first rather than a second flag that could
 * disagree with it.
 */
export function ProductMediaPanel({
  productId,
  media,
}: {
  productId: string
  media: ProductMedia[]
}) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const upload = useUploadMedia(productId)
  const reorder = useReorderMedia(productId)
  const updateMedia = useUpdateMedia(productId)
  const deleteMedia = useDeleteMedia(productId)

  const [items, setItems] = React.useState(media)
  const [uploads, setUploads] = React.useState<Upload[]>([])
  const [dragging, setDragging] = React.useState(false)
  const [reordering, setReordering] = React.useState(false)
  const [editingAlt, setEditingAlt] = React.useState<ProductMedia | null>(null)
  const [deleting, setDeleting] = React.useState<ProductMedia | null>(null)

  // The server is the authority on order; local state only holds the optimistic
  // gap between a drop and the refetch that confirms it.
  React.useEffect(() => {
    setItems(media)
  }, [media])

  const sensors = useSensors(
    // A few pixels of slop, or every click on the handle registers as a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return

    // Sequential, not parallel. Four 20MB files at once saturate the uplink and
    // every progress bar crawls together; one at a time, the first is done in a
    // quarter of the wait.
    for (const file of Array.from(files)) {
      const id = `${file.name}-${Date.now()}-${Math.random()}`

      if (!(ACCEPTED_MEDIA_TYPES as readonly string[]).includes(file.type)) {
        setUploads((current) => [
          ...current,
          { id, name: file.name, percent: 0, error: 'Not a file type this accepts' },
        ])
        continue
      }
      if (file.size > MAX_MEDIA_BYTES) {
        setUploads((current) => [
          ...current,
          { id, name: file.name, percent: 0, error: `Over ${formatSize(MAX_MEDIA_BYTES)}` },
        ])
        continue
      }

      setUploads((current) => [...current, { id, name: file.name, percent: 0 }])
      try {
        await upload.mutateAsync({
          file,
          onProgress: (percent) =>
            setUploads((current) =>
              current.map((row) => (row.id === id ? { ...row, percent } : row)),
            ),
        })
        setUploads((current) => current.filter((row) => row.id !== id))
      } catch (error) {
        const message =
          error instanceof ApiError ? error.message : 'The upload failed. Try again.'
        setUploads((current) =>
          current.map((row) => (row.id === id ? { ...row, error: message } : row)),
        )
      }
    }

    // Reset the input, or picking the same file twice fires no change event.
    if (inputRef.current) inputRef.current.value = ''
  }

  const commitOrder = async (next: ProductMedia[], previous: ProductMedia[]) => {
    setItems(next)
    setReordering(true)
    try {
      await reorder.mutateAsync(next.map((item) => item.id))
    } catch (error) {
      setItems(previous)
      toast.error(error instanceof ApiError ? error.message : 'Could not save the new order')
    } finally {
      setReordering(false)
    }
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const from = items.findIndex((item) => item.id === active.id)
    const to = items.findIndex((item) => item.id === over.id)
    if (from === -1 || to === -1) return

    void commitOrder(arrayMove(items, from, to), items)
  }

  const setCover = (media: ProductMedia) => {
    const rest = items.filter((item) => item.id !== media.id)
    void commitOrder([media, ...rest], items)
  }

  const confirmDelete = async () => {
    if (!deleting) return
    try {
      await deleteMedia.mutateAsync(deleting.id)
      setDeleting(null)
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not delete that image')
      setDeleting(null)
    }
  }

  return (
    <section className="bg-card rounded-lg border">
      <header className="flex items-start justify-between gap-3 border-b px-5 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Media</h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Drag to order. The first image is the cover the storefront leads with.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="size-4" />
          Add images
        </Button>
      </header>

      <div
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          void handleFiles(event.dataTransfer.files)
        }}
        className={cn('p-5 transition-colors', dragging && 'bg-accent/40')}
      >
        {items.length === 0 && uploads.length === 0 ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="border-muted-foreground/30 hover:border-ring hover:bg-accent/30 flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-12 transition-colors"
          >
            <ImagePlus className="text-muted-foreground size-6" aria-hidden />
            <span className="text-sm font-medium">Drop images here, or click to choose</span>
            <span className="text-muted-foreground text-xs">
              PNG, JPEG, WebP, AVIF, GIF or MP4, up to {formatSize(MAX_MEDIA_BYTES)} each
            </span>
          </button>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={items.map((item) => item.id)} strategy={rectSortingStrategy}>
              <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5">
                {items.map((item) => (
                  <SortableMedia
                    key={item.id}
                    media={item}
                    // Dragging during a save would queue a second order the
                    // first request has not seen yet.
                    disabled={reordering}
                    onSetCover={() => setCover(item)}
                    onEditAlt={() => setEditingAlt(item)}
                    onDelete={() => setDeleting(item)}
                  />
                ))}

                {uploads.map((row) => (
                  <li
                    key={row.id}
                    className={cn(
                      'bg-muted/50 flex aspect-square flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-3 text-center',
                      row.error && 'border-destructive/50',
                    )}
                  >
                    {row.error ? (
                      <>
                        <p className="text-destructive text-xs font-medium">{row.error}</p>
                        <p className="text-muted-foreground w-full truncate text-[10px]">
                          {row.name}
                        </p>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setUploads((current) => current.filter((item) => item.id !== row.id))
                          }
                        >
                          Dismiss
                        </Button>
                      </>
                    ) : (
                      <>
                        <Spinner />
                        <div className="bg-border h-1 w-full overflow-hidden rounded-full">
                          <div
                            className="bg-primary h-full transition-[width]"
                            style={{ width: `${row.percent}%` }}
                          />
                        </div>
                        <p className="text-muted-foreground w-full truncate text-[10px]">
                          {row.name}
                        </p>
                      </>
                    )}
                  </li>
                ))}

                <li>
                  <button
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    className="border-muted-foreground/30 hover:border-ring hover:bg-accent/30 text-muted-foreground flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed transition-colors"
                  >
                    <ImagePlus className="size-5" aria-hidden />
                    <span className="text-xs">Add</span>
                  </button>
                </li>
              </ul>
            </SortableContext>
          </DndContext>
        )}

        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED_MEDIA_TYPES.join(',')}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => void handleFiles(event.target.files)}
        />
      </div>

      <AltTextDialog
        media={editingAlt}
        onOpenChange={(open) => !open && setEditingAlt(null)}
        onSave={async (altText) => {
          if (!editingAlt) return
          await updateMedia.mutateAsync({ mediaId: editingAlt.id, altText })
          setEditingAlt(null)
        }}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this image?"
        description="The file is removed from storage as well. Variants using it fall back to the gallery cover."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={confirmDelete}
      />
    </section>
  )
}

function AltTextDialog({
  media,
  onOpenChange,
  onSave,
}: {
  media: ProductMedia | null
  onOpenChange: (open: boolean) => void
  onSave: (altText: string | null) => Promise<void>
}) {
  const [value, setValue] = React.useState('')
  const [pending, setPending] = React.useState(false)

  React.useEffect(() => {
    if (media) setValue(media.altText ?? '')
  }, [media])

  const submit = async () => {
    setPending(true)
    try {
      await onSave(value.trim() || null)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={Boolean(media)} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Alt text</DialogTitle>
          <DialogDescription>
            What a screen reader announces, and what search engines read. Describe the shoe, not the
            photograph.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="altText">Description</Label>
          <Input
            id="altText"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Black mesh running shoe, side view"
            maxLength={300}
            autoFocus
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={pending}>
            {pending && <Spinner />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
