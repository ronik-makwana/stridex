import { Link } from 'react-router'

/**
 * Static by design. Every link here points at a route that either exists now or
 * is built by a later phase — none of it needs an endpoint, which is why the
 * footer can land in Phase 11 while the header's category tree cannot.
 */
const COLUMNS = [
  {
    heading: 'Shop',
    links: [
      { label: 'Men', to: '/categories/men' },
      { label: 'Women', to: '/categories/women' },
      { label: 'Kids', to: '/categories/kids' },
      { label: 'Sale', to: '/collections/sale' },
    ],
  },
  {
    heading: 'Help',
    links: [
      { label: 'Shipping', to: '/help/shipping' },
      { label: 'Returns', to: '/help/returns' },
      { label: 'Size guide', to: '/help/size-guide' },
      { label: 'Contact', to: '/help/contact' },
    ],
  },
  {
    heading: 'About',
    links: [
      { label: 'Our story', to: '/about' },
      { label: 'Stores', to: '/stores' },
      { label: 'Careers', to: '/careers' },
    ],
  },
] as const

export function Footer() {
  return (
    <footer className="mt-24 border-t">
      <div className="mx-auto max-w-[1400px] px-4 py-14 sm:px-6 lg:px-10">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          {COLUMNS.map((column) => (
            <div key={column.heading}>
              <h2 className="text-muted-foreground text-xs font-medium tracking-[0.14em] uppercase">
                {column.heading}
              </h2>
              <ul className="mt-4 space-y-2.5">
                {column.links.map((link) => (
                  <li key={link.to}>
                    <Link
                      to={link.to}
                      className="text-foreground/75 hover:text-foreground text-sm transition-colors"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div>
            <h2 className="text-muted-foreground text-xs font-medium tracking-[0.14em] uppercase">
              Newsletter
            </h2>
            <p className="text-muted-foreground mt-4 text-sm">
              New arrivals and the occasional markdown. No more than that.
            </p>
            {/*
              Deliberately inert until there is somewhere to send an address.
              A field that silently discards what a customer types is worse than
              one that says it is not ready, so it says so.
            */}
            <p className="text-muted-foreground/70 mt-4 text-xs">Sign-up opens soon.</p>
          </div>
        </div>

        <div className="text-muted-foreground mt-14 flex flex-col gap-3 border-t pt-6 text-xs sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} StrideX</p>
          <p className="tracking-wide uppercase">Visa · Mastercard · UPI · Cash on delivery</p>
        </div>
      </div>
    </footer>
  )
}
