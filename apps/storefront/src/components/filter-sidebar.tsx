import * as React from 'react'
import { ChevronDown, X } from 'lucide-react'
import { formatMoney } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { ListParams } from '@/features/catalog/use-list-params'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { FacetsResponse } from '@/types/api'

/**
 * The filter sidebar, built entirely from the facets endpoint.
 *
 * Nothing here is hard-coded: which filters exist, which values they offer and
 * how many results each has all come from the server, against the same
 * where-clause the grid used. So "Mesh (34)" always means 34 in the grid beside
 * it — the count is never computed here.
 *
 * A value whose count is 0 has already been dropped by the API unless the
 * customer has it selected, so there is nothing to hide client-side either.
 */
export function FilterSidebar({
  facets,
  params,
  onToggle,
  onPriceChange,
  onClear,
  activeCount,
  isPending,
}: {
  facets: FacetsResponse | undefined
  params: ListParams
  onToggle: (key: string, id: string) => void
  onPriceChange: (min?: number, max?: number) => void
  onClear: () => void
  activeCount: number
  isPending?: boolean
}) {
  if (isPending && !facets) return <FilterSkeleton />
  if (!facets) return null

  const selectedFor = (facetId: string) =>
    facetId === 'brand' ? params.brand : (params.attributes.get(facetId) ?? [])

  const keyFor = (facetId: string) => (facetId === 'brand' ? 'brand' : `attr:${facetId}`)

  return (
    <div className="space-y-8">
      {activeCount > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">
            {activeCount} {activeCount === 1 ? 'filter' : 'filters'}
          </p>
          <button
            type="button"
            onClick={onClear}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs underline underline-offset-4"
          >
            <X className="size-3" />
            Clear all
          </button>
        </div>
      )}

      {facets.price && (
        <PriceFilter
          bounds={facets.price}
          min={params.minPrice}
          max={params.maxPrice}
          onChange={onPriceChange}
        />
      )}

      {facets.facets.map((facet) => {
        const selected = selectedFor(facet.id)
        return (
          <FilterGroup
            key={facet.id}
            name={facet.name}
            selectedCount={selected.length}
            valueCount={facet.values.length}
          >
            <ul className="space-y-2">
              {facet.values.map((value) => {
                const checked = selected.includes(value.id)
                return (
                  <li key={value.id}>
                    <label
                      className={cn(
                        'flex cursor-pointer items-center gap-2.5 text-sm',
                        // A selected value whose count has fallen to 0 stays
                        // visible and ticked — removing the customer's own
                        // choice is a filter that fights back.
                        value.count === 0 && !checked && 'text-muted-foreground',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onToggle(keyFor(facet.id), value.id)}
                        className="border-input accent-foreground size-4 shrink-0 rounded-sm border"
                      />
                      <span className="flex-1">{value.label}</span>
                      <span className="text-muted-foreground text-xs tabular-nums">
                        {value.count}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          </FilterGroup>
        )
      })}
    </div>
  )
}

/**
 * One collapsible facet.
 *
 * Collapsed by default, so the sidebar opens as a short list of the filters
 * that *exist* rather than 28 brand checkboxes pushing everything else below
 * the fold. Scanning what you can filter by is the first thing a customer does;
 * ticking a value is the second.
 *
 * A group opens itself when it already has a selection — arriving from a
 * bookmark or the back button must not hide the filters that are active.
 */
function FilterGroup({
  name,
  /** Rendered as the pill, and decides whether the group starts open. */
  selectedCount,
  valueCount,
  children,
}: {
  name: string
  selectedCount: number
  valueCount: number
  children: React.ReactNode
}) {
  const [open, setOpen] = React.useState(selectedCount > 0)

  // Follows the URL: clearing all filters collapses the groups again, and a
  // Back press that restores a selection re-opens the group holding it.
  React.useEffect(() => {
    if (selectedCount > 0) setOpen(true)
  }, [selectedCount])

  const id = `facet-${name.toLowerCase().replace(/\s+/g, '-')}`

  return (
    <div className="border-b pb-4 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={id}
        className="flex w-full items-center justify-between gap-2 py-1 text-left"
      >
        <span className="text-xs font-medium tracking-[0.1em] uppercase">{name}</span>
        <span className="flex items-center gap-2">
          {/*
            Two numbers, and they mean different things: the filled pill is how
            many values you have selected in this group, the muted one is how
            many the group offers. Kept deliberately — the pill is the only
            marker that survives when the group is scrolled past.
          */}
          {selectedCount > 0 && (
            <span className="bg-foreground text-background rounded-full px-1.5 py-0.5 text-[0.625rem] leading-none tabular-nums">
              {selectedCount}
            </span>
          )}
          <span className="text-muted-foreground text-xs tabular-nums">{valueCount}</span>
          <ChevronDown
            className={cn(
              'text-muted-foreground size-4 transition-transform',
              open && 'rotate-180',
            )}
          />
        </span>
      </button>

      {open && (
        // Capped and scrollable: Brand has 28 values, and a list that long
        // buries every facet under it.
        <div id={id} className="mt-3 max-h-72 overflow-y-auto pr-1">
          {children}
        </div>
      )}
    </div>
  )
}

/**
 * Two number inputs, not a drag slider. A slider needs a pixel-accurate drag to
 * type an exact budget, and on a phone it competes with page scroll — a
 * customer who wants "under 3000" can type 3000 in one tap.
 */
function PriceFilter({
  bounds,
  min,
  max,
  onChange,
}: {
  bounds: { min: number; max: number }
  min?: number
  max?: number
  onChange: (min?: number, max?: number) => void
}) {
  const [draftMin, setDraftMin] = React.useState(min?.toString() ?? '')
  const [draftMax, setDraftMax] = React.useState(max?.toString() ?? '')

  // The URL is the source of truth; typed drafts follow it back when the
  // customer clears filters or presses Back.
  React.useEffect(() => setDraftMin(min?.toString() ?? ''), [min])
  React.useEffect(() => setDraftMax(max?.toString() ?? ''), [max])

  const apply = () => {
    const nextMin = draftMin ? Number(draftMin) : undefined
    const nextMax = draftMax ? Number(draftMax) : undefined
    // Swapped bounds are a typo, not a request for zero results.
    if (nextMin !== undefined && nextMax !== undefined && nextMin > nextMax) {
      onChange(nextMax, nextMin)
      return
    }
    onChange(nextMin, nextMax)
  }

  return (
    <div>
      <h3 className="text-xs font-medium tracking-[0.1em] uppercase">Price</h3>
      <p className="text-muted-foreground mt-2 text-xs">
        {formatMoney(String(bounds.min))} – {formatMoney(String(bounds.max))}
      </p>
      <div className="mt-3 flex items-center gap-2">
        <input
          type="number"
          inputMode="numeric"
          placeholder={String(bounds.min)}
          value={draftMin}
          onChange={(event) => setDraftMin(event.target.value)}
          onBlur={apply}
          onKeyDown={(event) => event.key === 'Enter' && apply()}
          className="border-input focus-visible:outline-ring w-full rounded-md border bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:outline-2"
          aria-label="Minimum price"
        />
        <span className="text-muted-foreground text-sm">–</span>
        <input
          type="number"
          inputMode="numeric"
          placeholder={String(bounds.max)}
          value={draftMax}
          onChange={(event) => setDraftMax(event.target.value)}
          onBlur={apply}
          onKeyDown={(event) => event.key === 'Enter' && apply()}
          className="border-input focus-visible:outline-ring w-full rounded-md border bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:outline-2"
          aria-label="Maximum price"
        />
      </div>
      {(min !== undefined || max !== undefined) && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 -ml-3"
          onClick={() => onChange(undefined, undefined)}
        >
          Clear price
        </Button>
      )}
    </div>
  )
}

function FilterSkeleton() {
  return (
    <div className="space-y-8">
      {[0, 1, 2].map((block) => (
        <div key={block}>
          <Skeleton className="h-3 w-24" />
          <div className="mt-3 space-y-2">
            {[0, 1, 2, 3].map((row) => (
              <Skeleton key={row} className="h-4 w-full" />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
