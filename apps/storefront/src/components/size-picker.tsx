import { cn } from '@/lib/utils'
import type { OptionState } from '@/features/catalog/use-variant-selection'

/**
 * The option pickers. Named `size-picker.tsx` per repo-structure.md, but it
 * renders any axis — the product decides how many there are and in what order,
 * via `product_variant_options.position`.
 *
 * The two states that must stay visually distinct:
 *
 *   sold out  — struck through, still clickable-looking, never hidden. A size
 *               that disappears reads as a rendering fault, and the customer
 *               cannot tell "we never made it" from "we're out".
 *   disabled  — this combination does not exist. Dimmed and genuinely
 *               unclickable.
 *
 * Both are `disabled` to the browser; only sold-out gets the strike.
 */
export function OptionPicker({
  option,
  onSelect,
}: {
  option: OptionState
  onSelect: (optionId: string, valueId: string) => void
}) {
  // A swatch axis is one whose values carry a hex. Derived, not configured:
  // the admin sets `swatch_hex` on colour values and nothing else.
  const isSwatch = option.values.some((value) => value.swatchHex)
  const chosen = option.values.find((value) => value.selected)

  return (
    <div>
      {/*
        "Size 3", not "Size" pinned left with "3" pushed to the far right. The
        split version made the customer's own choice the furthest thing on the
        row from the label it answers, and on a wide buy box the two ended up
        several hundred pixels apart.
      */}
      <h2 className="text-sm font-medium">
        {option.name}
        {chosen && <span className="text-muted-foreground ml-2 font-normal">{chosen.value}</span>}
      </h2>

      <div className={cn('mt-2.5 flex flex-wrap', isSwatch ? 'gap-3' : 'gap-2')}>
        {option.values.map((value) =>
          isSwatch ? (
            <button
              key={value.id}
              type="button"
              // Sold out stays interactive: choosing it is how the customer
              // gets told it is sold out rather than left guessing.
              disabled={value.disabled}
              onClick={() => onSelect(option.id, value.id)}
              aria-pressed={value.selected}
              aria-label={`${value.value}${value.soldOut ? ' — sold out' : ''}`}
              title={value.value}
              className={cn(
                'relative size-9 rounded-full transition-all',
                'outline-offset-2',
                value.selected ? 'ring-foreground ring-2 ring-offset-2' : 'ring-border ring-1',
                value.disabled && 'cursor-not-allowed opacity-30',
                !value.disabled && 'cursor-pointer',
              )}
              style={{ backgroundColor: value.swatchHex ?? 'transparent' }}
            >
              {value.soldOut && (
                // A diagonal bar: the swatch equivalent of a strikethrough.
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <span className="bg-foreground/70 h-px w-full rotate-45" />
                </span>
              )}
            </button>
          ) : (
            <button
              key={value.id}
              type="button"
              disabled={value.disabled}
              onClick={() => onSelect(option.id, value.id)}
              aria-pressed={value.selected}
              className={cn(
                'min-w-14 border px-3.5 py-2.5 text-sm transition-colors',
                value.selected
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-input hover:border-foreground',
                value.soldOut && 'text-muted-foreground line-through',
                value.disabled && 'cursor-not-allowed opacity-30 hover:border-input',
                !value.disabled && 'cursor-pointer',
              )}
            >
              {value.value}
            </button>
          ),
        )}
      </div>
    </div>
  )
}
