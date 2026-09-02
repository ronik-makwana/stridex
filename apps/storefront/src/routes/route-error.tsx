import { isRouteErrorResponse, Link, useRouteError } from 'react-router'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * What renders when a route throws instead of returning markup.
 *
 * Before this, a render error was a blank white page with no route out — the
 * customer's only move was the back button, and anything they had typed was
 * gone either way.
 *
 * **Route splitting made this load-bearing rather than defensive.** Chunks are
 * fetched on demand and named by content hash, so a deploy while somebody has
 * the site open replaces the files their tab still expects. Their next
 * navigation fetches a URL that no longer exists and React throws. That is not
 * an edge case, it is what every deploy does to every open tab, and the fix is
 * the reload below rather than anything the customer could work out themselves.
 */
export function RouteError() {
  const error = useRouteError()

  /**
   * A failed dynamic import, told apart from a genuine bug because the two need
   * opposite advice: reloading fixes a stale chunk and achieves nothing against
   * a real exception, and telling everyone to reload trains people to ignore it.
   *
   * Matched on message text because that is all the browser gives us — there is
   * no typed error for this, and the wording differs per engine, hence three.
   */
  const message = error instanceof Error ? error.message : ''
  const isStaleChunk =
    /dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
      message,
    )

  if (isStaleChunk) {
    return (
      <Shell
        title="This page needs a refresh"
        body="The site was updated while you had it open. One reload and you are on the current version."
        action={
          <Button size="lg" onClick={() => window.location.reload()}>
            <RefreshCw />
            Reload the page
          </Button>
        }
      />
    )
  }

  // A 404 thrown by a loader reads as a missing page, not as a crash.
  if (isRouteErrorResponse(error) && error.status === 404) {
    return (
      <Shell
        title="We could not find that"
        body="The page may have moved, or the link may be wrong."
        action={
          <Button asChild size="lg">
            <Link to="/">Go to the shop</Link>
          </Button>
        }
      />
    )
  }

  return (
    <Shell
      title="Something went wrong"
      body="This is on us, not you. Nothing in your cart or your account has been affected."
      action={
        <Button asChild size="lg">
          <Link to="/">Go to the shop</Link>
        </Button>
      }
    />
  )
}

function Shell({ title, body, action }: { title: string; body: string; action: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
      <h1 className="text-xl">{title}</h1>
      <p className="text-muted-foreground mt-2 text-sm">{body}</p>
      <div className="mt-6">{action}</div>
    </div>
  )
}
