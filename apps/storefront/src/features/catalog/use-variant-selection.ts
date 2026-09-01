import * as React from 'react'
import type { Product, ProductOption, ProductVariant, StockBucket } from '@/types/api'

/**
 * Resolves a customer's option picks to a variant, and decides how every other
 * value should render.
 *
 * The whole variant list arrives in the product payload — at most 35 rows — so
 * every question below is answered locally. A round trip per size tap would be
 * a picker that lags behind the finger.
 *
 * Two states that look alike and must not be confused:
 *
 *   disabled  — no variant exists for this combination. The product was never
 *               made in it. Nothing to restock, nothing to wait for.
 *   soldOut   — the variant exists and is out of stock. Struck through, never
 *               hidden: a size that vanishes reads as a rendering bug, and the
 *               customer is left wondering whether they mis-saw it.
 */

export type ValueState = {
  id: string
  value: string
  swatchHex: string | null
  /** No variant exists for this combination — not made. */
  disabled: boolean
  /** A variant exists but nothing is left. */
  soldOut: boolean
  selected: boolean
}

export type OptionState = {
  id: string
  name: string
  position: number
  values: ValueState[]
}

export type VariantSelection = {
  /** optionId -> optionValueId */
  selected: Record<string, string>
  select: (optionId: string, valueId: string) => void
  reset: () => void
  options: OptionState[]
  /** Non-null only once every axis is chosen and a matching variant exists. */
  variant: ProductVariant | null
  /** True when at least one axis is still unchosen. */
  incomplete: boolean
  /** The axes still waiting on a pick — for "Select a size" style prompts. */
  missing: ProductOption[]
  /** What to show before a full selection: the variant's, else the range. */
  displayStock: StockBucket
}

/** Set equality on option value ids. Variants carry one value per axis. */
function matches(variant: ProductVariant, picks: string[]): boolean {
  return picks.every((id) => variant.optionValueIds.includes(id))
}

export function useVariantSelection(product: Product | undefined): VariantSelection {
  const [selected, setSelected] = React.useState<Record<string, string>>({})

  const options = product?.options ?? []
  const variants = React.useMemo(
    () => product?.variants ?? [],
    [product],
  )

  // Changing product must not carry the previous one's picks over.
  const slug = product?.slug
  React.useEffect(() => setSelected({}), [slug])

  /*
   * Auto-pick any axis that offers exactly one value. A single-colour shoe
   * should not make the customer click "Black" before the price appears — and
   * without this, a one-value axis leaves the selection permanently incomplete
   * unless they happen to tap it.
   */
  React.useEffect(() => {
    const single = options.filter((o) => o.values.length === 1)
    if (single.length === 0) return
    setSelected((current) => {
      let changed = false
      const next = { ...current }
      for (const option of single) {
        if (!next[option.id]) {
          next[option.id] = option.values[0]!.id
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [options])

  const state = React.useMemo<OptionState[]>(
    () =>
      options.map((option) => ({
        id: option.id,
        name: option.name,
        position: option.position,
        values: option.values.map((value) => {
          /*
           * Judge this value against the picks on *other* axes only. Including
           * this axis's own current pick would mark every sibling disabled the
           * moment one was chosen, and the customer could never change their
           * mind about size without clearing the colour first.
           */
          const otherPicks = Object.entries(selected)
            .filter(([optionId]) => optionId !== option.id)
            .map(([, valueId]) => valueId)

          const candidates = variants.filter((v) => matches(v, [...otherPicks, value.id]))

          return {
            id: value.id,
            value: value.value,
            swatchHex: value.swatchHex,
            disabled: candidates.length === 0,
            soldOut: candidates.length > 0 && candidates.every((v) => v.stock === 'SOLD_OUT'),
            selected: selected[option.id] === value.id,
          }
        }),
      })),
    [options, variants, selected],
  )

  const picks = Object.values(selected)
  const complete = options.length > 0 && options.every((o) => Boolean(selected[o.id]))
  const variant = complete ? (variants.find((v) => matches(v, picks)) ?? null) : null

  const select = React.useCallback(
    (optionId: string, valueId: string) => {
      setSelected((current) => {
        // Tapping the current pick clears it, so a customer can back out of an
        // axis without reloading the page.
        if (current[optionId] === valueId) {
          const { [optionId]: _removed, ...rest } = current
          return rest
        }
        return { ...current, [optionId]: valueId }
      })
    },
    [],
  )

  return {
    selected,
    select,
    reset: React.useCallback(() => setSelected({}), []),
    options: state,
    variant,
    incomplete: !complete,
    missing: options.filter((o) => !selected[o.id]),
    // Before a full pick, fall back to the product-wide bucket — otherwise a
    // product with one sold-out size would read as sold out on arrival.
    displayStock: variant?.stock ?? product?.stock ?? 'SOLD_OUT',
  }
}
