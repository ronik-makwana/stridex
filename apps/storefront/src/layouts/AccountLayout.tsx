import { NavLink, Outlet, useNavigate } from 'react-router'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'

/**
 * The account's own chrome: a sub-nav on the left, the screen on the right.
 *
 * It is a layout rather than three unrelated pages because the customer thinks
 * of this as one place — "my account" — and because the nav is how they find
 * out the other screens exist at all. Sign out lives at the bottom of it, away
 * from the navigation, so it is never the thing a misclick finds.
 */
const LINKS = [
  { to: '/account/profile', label: 'Profile' },
  { to: '/account/addresses', label: 'Addresses' },
  { to: '/account/orders', label: 'Orders' },
]

export function AccountLayout() {
  const { logout, user } = useAuth()
  const navigate = useNavigate()

  const signOut = async () => {
    await logout()
    void navigate('/', { replace: true })
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="grid gap-10 md:grid-cols-[12rem_minmax(0,1fr)]">
        <aside className="md:sticky md:top-24 md:h-fit">
          {/* Whose account this is. On a shared laptop it is the difference
              between checking your own orders and somebody else's. */}
          {user && (
            <p className="text-muted-foreground mb-4 truncate text-xs">{user.email}</p>
          )}

          <nav className="flex gap-4 border-b md:flex-col md:gap-0 md:border-b-0">
            {LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  cn(
                    'py-2.5 text-sm transition-colors md:border-l md:pl-3',
                    isActive
                      ? 'text-foreground border-foreground border-b-2 md:border-b-0 md:border-l-2'
                      : 'text-muted-foreground hover:text-foreground border-transparent md:border-border',
                  )
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>

          <button
            type="button"
            onClick={() => void signOut()}
            className="text-muted-foreground hover:text-foreground mt-6 text-sm underline underline-offset-4"
          >
            Sign out
          </button>
        </aside>

        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
