import * as React from 'react'
import { useSearchParams } from 'react-router'

type Config<F extends string> = {
  /** `column:direction`. Must be one the API is willing to sort by. */
  defaultSort: string
  defaultLimit?: number
  /** Filter keys this list understands, e.g. `['status']`. */
  filters?: readonly F[]
}

export type ListParams<F extends string> = {
  page: number
  limit: number
  sort: string
  q: string
  filters: Record<F, string | undefined>
  setPage: (page: number) => void
  setSort: (sort: string) => void
  setSearch: (q: string) => void
  setFilter: (key: F, value: string | undefined) => void
  clear: () => void
  /** True when anything narrows the list — drives "no matches" vs "none yet". */
  isFiltered: boolean
  /** Ready to hand to the fetcher; defaults are omitted to keep URLs short. */
  toQuery: () => Record<string, string | number>
}

/**
 * List state lives in the URL, on every list page in the admin. A filtered view
 * is then a link an operator can bookmark, share, or reach with the back
 * button — and a refresh does not silently reset to page 1 of everything.
 *
 * Anything that changes *what* is in the list resets the page, since page 4 of
 * a three-page result is an empty table with no explanation.
 */
export function useListParams<F extends string = never>(config: Config<F>): ListParams<F> {
  const { defaultSort, defaultLimit = 25, filters: filterKeys } = config
  const [searchParams, setSearchParams] = useSearchParams()

  const page = Math.max(1, Number(searchParams.get('page')) || 1)
  const limit = Number(searchParams.get('limit')) || defaultLimit
  const sort = searchParams.get('sort') ?? defaultSort
  const q = searchParams.get('q') ?? ''

  const keys = React.useMemo(() => filterKeys ?? ([] as readonly F[]), [filterKeys])

  const filters = React.useMemo(() => {
    const result = {} as Record<F, string | undefined>
    for (const key of keys) result[key] = searchParams.get(key) ?? undefined
    return result
  }, [keys, searchParams])

  const update = React.useCallback(
    (changes: Record<string, string | number | undefined>, { resetPage = true } = {}) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current)
          for (const [key, value] of Object.entries(changes)) {
            if (value === undefined || value === '') next.delete(key)
            else next.set(key, String(value))
          }
          if (resetPage) next.delete('page')
          return next
        },
        // Filtering is not a navigation step: without `replace`, going back
        // walks one keystroke at a time through the search box.
        { replace: true },
      )
    },
    [setSearchParams],
  )

  return {
    page,
    limit,
    sort,
    q,
    filters,
    setPage: React.useCallback(
      (value: number) => update({ page: value > 1 ? value : undefined }, { resetPage: false }),
      [update],
    ),
    setSort: React.useCallback(
      (value: string) => update({ sort: value === defaultSort ? undefined : value }),
      [update, defaultSort],
    ),
    setSearch: React.useCallback((value: string) => update({ q: value.trim() || undefined }), [update]),
    setFilter: React.useCallback(
      (key: F, value: string | undefined) => update({ [key]: value }),
      [update],
    ),
    clear: React.useCallback(() => {
      setSearchParams(new URLSearchParams(), { replace: true })
    }, [setSearchParams]),
    isFiltered: Boolean(q) || keys.some((key) => searchParams.get(key)),
    toQuery: () => ({
      page,
      limit,
      sort,
      ...(q ? { q } : {}),
      ...Object.fromEntries(
        keys.flatMap((key) => {
          const value = filters[key]
          return value ? [[key, value]] : []
        }),
      ),
    }),
  }
}
