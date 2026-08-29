import * as React from 'react'
import { useCategoryTree } from '@/features/categories/queries'
import { flatten } from '@/features/categories/tree'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/** Radix Select has no "no value" item, so the none-option carries a sentinel. */
const NONE = '__none__'

/**
 * The category picker, flattened out of the tree with an indent per level. A
 * real tree control inside a Select is a fight with Radix's roving focus for a
 * list that is four levels deep at most — the indent carries the same
 * information and stays keyboard-navigable for free.
 */
export function CategorySelect({
  value,
  onChange,
  id = 'categoryId',
  label,
  placeholder = 'No category',
  allowNone = true,
  noneLabel = 'No category',
  disabled = false,
  error,
  className,
}: {
  value: string | null | undefined
  onChange: (value: string | null) => void
  id?: string
  label?: string
  placeholder?: string
  allowNone?: boolean
  noneLabel?: string
  disabled?: boolean
  error?: string
  className?: string
}) {
  const { data: tree, isPending } = useCategoryTree()

  const rows = React.useMemo(() => (tree ? flatten(tree) : []), [tree])

  return (
    <div className="space-y-2">
      {label && <Label htmlFor={id}>{label}</Label>}
      <Select
        value={value ?? NONE}
        onValueChange={(next) => onChange(next === NONE ? null : next)}
        disabled={disabled || isPending}
      >
        <SelectTrigger id={id} className={className} aria-invalid={Boolean(error)}>
          <SelectValue placeholder={isPending ? 'Loading…' : placeholder} />
        </SelectTrigger>
        <SelectContent>
          {allowNone && <SelectItem value={NONE}>{noneLabel}</SelectItem>}
          {rows.map((row) => (
            <SelectItem key={row.id} value={row.id}>
              {/* Non-breaking spaces: ordinary ones collapse in the trigger,
                  and the indent is the only thing showing the nesting. */}
              {'  '.repeat(row.depth)}
              {row.category.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && <p className="text-destructive text-sm">{error}</p>}
    </div>
  )
}
