import * as React from 'react'
import { Link, NavLink, useLocation } from 'react-router'
import { ChevronLeft, ChevronRight, Heart, Menu, Search, ShoppingBag, User } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { useCategoryTree } from '@/features/catalog/queries'
import { useCart } from '@/features/cart/use-cart'
import { useWishlist } from '@/features/wishlist/use-wishlist'
import { loginPathFor } from '@/lib/redirect'
import { cn } from '@/lib/utils'
import { SearchOverlay } from '@/components/search-overlay'
import { Sheet, SheetClose, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import type { CategoryNode } from '@/types/api'

/**
 * Collections wearing nav items. They point at slugs rather than at special
 * pages, so what sits behind them is merchandised from the admin without a
 * deploy — and the order here is the order they appear, after the categories.
 */
const COLLECTION_LINKS = [
  { label: 'Sale', to: '/collections/sale' },
  { label: 'New Arrivals', to: '/collections/new-arrivals' },
]

/**
 * Thin and borderless at rest, growing a hairline once the page moves, so a
 * full-bleed hero meets the top of the window rather than a rule.
 */
function useScrolled(threshold = 8) {
  const [scrolled, setScrolled] = React.useState(false)
  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [threshold])
  return scrolled
}

/**
 * The count rides on the icon rather than beside it, and it is only ever a
 * number the server sent: `itemCount` is units in the cart, computed there, so
 * the badge cannot disagree with the subtotal (§21).
 */
function CountBadge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span
      className="bg-foreground text-background absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-4 tabular-nums"
      aria-hidden
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}

function IconButton({
  to,
  label,
  onClick,
  count = 0,
  children,
}: {
  to?: string
  label: string
  onClick?: () => void
  /** Rendered as a badge, and folded into the accessible name. */
  count?: number
  children: React.ReactNode
}) {
  const className =
    'text-foreground/80 hover:text-foreground relative inline-flex size-10 items-center justify-center transition-colors'
  const accessibleLabel = count > 0 ? `${label} (${count})` : label

  if (to) {
    return (
      <Link to={to} aria-label={accessibleLabel} title={label} className={className}>
        {children}
        <CountBadge count={count} />
      </Link>
    )
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={accessibleLabel}
      title={label}
      className={className}
    >
      {children}
      <CountBadge count={count} />
    </button>
  )
}

export function Header() {
  const scrolled = useScrolled()
  const { isAuthenticated } = useAuth()
  const location = useLocation()
  const { data: tree } = useCategoryTree()
  // Both are public reads: a guest's cart and wishlist live in localStorage and
  // are priced by the API, so the badges work signed out.
  const { itemCount } = useCart()
  const { count: wishlistCount } = useWishlist()
  const [navOpen, setNavOpen] = React.useState(false)
  const [searchOpen, setSearchOpen] = React.useState(false)
  const [hovered, setHovered] = React.useState<string | null>(null)

  const accountHref = isAuthenticated
    ? '/account'
    : loginPathFor(location.pathname, location.search)

  // A route change closes both, or tapping a category leaves the drawer open
  // over the page it just navigated to.
  React.useEffect(() => {
    setNavOpen(false)
    setSearchOpen(false)
    setHovered(null)
  }, [location.pathname, location.search])

  const roots = tree ?? []
  const openRoot = roots.find((root) => root.id === hovered) ?? null

  return (
    <header
      className={cn(
        'bg-background sticky top-0 z-40 transition-shadow',
        scrolled ? 'border-b' : 'border-b border-transparent',
      )}
      // On the wrapper, not on each link: moving the pointer from a nav item
      // down into the panel must not count as leaving.
      onMouseLeave={() => setHovered(null)}
    >
      <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-2 px-4 sm:px-6 lg:px-10">
        <Sheet open={navOpen} onOpenChange={setNavOpen}>
          <SheetTrigger
            aria-label="Open menu"
            className="text-foreground/80 hover:text-foreground -ml-2 inline-flex size-10 items-center justify-center transition-colors lg:hidden"
          >
            <Menu className="size-5" />
          </SheetTrigger>
          <SheetContent side="left" title="Menu" className="max-w-xs">
            <MobileNav roots={roots} />
          </SheetContent>
        </Sheet>

        <Link
          to="/"
          className="wordmark wordmark-boxed shrink-0 text-base lg:text-lg"
          aria-label="StrideX home"
        >
          StrideX
        </Link>

        <nav className="ml-10 hidden items-center gap-8 lg:flex">
          {roots.map((root) => (
            <NavLink
              key={root.id}
              to={`/categories/${root.slug}`}
              onMouseEnter={() => setHovered(root.id)}
              onFocus={() => setHovered(root.id)}
              className={({ isActive }) =>
                cn(
                  'hover:text-foreground py-5 text-sm font-medium transition-colors',
                  isActive || hovered === root.id ? 'text-foreground' : 'text-foreground/70',
                )
              }
            >
              {root.name}
            </NavLink>
          ))}
          {COLLECTION_LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              onMouseEnter={() => setHovered(null)}
              className={({ isActive }) =>
                cn(
                  'hover:text-foreground py-5 text-sm font-medium whitespace-nowrap transition-colors',
                  isActive ? 'text-foreground' : 'text-foreground/70',
                )
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-0.5">
          <IconButton label="Search" onClick={() => setSearchOpen(true)}>
            <Search className="size-5" />
          </IconButton>
          <IconButton to="/wishlist" label="Wishlist" count={wishlistCount}>
            <Heart className="size-5" />
          </IconButton>
          <IconButton to={accountHref} label={isAuthenticated ? 'Your account' : 'Sign in'}>
            <User className="size-5" />
          </IconButton>
          {/*
            A link, not a drawer trigger. The drawer opens on Add to cart; the
            icon goes to the page, so the cart is always reachable by URL and by
            the back button.
          */}
          <IconButton to="/cart" label="Cart" count={itemCount}>
            <ShoppingBag className="size-5" />
          </IconButton>
        </div>
      </div>

      {/*
        The mega-panel. The tree is two levels deep, so this is one flat column
        set rather than a cascade — nothing here needs to expand further.
      */}
      {openRoot && (openRoot.children?.length ?? 0) > 0 && (
        <div className="bg-background absolute inset-x-0 top-full hidden border-b border-t lg:block">
          <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 lg:px-10">
            <div className="grid grid-cols-3 gap-x-10 gap-y-2.5">
              {openRoot.children!.map((child) => (
                <Link
                  key={child.id}
                  to={`/categories/${child.slug}`}
                  className="text-foreground/75 hover:text-foreground flex items-baseline justify-between gap-4 py-1 text-sm transition-colors"
                >
                  <span>{child.name}</span>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {child.productCount}
                  </span>
                </Link>
              ))}
            </div>
            <Link
              to={`/categories/${openRoot.slug}`}
              className="mt-6 inline-block text-sm underline underline-offset-4"
            >
              Everything in {openRoot.name}
            </Link>
          </div>
        </div>
      )}

      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </header>
  )
}

/**
 * Drills in one level at a time rather than expanding an accordion. The tree is
 * 3 roots and 21 children — showing all 24 at once on a phone is the thing to
 * avoid.
 */
function MobileNav({ roots }: { roots: CategoryNode[] }) {
  const [openRoot, setOpenRoot] = React.useState<CategoryNode | null>(null)

  return (
    <>
      <div className="flex items-center gap-2 border-b px-6 py-5">
        {openRoot && (
          <button
            type="button"
            onClick={() => setOpenRoot(null)}
            aria-label="Back"
            className="text-muted-foreground hover:text-foreground -ml-2"
          >
            <ChevronLeft className="size-5" />
          </button>
        )}
        <span className="wordmark text-base">{openRoot ? openRoot.name : 'StrideX'}</span>
      </div>

      <nav className="flex flex-col overflow-y-auto px-2 py-4">
        {openRoot ? (
          <>
            <SheetClose asChild>
              <NavLink
                to={`/categories/${openRoot.slug}`}
                className="hover:bg-secondary rounded-md px-4 py-3 text-base font-medium"
              >
                Everything in {openRoot.name}
              </NavLink>
            </SheetClose>
            {openRoot.children?.map((child) => (
              <SheetClose asChild key={child.id}>
                <NavLink
                  to={`/categories/${child.slug}`}
                  className="hover:bg-secondary flex items-center justify-between rounded-md px-4 py-3 text-base"
                >
                  <span>{child.name}</span>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {child.productCount}
                  </span>
                </NavLink>
              </SheetClose>
            ))}
          </>
        ) : (
          <>
            {roots.map((root) =>
              (root.children?.length ?? 0) > 0 ? (
                <button
                  key={root.id}
                  type="button"
                  onClick={() => setOpenRoot(root)}
                  className="hover:bg-secondary flex items-center justify-between rounded-md px-4 py-3 text-left text-base font-medium"
                >
                  <span>{root.name}</span>
                  <ChevronRight className="text-muted-foreground size-4" />
                </button>
              ) : (
                <SheetClose asChild key={root.id}>
                  <NavLink
                    to={`/categories/${root.slug}`}
                    className="hover:bg-secondary rounded-md px-4 py-3 text-base font-medium"
                  >
                    {root.name}
                  </NavLink>
                </SheetClose>
              ),
            )}
            {COLLECTION_LINKS.map((link) => (
              <SheetClose asChild key={link.to}>
                <NavLink
                  to={link.to}
                  className="hover:bg-secondary rounded-md px-4 py-3 text-base font-medium"
                >
                  {link.label}
                </NavLink>
              </SheetClose>
            ))}
          </>
        )}
      </nav>
    </>
  )
}
