import * as React from 'react'
import { Plus, X } from 'lucide-react'
import { useTags } from '@/features/tags/queries'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'

/** How many existing tags the list offers before the operator narrows it. */
const MAX_SUGGESTIONS = 10

/**
 * The client's copy of the server's slug rule, and the only reason it exists:
 * 'Sale' and 'sale' are one tag, so typing the second when the first is already
 * on the product has to be a no-op rather than a chip that vanishes on save.
 */
const key = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

/**
 * Chips plus a typeahead. Tags have no management screen — one is created by
 * naming it here and disappears when the last product drops it — so this input
 * is the whole feature, and it has to do both jobs at once: reuse a tag that
 * exists, and invent one that does not, without the operator having to know
 * which of the two they are doing.
 */
export function TagInput({
  value,
  onChange,
  id = 'tags',
  label = 'Tags',
  max = 30,
  error,
}: {
  value: string[]
  onChange: (next: string[]) => void
  id?: string
  label?: string
  max?: number
  error?: string
}) {
  const { data: tags } = useTags()
  const [draft, setDraft] = React.useState('')
  const [open, setOpen] = React.useState(false)
  const [active, setActive] = React.useState(0)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const taken = React.useMemo(() => new Set(value.map(key)), [value])
  const term = draft.trim()

  /**
   * Ordered by use before it is filtered, so an empty input opens on the tags
   * this catalogue actually uses rather than on whatever sorts first.
   */
  const suggestions = React.useMemo(() => {
    const needle = term.toLowerCase()
    return (tags ?? [])
      .filter((tag) => !taken.has(tag.slug) && tag.name.toLowerCase().includes(needle))
      .slice(0, MAX_SUGGESTIONS)
  }, [tags, taken, term])

  // The typed text is only worth offering when it is not already one of the
  // suggestions — otherwise the list shows the same word twice.
  const canCreate = term.length > 0 && !taken.has(key(term)) && key(term).length > 0
  const exactSuggestion = suggestions.some((tag) => key(tag.name) === key(term))
  const showCreate = canCreate && !exactSuggestion

  /**
   * What exists comes first and creating comes last, because that is the order
   * the decision is made in: an operator types 'wat' to find 'waterproof', not
   * to invent a second spelling of it. Offering Create at the top is how
   * duplicate tags get made by accident.
   */
  const options: ({ kind: 'tag'; tag: (typeof suggestions)[number] } | { kind: 'create' })[] = [
    ...suggestions.map((tag) => ({ kind: 'tag' as const, tag })),
    ...(showCreate ? [{ kind: 'create' as const }] : []),
  ]

  const full = value.length >= max

  /**
   * Takes a list, not a name. Tags arrive pasted from a spreadsheet as often as
   * they are typed — 'sale, summer, outlet' — and splitting here rather than
   * only on the comma key means a paste behaves the same as typing it.
   *
   * A part that slugifies to nothing is dropped rather than stored: the server
   * would reject it, and there is nothing to tell the operator that they did
   * not already know from looking at what they typed.
   */
  const add = (input: string) => {
    const parts = input.split(',').map((part) => part.trim()).filter(Boolean)
    const next = [...value]
    const seen = new Set(next.map(key))

    for (const part of parts) {
      if (next.length >= max) break
      const slug = key(part)
      if (!slug || seen.has(slug)) continue
      seen.add(slug)
      next.push(part)
    }

    if (next.length !== value.length) onChange(next)
    setDraft('')
    setActive(0)
  }

  const remove = (index: number) => onChange(value.filter((_, i) => i !== index))

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    // Comma is a separator, not a character — pasting 'sale, summer, outlet'
    // is how a list of tags usually arrives.
    if (event.key === 'Enter' || event.key === ',' || event.key === 'Tab') {
      // `active` is 1-based: 0 means nothing is highlighted, so Enter commits
      // whatever was typed rather than the first row of a list the operator
      // never moved through.
      const highlighted = open && active > 0 ? options[active - 1] : undefined
      const picked = highlighted?.kind === 'tag' ? highlighted.tag : null
      if (event.key === 'Tab' && !term && !picked) return
      // Enter inside a form would submit it, and the operator meant "add this tag".
      event.preventDefault()
      add(picked ? picked.name : term)
      return
    }
    if (event.key === 'Backspace' && !draft && value.length > 0) {
      remove(value.length - 1)
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActive((current) => Math.min(current + 1, options.length))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((current) => Math.max(current - 1, 0))
      return
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      setOpen(false)
    }
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>

      {/* The wrapper carries the focus ring, so chips and input read as one control. */}
      <div
        className={cn(
          'border-input dark:bg-input/30 flex flex-wrap items-center gap-1.5 rounded-md border px-2 py-1.5 shadow-xs',
          'focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]',
          error && 'border-destructive',
        )}
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((tag, index) => (
          <Badge key={`${tag}-${index}`} variant="secondary" className="gap-1 py-1 pr-1">
            {tag}
            <button
              type="button"
              aria-label={`Remove ${tag}`}
              className="hover:bg-background/60 rounded-sm p-0.5"
              onClick={(event) => {
                event.stopPropagation()
                remove(index)
              }}
            >
              <X className="size-3" />
            </button>
          </Badge>
        ))}

        <div className="relative min-w-32 flex-1">
          <input
            id={id}
            ref={inputRef}
            value={draft}
            autoComplete="off"
            disabled={full}
            aria-invalid={Boolean(error)}
            placeholder={
              full ? `${max} tags is the limit` : value.length === 0 ? 'Add a tag' : undefined
            }
            className="placeholder:text-muted-foreground w-full bg-transparent py-0.5 text-sm outline-none disabled:cursor-not-allowed"
            onChange={(event) => {
              setDraft(event.target.value)
              setOpen(true)
              setActive(0)
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            // Committed rather than discarded: a typed tag that disappears
            // because the operator clicked Save instead of pressing Enter is
            // the one bug every tag input has.
            onBlur={() => {
              setOpen(false)
              if (term) add(term)
            }}
          />

          {/*
            Opens on click with the catalogue's most-used tags already listed,
            and stays open after each pick: tagging a product means adding
            three or four, and a list that closed on the first would mean
            re-opening it for every one.
          */}
          {open && options.length > 0 && (
            <div className="bg-popover absolute top-full left-0 z-50 mt-1.5 max-h-64 w-56 overflow-y-auto rounded-md border p-1 shadow-md">
              {options.map((option, index) =>
                option.kind === 'tag' ? (
                  <button
                    key={option.tag.id}
                    type="button"
                    // onMouseDown, not onClick: blur fires first and would close
                    // the list out from under the pointer.
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => add(option.tag.name)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm',
                      active === index + 1 ? 'bg-accent text-accent-foreground' : 'hover:bg-accent',
                    )}
                  >
                    <span className="truncate">{option.tag.name}</span>
                    {/* How many products already wear it — the difference
                        between the house tag and last month's typo. */}
                    <span className="text-muted-foreground text-xs">{option.tag.productCount}</span>
                  </button>
                ) : (
                  <button
                    key="__create__"
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => add(term)}
                    className={cn(
                      'flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-left text-sm',
                      // Separated when it follows matches, so 'create a new one'
                      // never reads as another search result.
                      suggestions.length > 0 && 'mt-1 border-t pt-2',
                      active === index + 1 ? 'bg-accent text-accent-foreground' : 'hover:bg-accent',
                    )}
                  >
                    <Plus className="text-muted-foreground size-3.5" />
                    <span className="text-muted-foreground">Create</span>
                    <span className="truncate font-medium">{term}</span>
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      </div>

      {error ? (
        <p className="text-destructive text-sm">{error}</p>
      ) : (
        <p className="text-muted-foreground text-xs">
          Enter or comma adds one. A tag with no products left on it is deleted.
        </p>
      )}
    </div>
  )
}
