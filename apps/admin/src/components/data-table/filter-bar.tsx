import * as React from 'react'
import { Search, X } from 'lucide-react'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/** Radix Select has no "no value" item, so the all-option carries a sentinel. */
const ALL = '__all__'

export function FilterSelect({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string
  value: string | undefined
  onChange: (value: string | undefined) => void
  options: { value: string; label: string }[]
  className?: string
}) {
  return (
    <Select
      value={value ?? ALL}
      onValueChange={(next) => onChange(next === ALL ? undefined : next)}
    >
      <SelectTrigger size="sm" className={className} aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{label}: all</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * Search plus whatever filters the page passes as children. The input keeps its
 * own state and pushes to the URL on a debounce — writing every keystroke
 * straight to the URL loses the caret on re-render and refetches per letter.
 */
export function FilterBar({
  search,
  onSearchChange,
  searchPlaceholder = 'Search',
  onClear,
  showClear = false,
  children,
}: {
  search: string
  onSearchChange: (value: string) => void
  searchPlaceholder?: string
  onClear?: () => void
  showClear?: boolean
  children?: React.ReactNode
}) {
  const [draft, setDraft] = React.useState(search)
  const debounced = useDebouncedValue(draft, 300)
  const committed = React.useRef(search)

  React.useEffect(() => {
    if (debounced === committed.current) return
    committed.current = debounced
    onSearchChange(debounced)
  }, [debounced, onSearchChange])

  // Back/forward and "clear filters" change the URL underneath us.
  React.useEffect(() => {
    if (search === committed.current) return
    committed.current = search
    setDraft(search)
  }, [search])

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-64">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className="h-8 pl-8"
        />
      </div>

      {children}

      {showClear && onClear && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setDraft('')
            committed.current = ''
            onClear()
          }}
        >
          <X className="size-4" />
          Clear
        </Button>
      )}
    </div>
  )
}
