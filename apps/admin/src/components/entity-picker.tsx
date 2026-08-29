import * as React from 'react'
import { ExternalLink, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

export type PickerItem = {
  id: string
  label: string
  /** The right-hand hint — an attribute's type, an option's value count. */
  hint?: string
  disabled?: boolean
}

/**
 * "Add attribute" and "Add option" both need the same thing: search a list,
 * pick one, and be able to create a new one without losing the page.
 *
 * A dialog rather than a dropdown. A dropdown's typeahead fights a search input
 * inside it — Radix moves focus on every keystroke — and this list is long
 * enough that searching is the normal way to use it, not the fallback.
 */
export function EntityPicker({
  open,
  onOpenChange,
  title,
  description,
  searchPlaceholder = 'Search',
  items,
  onPick,
  emptyTitle = 'Nothing left to add',
  emptyDescription,
  footer,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  searchPlaceholder?: string
  items: PickerItem[]
  onPick: (id: string) => void
  emptyTitle?: string
  emptyDescription?: string
  footer?: React.ReactNode
}) {
  const [query, setQuery] = React.useState('')

  // Reopening should not inherit the last search.
  React.useEffect(() => {
    if (open) setQuery('')
  }, [open])

  const term = query.trim().toLowerCase()
  const filtered = term
    ? items.filter((item) => item.label.toLowerCase().includes(term))
    : items

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100svh-8rem)] flex-col gap-0 p-0">
        <DialogHeader className="border-b py-4 pr-12 pl-6">
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : (
            // Radix warns without one, and a screen reader announcing an empty
            // description is the intent here.
            <DialogDescription className="sr-only">{title}</DialogDescription>
          )}
        </DialogHeader>

        <div className="border-b px-6 py-3">
          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="h-9 pl-8"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <p className="text-sm font-medium">{term ? 'No matches' : emptyTitle}</p>
              {(term ? 'Try a different term.' : emptyDescription) && (
                <p className="text-muted-foreground mt-1 text-sm">
                  {term ? 'Try a different term.' : emptyDescription}
                </p>
              )}
            </div>
          ) : (
            <ul className="py-1">
              {filtered.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    disabled={item.disabled}
                    onClick={() => {
                      onPick(item.id)
                      onOpenChange(false)
                    }}
                    className="hover:bg-accent flex w-full items-center justify-between gap-3 px-6 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="min-w-0 truncate font-medium">{item.label}</span>
                    {item.hint && (
                      <span className="text-muted-foreground shrink-0 text-xs uppercase">
                        {item.hint}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {footer && <div className="border-t px-6 py-3">{footer}</div>}
      </DialogContent>
    </Dialog>
  )
}

/**
 * The "create one instead" line every picker ends with. It opens in a new tab
 * on purpose: the editor behind it usually has unsaved changes, and navigating
 * away to create one attribute is how an afternoon's work disappears.
 */
export function PickerFooterLink({ label, to }: { label: string; to: string }) {
  return (
    <Button variant="ghost" size="sm" asChild className="w-full justify-start">
      <a href={to} target="_blank" rel="noreferrer">
        <ExternalLink className="size-4" />
        {label}
      </a>
    </Button>
  )
}
