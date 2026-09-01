import { Link } from 'react-router'
import { Button } from '@/components/ui/button'

/**
 * A placeholder, and deliberately a thin one. The real home page is Phase 18,
 * built last on purpose: it is merchandising, and every component it needs —
 * product card, carousel, collection tile — is made by Phases 12 to 14. Filling
 * it now would mean inventing a grid that the category page then replaces.
 *
 * What it does do is prove the shell: header, footer, type scale and tokens all
 * render here before a single catalog endpoint exists.
 */
export default function HomePage() {
  return (
    <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10">
      <section className="flex min-h-[60svh] flex-col justify-center py-20">
        <p className="text-muted-foreground text-xs tracking-[0.18em] uppercase">New season</p>
        <h1 className="mt-4 max-w-3xl text-4xl leading-[1.05] sm:text-5xl lg:text-6xl">
          Built for the long way round.
        </h1>
        <p className="text-muted-foreground mt-5 max-w-md text-base">
          A catalogue of 210 pairs across 27 brands is loaded and waiting. The storefront that
          renders it is being built phase by phase.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link to="/categories/men">Shop men</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/categories/women">Shop women</Link>
          </Button>
        </div>
      </section>
    </div>
  )
}
