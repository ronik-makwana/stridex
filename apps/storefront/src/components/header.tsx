import * as React from 'react'
import { Link, NavLink, useLocation } from 'react-router'
import { Heart, Menu, Search, ShoppingBag, User } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { loginPathFor } from '@/lib/redirect'
import { cn } from '@/lib/utils'
import { Sheet, SheetClose, SheetContent, SheetTrigger } from '@/components/ui/sheet'

/**
 * Top-level nav. Static in Phase 11 by design: the real tree comes from
 * `GET /categories/tree` in Phase 13, and building a nav against an endpoint
 * that does not exist yet is exactly the "all endpoints first" mistake the
 * build order forbids. The hover mega-panel lands with the tree.
 *
 * `Sale` is a collection wearing a nav item — it points at a slug, not a
 * special page.
 */
const NAV_LINKS = [
  { label: 'Men', to: '/c/men' },
  { label: 'Women', to: '/c/women' },
  { label: 'Kids', to: '/c/kids' },
  { label: 'Sale', to: '/collections/sale' },
] as const

/**
 * Thin and borderless at rest, growing a hairline once the page moves — so a
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

function IconLink({
  to,
  label,
  children,
}: {
  to: string
  label: string
  children: React.ReactNode
}) {
  return (
    <Link
      to={to}
      aria-label={label}
      title={label}
      className="text-foreground/80 hover:text-foreground relative inline-flex size-10 items-center justify-center transition-colors"
    >
      {children}
    </Link>
  )
}

export function Header() {
  const scrolled = useScrolled()
  const { isAuthenticated } = useAuth()
  const location = useLocation()
  const [navOpen, setNavOpen] = React.useState(false)

  // Sending a guest to /login from the header must bring them back where they
  // were. `loginPathFor` builds the param; `safeRedirect` validates it on the
  // way out, so a hand-edited URL cannot leave the site.
  const accountHref = isAuthenticated
    ? '/account/orders'
    : loginPathFor(location.pathname, location.search)

  // A route change closes the drawer. Without this, tapping a category leaves
  // the drawer open over the page it just navigated to.
  React.useEffect(() => setNavOpen(false), [location.pathname])

  return (
    <header
      className={cn(
        'bg-background sticky top-0 z-40 transition-shadow',
        scrolled ? 'border-b' : 'border-b border-transparent',
      )}
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
            <div className="border-b px-6 py-5">
              <span className="wordmark text-base">StrideX</span>
            </div>
            {/*
              One flat level in Phase 11. Phase 13 turns this into a drill-in:
              tapping a parent slides its children in, one level at a time. An
              accordion showing all 24 categories at once is the thing to avoid.
            */}
            <nav className="flex flex-col px-2 py-4">
              {NAV_LINKS.map((link) => (
                <SheetClose key={link.to} asChild>
                  <NavLink
                    to={link.to}
                    className="hover:bg-secondary rounded-md px-4 py-3 text-base font-medium transition-colors"
                  >
                    {link.label}
                  </NavLink>
                </SheetClose>
              ))}
            </nav>
          </SheetContent>
        </Sheet>

        <Link to="/" className="wordmark shrink-0 text-lg lg:text-xl" aria-label="StrideX home">
          StrideX
        </Link>

        <nav className="ml-10 hidden items-center gap-8 lg:flex">
          {NAV_LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                cn(
                  'hover:text-foreground text-sm font-medium transition-colors',
                  isActive ? 'text-foreground' : 'text-foreground/70',
                )
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-0.5">
          <IconLink to="/search" label="Search">
            <Search className="size-5" />
          </IconLink>
          <IconLink to="/wishlist" label="Wishlist">
            <Heart className="size-5" />
          </IconLink>
          <IconLink to={accountHref} label={isAuthenticated ? 'Your account' : 'Sign in'}>
            <User className="size-5" />
          </IconLink>
          {/*
            No count yet. Phase 14 reads it from `useCart()` — which hides the
            local-vs-server split — so nothing here ever branches on `if (user)`,
            and a `storage` listener keeps a second tab in step.
          */}
          <IconLink to="/cart" label="Bag">
            <ShoppingBag className="size-5" />
          </IconLink>
        </div>
      </div>
    </header>
  )
}
