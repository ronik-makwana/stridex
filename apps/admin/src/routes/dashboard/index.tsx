import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Deliberately empty. Phase 0 is done when you can sign in, land here, and
 * survive a refresh — the numbers arrive in phase 9.
 */
export default function DashboardPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold tracking-tight">Dashboard</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Foundation is in place</CardTitle>
          <CardDescription>
            Auth, the refresh interceptor, guards, the layout and the shared list components are
            working. Brands is live; the rest of the catalog lands in the next phases.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          <ul className="list-inside list-disc space-y-1">
            <li>Phase 2 — attributes and variant options</li>
            <li>Phase 3 — the category tree</li>
            <li>Phase 4 and 5 — products, media and variants</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
