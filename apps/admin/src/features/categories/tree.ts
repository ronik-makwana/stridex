import type { Category } from '@/types/api'

/** One visible row: the category plus where it sits in the tree it came from. */
export type FlatCategory = {
  id: string
  category: Category
  depth: number
  parentId: string | null
  /** False when it has children but they are hidden — drives the chevron. */
  hasChildren: boolean
}

const kids = (node: Category): Category[] => node.children ?? []

/**
 * Depth-first, with collapsed branches dropped. dnd-kit sorts a flat list, so
 * the tree is flattened for dragging and rebuilt from the result — the same
 * shape the rows render from, which keeps what is dragged and what is seen
 * identical.
 */
export function flatten(
  nodes: Category[],
  collapsed: ReadonlySet<string> = new Set(),
  depth = 0,
  parentId: string | null = null,
): FlatCategory[] {
  return nodes.flatMap((category) => {
    const children = kids(category)
    const row: FlatCategory = {
      id: category.id,
      category,
      depth,
      parentId,
      hasChildren: children.length > 0,
    }
    if (collapsed.has(category.id)) return [row]
    return [row, ...flatten(children, collapsed, depth + 1, category.id)]
  })
}

export function findNode(nodes: Category[], id: string): Category | null {
  for (const node of nodes) {
    if (node.id === id) return node
    const found = findNode(kids(node), id)
    if (found) return found
  }
  return null
}

/** Direct children of `parentId`; the top level when it is `null`. */
export function childrenOf(nodes: Category[], parentId: string | null): Category[] {
  if (parentId === null) return nodes
  const parent = findNode(nodes, parentId)
  return parent ? kids(parent) : []
}

export function descendantIds(node: Category): string[] {
  return kids(node).flatMap((child) => [child.id, ...descendantIds(child)])
}

/** Levels between a node and its deepest descendant; 0 for a leaf. */
export function subtreeHeight(node: Category): number {
  const children = kids(node)
  if (children.length === 0) return 0
  return 1 + Math.max(...children.map(subtreeHeight))
}

/** Lifts `id` out of the tree, returning the remainder and the node removed. */
export function removeNode(
  nodes: Category[],
  id: string,
): { tree: Category[]; removed: Category | null } {
  let removed: Category | null = null

  const walk = (list: Category[]): Category[] =>
    list.flatMap((node) => {
      if (node.id === id) {
        removed = node
        return []
      }
      return [{ ...node, children: node.children ? walk(node.children) : null }]
    })

  return { tree: walk(nodes), removed }
}

/** Puts `node` under `parentId` at `index`, creating the child list if needed. */
export function insertNode(
  nodes: Category[],
  parentId: string | null,
  index: number,
  node: Category,
): Category[] {
  if (parentId === null) {
    const next = [...nodes]
    next.splice(index, 0, node)
    return next
  }

  return nodes.map((current) => {
    if (current.id === parentId) {
      const children = [...kids(current)]
      children.splice(index, 0, node)
      return { ...current, children }
    }
    return { ...current, children: current.children ? insertNode(current.children, parentId, index, node) : null }
  })
}

/**
 * Prunes the tree to what matches, keeping the ancestors of every hit. A
 * matching leaf shown without its branch is unplaceable — "Running" means
 * nothing until you can see it sits under Men.
 */
export function filterTree(nodes: Category[], query: string): Category[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return nodes

  const walk = (list: Category[]): Category[] =>
    list.flatMap((node) => {
      const children = walk(kids(node))
      const hit =
        node.name.toLowerCase().includes(needle) || node.slug.toLowerCase().includes(needle)
      if (!hit && children.length === 0) return []
      return [{ ...node, children }]
    })

  return walk(nodes)
}

export function countNodes(nodes: Category[]): number {
  return nodes.reduce((total, node) => total + 1 + countNodes(kids(node)), 0)
}
