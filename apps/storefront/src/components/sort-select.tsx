import { SORTS } from '@/features/catalog/use-list-params'
import type { ProductSort } from '@/types/api'

export function SortSelect({
  value,
  onChange,
}: {
  value: ProductSort
  onChange: (sort: ProductSort) => void
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">Sort</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as ProductSort)}
        className="border-input focus-visible:outline-ring rounded-md border bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:outline-2"
      >
        {SORTS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}
