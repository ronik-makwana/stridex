import * as React from 'react'
import { NavLink, Outlet } from 'react-router'
import {
  Boxes,
  ChevronsUpDown,
  CreditCard,
  FolderTree,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Package,
  PanelLeft,
  PanelLeftClose,
  Layers,
  Settings,
  ShoppingCart,
  Tags,
  Users,
  Warehouse,
} from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SessionExpiredDialog } from '@/components/session-expired-dialog'

// `disabled` entries land in later phases. They stay visible so the shape of
// the app is obvious from day one, rather than a sidebar that grows weekly.
const NAV_SECTIONS = [
  {
    label: null,
    items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true }],
  },
  {
    label: 'Catalog',
    items: [
      { to: '/products', label: 'Products', icon: Package, disabled: true },
      { to: '/categories', label: 'Categories', icon: FolderTree },
      { to: '/brands', label: 'Brands', icon: Tags },
      { to: '/attributes', label: 'Attributes', icon: ListChecks },
      { to: '/variant-options', label: 'Variant options', icon: Layers },
      { to: '/collections', label: 'Collections', icon: Boxes, disabled: true },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to: '/inventory', label: 'Inventory', icon: Warehouse, disabled: true },
      { to: '/orders', label: 'Orders', icon: ShoppingCart, disabled: true },
      { to: '/payments', label: 'Payments', icon: CreditCard, disabled: true },
      { to: '/customers', label: 'Customers', icon: Users, disabled: true },
    ],
  },
  {
    label: 'Settings',
    items: [{ to: '/settings', label: 'Settings', icon: Settings, disabled: true }],
  },
] as const

const COLLAPSED_KEY = 'admin:sidebar-collapsed'

function initials(name: string | null, email: string) {
  if (name) {
    const parts = name.split(' ').filter(Boolean)
    return (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')
  }
  return email.slice(0, 2).toUpperCase()
}

export function AdminLayout() {
  const { user, logout } = useAuth()
  // Collapsed by default on narrow screens, where a 15rem rail eats the page.
  const [collapsed, setCollapsed] = React.useState(() => {
    const stored = localStorage.getItem(COLLAPSED_KEY)
    if (stored !== null) return stored === '1'
    return !window.matchMedia('(min-width: 768px)').matches
  })

  React.useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0')
  }, [collapsed])

  return (
    <div className="bg-muted/30 flex min-h-svh">
      <aside
        className={cn(
          'bg-sidebar text-sidebar-foreground flex shrink-0 flex-col border-r transition-[width] duration-200',
          collapsed ? 'w-16' : 'w-60',
        )}
      >
        <div
          className={cn(
            'flex h-14 items-center border-b',
            collapsed ? 'justify-center px-2' : 'justify-between px-4',
          )}
        >
          {!collapsed && <span className="text-sm font-semibold">StrideX</span>}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeft className="size-4" /> : <PanelLeftClose className="size-4" />}
          </Button>
        </div>

        <nav className={cn('flex-1 overflow-y-auto py-3', collapsed ? 'px-2' : 'px-3')}>
          {NAV_SECTIONS.map((section, index) => (
            <div key={section.label ?? index} className={cn(index > 0 && 'mt-5')}>
              {section.label &&
                (collapsed ? (
                  <div className="bg-border mx-2 mb-2 h-px" />
                ) : (
                  <p className="text-muted-foreground px-2 pb-1.5 text-xs font-medium tracking-wide uppercase">
                    {section.label}
                  </p>
                ))}
              <ul className="space-y-0.5">
                {section.items.map((item) => (
                  <li key={item.to}>
                    {'disabled' in item && item.disabled ? (
                      <span
                        title={collapsed ? item.label : 'Arrives in a later phase'}
                        className={cn(
                          'text-muted-foreground/50 flex cursor-not-allowed items-center gap-2.5 rounded-md py-1.5 text-sm',
                          collapsed ? 'justify-center px-0' : 'px-2',
                        )}
                      >
                        <item.icon className="size-4 shrink-0" />
                        {!collapsed && item.label}
                      </span>
                    ) : (
                      <NavLink
                        to={item.to}
                        end={'end' in item ? item.end : undefined}
                        title={collapsed ? item.label : undefined}
                        className={({ isActive }) =>
                          cn(
                            'flex items-center gap-2.5 rounded-md py-1.5 text-sm transition-colors',
                            collapsed ? 'justify-center px-0' : 'px-2',
                            isActive
                              ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                              : 'hover:bg-sidebar-accent/60',
                          )
                        }
                      >
                        <item.icon className="size-4 shrink-0" />
                        {!collapsed && item.label}
                      </NavLink>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className={cn('border-t py-3', collapsed ? 'px-2' : 'px-3')}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className={cn(
                  'h-auto w-full gap-2 py-2',
                  collapsed ? 'justify-center px-0' : 'justify-start px-2',
                )}
                title={collapsed ? (user?.fullName ?? user?.email) : undefined}
              >
                <span className="bg-primary text-primary-foreground flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold uppercase">
                  {user ? initials(user.fullName, user.email) : '—'}
                </span>
                {!collapsed && (
                  <>
                    <span className="min-w-0 flex-1 text-left">
                      <span className="block truncate text-sm font-medium">
                        {user?.fullName ?? 'Admin'}
                      </span>
                      <span className="text-muted-foreground block truncate text-xs">
                        {user?.email}
                      </span>
                    </span>
                    <ChevronsUpDown className="size-3.5 shrink-0 opacity-60" />
                  </>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-56">
              <DropdownMenuLabel className="font-normal">
                <p className="truncate text-sm font-medium">{user?.fullName ?? 'Admin'}</p>
                <p className="text-muted-foreground truncate text-xs">{user?.email}</p>
                <p className="text-muted-foreground mt-1 text-xs">{user?.role}</p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => void logout()}>
                <LogOut className="size-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      <main className="min-w-0 flex-1 p-6">
        <Outlet />
      </main>

      <SessionExpiredDialog />
    </div>
  )
}
