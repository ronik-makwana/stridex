import { Link } from 'react-router'
import { Button } from '@/components/ui/button'

export default function NotFoundPage() {
  return (
    <div className="mx-auto flex min-h-[60svh] max-w-md flex-col items-center justify-center px-4 text-center">
      <p className="text-muted-foreground text-xs tracking-[0.18em] uppercase">404</p>
      <h1 className="mt-3 text-2xl">We cannot find that page</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        {/*
          The same page an archived product resolves to. A non-ACTIVE record is a
          404 and not a 403 — telling someone a page exists but is hidden
          confirms the catalogue to anyone guessing slugs (§18).
        */}
        The link may be old, or the product may no longer be for sale.
      </p>
      <Button asChild size="lg" className="mt-6">
        <Link to="/">Back to the shop</Link>
      </Button>
    </div>
  )
}
