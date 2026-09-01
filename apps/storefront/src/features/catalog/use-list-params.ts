import * as React from 'react'
import { useSearchParams } from 'react-router'
import type { ProductSort } from '@/types/api'

/**
 * Grid state lives in the URL and nowhere else.
 *
 * That is the rule for every list in this storefront, and it is not a
 * preference: a filtered grid has to survive a reload, a Back press, and being
 * pasted into a WhatsApp message. Mirroring it into React state as well would
 * create two sources of truth that disagree the first time someone uses the
 * back button.
 *
 * Written with `useSearchParams` rather than nuqs — the admin app uses nuqs,
 * but this app is separate by design and a second dependency for one hook is
 * not worth it.
 */

export const SORTS: { value: ProductSort; label: string }[] = [
  { value: 'featured', label: 'Featured' },
  { value: 'newest', label: 'Newest' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'name_asc', label: 'Name A–Z' },
]

const VALID_SORTS = new Set(SORTS.map((s) => s.value))

export type ListParams = {
  page: number
  sort: ProductSort
  brand: string[]
  minPrice?: number
  maxPrice?: number
  q?: string
  /** attributeId -> selected value ids */
  attributes: Map<string, string[]>
}

const csv = (value: string | null) =>
  value ? value.split(',').map((part) => part.trim()).filter(Boolean) : []

export function useListParams() {
  const [searchParams, setSearchParams] = useSearchParams()

  const params = React.useMemo<ListParams>(() => {
    const attributes = new Map<string, string[]>()
    for (const [key, value] of searchParams) {
      if (!key.startsWith('attr:')) continue
      const ids = csv(value)
      if (ids.length > 0) attributes.set(key.slice(5), ids)
    }

    const rawSort = searchParams.get('sort')
    const min = Number(searchParams.get('minPrice'))
    const max = Number(searchParams.get('maxPrice'))

    return {
      // A hand-edited `?page=0` or `?page=abc` must not reach the API as-is.
      page: Math.max(1, Number(searchParams.get('page')) || 1),
      // An unknown sort falls back here so the *page* still renders; the API
      // would 400 it, which is right for the API and wrong for a bookmark.
      sort: rawSort && VALID_SORTS.has(rawSort as ProductSort) ? (rawSort as ProductSort) : 'featured',
      brand: csv(searchParams.get('brand')),
      ...(Number.isFinite(min) && min > 0 ? { minPrice: min } : {}),
      ...(Number.isFinite(max) && max > 0 ? { maxPrice: max } : {}),
      ...(searchParams.get('q') ? { q: searchParams.get('q')! } : {}),
      attributes,
    }
  }, [searchParams])

  /**
   * Every mutation resets to page 1 unless it *is* a page change. Narrowing a
   * filter while on page 4 of the old result set otherwise lands the customer
   * on an empty page they have to notice and fix themselves.
   */
  const update = React.useCallback(
    (changes: Record<string, string | null>, { keepPage = false } = {}) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current)
          for (const [key, value] of Object.entries(changes)) {
            if (value === null || value === '') next.delete(key)
            else next.set(key, value)
          }
          if (!keepPage) next.delete('page')
          return next
        },
        // `replace` on filter changes so Back leaves the grid entirely rather
        // than stepping through every tick the customer made.
        { replace: !keepPage },
      )
    },
    [setSearchParams],
  )

  const toggleValue = React.useCallback(
    (key: string, id: string) => {
      const current = csv(searchParams.get(key))
      const next = current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id]
      update({ [key]: next.length > 0 ? next.join(',') : null })
    },
    [searchParams, update],
  )

  const setPage = React.useCallback(
    (page: number) => {
      update({ page: page <= 1 ? null : String(page) }, { keepPage: true })
      window.scrollTo({ top: 0, behavior: 'smooth' })
    },
    [update],
  )

  const clearAll = React.useCallback(() => {
    // `q` survives: clearing filters on a search results page should not throw
    // away what the customer searched for.
    const q = searchParams.get('q')
    setSearchParams(q ? new URLSearchParams({ q }) : new URLSearchParams(), { replace: true })
  }, [searchParams, setSearchParams])

  const activeCount =
    params.brand.length +
    [...params.attributes.values()].reduce((sum, ids) => sum + ids.length, 0) +
    (params.minPrice !== undefined || params.maxPrice !== undefined ? 1 : 0)

  return { params, searchParams, update, toggleValue, setPage, clearAll, activeCount }
}

/** Turns parsed params back into the query object the API expects. */
export function toApiParams(params: ListParams, extra: Record<string, string> = {}) {
  const query: Record<string, string | number> = { page: params.page, sort: params.sort, ...extra }
  if (params.brand.length) query.brand = params.brand.join(',')
  if (params.minPrice !== undefined) query.minPrice = params.minPrice
  if (params.maxPrice !== undefined) query.maxPrice = params.maxPrice
  if (params.q) query.q = params.q
  for (const [attributeId, ids] of params.attributes) query[`attr:${attributeId}`] = ids.join(',')
  return query
}
