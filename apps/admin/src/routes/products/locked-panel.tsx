import type { LucideIcon } from 'lucide-react'
import { Lock } from 'lucide-react'

/**
 * A section that exists on the new-product page but cannot work yet.
 *
 * Media and variants both hang off a product id: an upload needs somewhere to
 * record the row, and generate matches against options the server has stored.
 * The alternative — holding uploads and generated SKUs in memory until a Create
 * button is pressed — loses all of it on one failed request.
 *
 * So the panels are shown rather than hidden. A page that grows two new
 * sections after saving reads as something having gone wrong the first time;
 * one that says what is coming and why does not.
 */
export function LockedPanel({
  icon: Icon,
  title,
  description,
  reason,
}: {
  icon: LucideIcon
  title: string
  description: string
  reason: string
}) {
  return (
    <section className="bg-card rounded-lg border">
      <header className="border-b px-5 py-3">
        <h2 className="text-muted-foreground text-sm font-semibold">{title}</h2>
        <p className="text-muted-foreground/80 mt-0.5 text-xs">{description}</p>
      </header>

      <div className="flex flex-col items-center justify-center gap-2 px-5 py-10 text-center">
        <div className="bg-muted text-muted-foreground flex size-9 items-center justify-center rounded-full">
          <Icon className="size-4" aria-hidden />
        </div>
        <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
          <Lock className="size-3.5" aria-hidden />
          {reason}
        </p>
      </div>
    </section>
  )
}
