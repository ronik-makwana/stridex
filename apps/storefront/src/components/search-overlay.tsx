import * as React from 'react'
import { Link, useNavigate } from 'react-router'
import { Search, X } from 'lucide-react'
import { useSuggest } from '@/features/catalog/queries'
import { formatMoney } from '@/lib/format'

/**
 * The header search. Suggestions come from `/search/suggest` — 5 products and
 * 3 categories, two cheap indexed reads with no facets or counts — while Enter
 * goes to `/search`, which is the full grid.
 *
 * Debounced at 200ms: the endpoint fires per keystroke otherwise, and a
 * suggestion that arrives after the customer has typed two more letters is
 * worse than one that arrives a beat later.
 */
function useDebounced<T>(value: T, delay = 200) {
  const [debounced, setDebounced] = React.useState(value)
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

export function SearchOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = React.useState('')
  const debounced = useDebounced(query)
  const { data, isFetching } = useSuggest(debounced)
  const navigate = useNavigate()
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (open) inputRef.current?.focus()
    else setQuery('')
  }, [open])

  // Escape closes it from anywhere, including while the input has focus.
  React.useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const trimmed = query.trim()
    if (!trimmed) return
    void navigate(`/search?q=${encodeURIComponent(trimmed)}`)
    onClose()
  }

  const hasResults = (data?.products.length ?? 0) + (data?.categories.length ?? 0) > 0

  return (
    <>
      <div className="bg-foreground/20 fixed inset-0 z-40 animate-overlay-in" onClick={onClose} />
      <div className="bg-background fixed inset-x-0 top-0 z-50 border-b">
        <div className="mx-auto max-w-[1400px] px-4 py-4 sm:px-6 lg:px-10">
          <form onSubmit={submit} className="flex items-center gap-3">
            <Search className="text-muted-foreground size-5 shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search for a shoe, a brand, a style"
              aria-label="Search"
              className="flex-1 bg-transparent py-2 text-base outline-none"
            />
            <button
              type="button"
              onClick={onClose}
              aria-label="Close search"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="size-5" />
            </button>
          </form>

          {debounced.trim().length >= 2 && (
            <div className="max-h-[60svh] overflow-y-auto pt-2 pb-4">
              {!hasResults && !isFetching ? (
                <p className="text-muted-foreground py-6 text-sm">
                  Nothing matches “{debounced}”.
                </p>
              ) : (
                <div className="grid gap-6 sm:grid-cols-[1fr_220px]">
                  <ul className="space-y-1">
                    {data?.products.map((product) => (
                      <li key={product.id}>
                        <Link
                          to={`/products/${product.slug}`}
                          onClick={onClose}
                          className="hover:bg-secondary flex items-center gap-3 rounded-md p-2"
                        >
                          <span className="bg-secondary relative block size-12 shrink-0 overflow-hidden">
                            {product.image && (
                              <img
                                src={product.image}
                                alt=""
                                className="absolute inset-0 h-full w-full object-cover"
                              />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            {product.brand && (
                              <span className="text-muted-foreground block text-xs uppercase">
                                {product.brand}
                              </span>
                            )}
                            <span className="block truncate text-sm">{product.title}</span>
                          </span>
                          <span className="text-sm tabular-nums">{formatMoney(product.price)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>

                  {(data?.categories.length ?? 0) > 0 && (
                    <div>
                      <h2 className="text-muted-foreground px-2 text-xs tracking-[0.1em] uppercase">
                        Categories
                      </h2>
                      <ul className="mt-2 space-y-1">
                        {data!.categories.map((category) => (
                          <li key={category.id}>
                            <Link
                              to={`/categories/${category.slug}`}
                              onClick={onClose}
                              className="hover:bg-secondary block rounded-md px-2 py-1.5 text-sm"
                            >
                              {category.name}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {query.trim() && (
                <button
                  type="button"
                  onClick={submit}
                  className="mt-2 px-2 text-sm underline underline-offset-4"
                >
                  See all results for “{query.trim()}”
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
