import * as React from 'react'
import { useNavigate } from 'react-router'
import { Search } from 'lucide-react'
import { useAdminSearch } from '@/features/dashboard/queries'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import type { SearchHit } from '@/types/api'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

/**
 * ⌘K. A jump-to, not a search page: five products, five orders, five customers,
 * and the answer is usually the first row. Anything beyond that is a list the
 * operator should be looking at properly, which is what Enter on a section
 * header would be for — deliberately not built, because the filtered lists
 * already exist and are one click away.
 */
export function CommandPalette() {
  const navigate = useNavigate()
  const [open, setOpen] = React.useState(false)
  const [term, setTerm] = React.useState('')
  const [active, setActive] = React.useState(0)
  const debounced = useDebouncedValue(term.trim(), 200)
  const { data, isFetching } = useAdminSearch(debounced)

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Cmd on a Mac, Ctrl everywhere else — and `/` for people who came from
      // a terminal.
      if ((event.key === 'k' && (event.metaKey || event.ctrlKey)) || (event.key === '/' && event.target === document.body)) {
        event.preventDefault()
        setOpen((current) => !current)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  React.useEffect(() => {
    if (open) {
      setTerm('')
      setActive(0)
    }
  }, [open])

  const groups: { label: string; hits: SearchHit[] }[] = [
    { label: 'Products', hits: data?.products ?? [] },
    { label: 'Orders', hits: data?.orders ?? [] },
    { label: 'Customers', hits: data?.customers ?? [] },
  ].filter((group) => group.hits.length > 0)

  const flat = groups.flatMap((group) => group.hits)

  const go = (hit: SearchHit) => {
    setOpen(false)
    void navigate(hit.to)
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((current) => Math.min(current + 1, flat.length - 1))
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((current) => Math.max(current - 1, 0))
    }
    if (event.key === 'Enter' && flat[active]) {
      event.preventDefault()
      go(flat[active])
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">
          Jump to a product, order or customer.
        </DialogDescription>

        <div className="flex items-center gap-2 border-b px-4">
          <Search className="text-muted-foreground size-4 shrink-0" />
          <Input
            autoFocus
            value={term}
            onChange={(event) => {
              setTerm(event.target.value)
              setActive(0)
            }}
            onKeyDown={onKeyDown}
            placeholder="Search products, orders and customers"
            className="border-0 shadow-none focus-visible:ring-0"
          />
          {isFetching && <Spinner />}
        </div>

        <div className="max-h-80 overflow-y-auto p-2">
          {debounced.length < 2 ? (
            <p className="text-muted-foreground px-3 py-6 text-center text-sm">
              Type at least two characters.
            </p>
          ) : flat.length === 0 ? (
            <p className="text-muted-foreground px-3 py-6 text-center text-sm">
              Nothing matches “{debounced}”.
            </p>
          ) : (
            groups.map((group) => (
              <div key={group.label} className="mb-1">
                <p className="text-muted-foreground px-3 py-1.5 text-xs tracking-[0.08em] uppercase">
                  {group.label}
                </p>
                {group.hits.map((hit) => {
                  const index = flat.indexOf(hit)
                  return (
                    <button
                      key={hit.id}
                      type="button"
                      onMouseEnter={() => setActive(index)}
                      onClick={() => go(hit)}
                      className={cn(
                        'flex w-full items-center justify-between gap-3 rounded-sm px-3 py-2 text-left text-sm',
                        index === active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
                      )}
                    >
                      <span className="truncate">{hit.label}</span>
                      <span className="text-muted-foreground shrink-0 text-xs">{hit.hint}</span>
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
