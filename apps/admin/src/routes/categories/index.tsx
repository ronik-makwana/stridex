import * as React from 'react'
import { ChevronsDownUp, ChevronsUpDown, FolderTree, Plus, Search, SearchX } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api-client'
import { useCategoryTree } from '@/features/categories/queries'
import {
  useDeleteCategory,
  useReorderCategories,
  useSetCategoryStatus,
} from '@/features/categories/mutations'
import {
  countNodes,
  filterTree,
  insertNode,
  removeNode,
} from '@/features/categories/tree'
import { MAX_CATEGORY_DEPTH, type Category, type CategoryMove } from '@/types/api'
import { PageHeader } from '@/components/page-header'
import { EmptyState } from '@/components/empty-state'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { CategoryModal } from './category-modal'
import { CategoryTree } from './category-tree'

/** Ids of every node that has children, for expand/collapse all. */
function branchIds(nodes: Category[]): string[] {
  return nodes.flatMap((node) =>
    node.children?.length ? [node.id, ...branchIds(node.children)] : [],
  )
}

export default function CategoriesPage() {
  const { data, isPending, error } = useCategoryTree()
  const reorder = useReorderCategories()
  const setStatus = useSetCategoryStatus()
  const deleteCategory = useDeleteCategory()

  const [search, setSearch] = React.useState('')
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(new Set())
  const [editing, setEditing] = React.useState<Category | undefined>()
  const [defaultParentId, setDefaultParentId] = React.useState<string | null>(null)
  const [modalOpen, setModalOpen] = React.useState(false)
  const [deleting, setDeleting] = React.useState<Category | null>(null)
  const [deleteBlock, setDeleteBlock] = React.useState<string | null>(null)

  /**
   * The server is the authority on the tree; this only holds the optimistic
   * gap between a drop and the response that confirms it. A drag that has to
   * wait for a round trip before the row settles reads as a dropped frame.
   */
  const [optimistic, setOptimistic] = React.useState<Category[] | null>(null)
  React.useEffect(() => {
    setOptimistic(null)
  }, [data])

  const tree = optimistic ?? data ?? []
  const visible = React.useMemo(() => filterTree(tree, search), [tree, search])
  const isFiltered = search.trim().length > 0

  const branches = React.useMemo(() => branchIds(tree), [tree])
  const allCollapsed = branches.length > 0 && branches.every((id) => collapsed.has(id))

  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const openCreate = (parentId: string | null = null) => {
    setEditing(undefined)
    setDefaultParentId(parentId)
    setModalOpen(true)
  }

  const openEdit = (category: Category) => {
    setEditing(category)
    setDefaultParentId(null)
    setModalOpen(true)
  }

  const handleMove = async (moves: CategoryMove[], movedId: string, parentId: string | null) => {
    const previous = tree

    // Apply locally first, from the same move list the server is about to
    // settle: remove the node and slot it back in at the index it claimed.
    const { tree: without, removed } = removeNode(previous, movedId)
    if (removed) {
      const index = Math.max(
        moves.findIndex((move) => move.id === movedId),
        0,
      )
      setOptimistic(insertNode(without, parentId, index, removed))
    }
    // A node dropped into a collapsed branch would otherwise vanish.
    if (parentId) {
      setCollapsed((current) => {
        if (!current.has(parentId)) return current
        const next = new Set(current)
        next.delete(parentId)
        return next
      })
    }

    try {
      await reorder.mutateAsync(moves)
    } catch (err) {
      setOptimistic(previous)
      toast.error(
        err instanceof ApiError
          ? [err.message, err.reason].filter(Boolean).join(' — ')
          : 'Could not save the new order',
      )
    }
  }

  const askDelete = (category: Category) => {
    setDeleteBlock(null)
    setDeleting(category)
  }

  // Products block a delete outright — `products.category_id` is not nullable,
  // so there is no category for them to fall back to.
  const blockedByProducts = Boolean(deleting && deleting.productCount > 0)
  const childCount = deleting?.childCount ?? 0
  const canSetDraft = blockedByProducts && deleting?.status !== 'DRAFT'

  const confirmDelete = async () => {
    if (!deleting) return
    try {
      await deleteCategory.mutateAsync({
        id: deleting.id,
        // Confirming a delete that names the subcategories is the operator
        // choosing to move them up; anything else is the blocking default.
        childAction: childCount > 0 ? 'reparent' : 'block',
      })
      toast.success(`${deleting.name} deleted`)
      setDeleting(null)
    } catch (err) {
      // 422 is the designed outcome, not a failure: the counts this page holds
      // were stale. Keep the dialog open and turn it into the explanation.
      if (err instanceof ApiError && err.status === 422) {
        setDeleteBlock(err.reason ?? err.message)
        return
      }
      toast.error(err instanceof ApiError ? err.message : 'Could not delete this category')
      setDeleting(null)
    }
  }

  const deleteDescription = () => {
    if (deleteBlock) return deleteBlock
    if (blockedByProducts) {
      const count = deleting!.productCount
      return `${deleting!.name} still holds ${count} ${count === 1 ? 'product' : 'products'}. Move them to another category first, or set this one to draft to hide it from the storefront.`
    }
    if (childCount > 0) {
      const where = deleting!.ancestors.at(-1)?.name ?? 'the top level'
      return `${deleting!.name} has ${childCount} ${childCount === 1 ? 'subcategory' : 'subcategories'}. They will move up to ${where}, keeping their own subcategories. This cannot be undone.`
    }
    return 'This cannot be undone.'
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Categories"
        description={`The storefront’s navigation. A product sits in exactly one category, and the tree nests ${MAX_CATEGORY_DEPTH} levels deep.`}
        actions={
          <Button onClick={() => openCreate(null)}>
            <Plus className="size-4" />
            Add category
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name or slug"
            aria-label="Search name or slug"
            className="h-8 pl-8"
          />
        </div>

        <div className="ml-auto flex items-center gap-2">
          {isFiltered && (
            <span className="text-muted-foreground text-sm" aria-live="polite">
              {countNodes(visible)} shown
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={branches.length === 0}
            onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(branches))}
          >
            {allCollapsed ? (
              <ChevronsUpDown className="size-4" />
            ) : (
              <ChevronsDownUp className="size-4" />
            )}
            {allCollapsed ? 'Expand all' : 'Collapse all'}
          </Button>
        </div>
      </div>

      <div className="bg-card overflow-hidden rounded-lg border">
        {error ? (
          <div className="p-4">
            <Alert variant="destructive">
              <AlertTitle>Could not load the categories</AlertTitle>
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
          </div>
        ) : isPending ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-6" style={{ width: `${70 - index * 4}%` }} />
            ))}
          </div>
        ) : visible.length === 0 ? (
          isFiltered ? (
            <EmptyState
              icon={SearchX}
              title="No categories match that search"
              description="Try a different term, or clear it to see the whole tree."
              action={
                <Button variant="outline" size="sm" onClick={() => setSearch('')}>
                  Clear search
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={FolderTree}
              title="No categories yet"
              description="Start with the top level — Shoes, Apparel — then add subcategories under them."
              action={
                <Button size="sm" onClick={() => openCreate(null)}>
                  <Plus className="size-4" />
                  Add category
                </Button>
              }
            />
          )
        ) : (
          <CategoryTree
            nodes={visible}
            collapsed={collapsed}
            onToggle={toggle}
            // The filtered view is not the tree — dropping a row into a gap
            // whose real neighbours are hidden would move it somewhere nobody
            // aimed at.
            dragDisabled={isFiltered || reorder.isPending}
            maxDepth={MAX_CATEGORY_DEPTH}
            onEdit={openEdit}
            onAddChild={(category) => openCreate(category.id)}
            onSetStatus={(category, status) => setStatus.mutate({ id: category.id, status })}
            onDelete={askDelete}
            onMove={handleMove}
          />
        )}
      </div>

      {isFiltered && visible.length > 0 && (
        <p className="text-muted-foreground text-xs">
          Clear the search to drag categories into a new order or under a new parent.
        </p>
      )}

      <CategoryModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        category={editing}
        tree={tree}
        defaultParentId={defaultParentId}
      />

      {/*
        Three dialogs in one. A plain delete asks to confirm; a delete with
        subcategories spells out where they will land and makes confirming the
        choice to move them; a delete with products cannot proceed at all, so
        the primary action becomes the way forward instead — setting the
        category to draft hides it from the storefront, which is almost always
        what was actually wanted.
      */}
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={
          deleteBlock || blockedByProducts
            ? `Cannot delete ${deleting?.name}`
            : `Delete ${deleting?.name}?`
        }
        description={deleteDescription()}
        cancelLabel={deleteBlock || blockedByProducts ? 'Close' : 'Cancel'}
        confirmLabel={
          deleteBlock
            ? undefined
            : blockedByProducts
              ? canSetDraft
                ? 'Set to draft'
                : undefined
              : childCount > 0
                ? 'Move up and delete'
                : 'Delete'
        }
        variant={blockedByProducts ? 'default' : 'destructive'}
        onConfirm={
          blockedByProducts
            ? async () => {
                await setStatus.mutateAsync({ id: deleting!.id, status: 'DRAFT' })
                setDeleting(null)
              }
            : confirmDelete
        }
      />
    </div>
  )
}
