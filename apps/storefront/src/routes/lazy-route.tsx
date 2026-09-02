import * as React from 'react'
import { Spinner } from '@/components/ui/spinner'

/**
 * Wraps a route module in `React.lazy` plus its own Suspense boundary.
 *
 * Per route rather than one boundary at the root, and that is the whole point:
 * a single `<Suspense>` around the root Outlet would blank the header, nav and
 * footer every time somebody moved between pages. Scoped here, the chrome stays
 * and only the page area waits.
 *
 * The fallback is deliberately quiet. A chunk resolves in milliseconds on any
 * warm connection, and a full-page spinner that flashes for 80ms reads as a
 * glitch rather than as progress — so this is a small centred spinner holding
 * roughly a screen of height, not a skeleton of a page we do not know yet.
 */
export function lazyRoute(load: () => Promise<{ default: React.ComponentType }>) {
  const Lazy = React.lazy(load)

  return function LazyRoute() {
    return (
      <React.Suspense fallback={<RouteFallback />}>
        <Lazy />
      </React.Suspense>
    )
  }
}

function RouteFallback() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center" role="status" aria-label="Loading">
      <Spinner className="text-muted-foreground size-5" />
    </div>
  )
}
