import * as React from 'react'
import { cn } from '@/lib/utils'

/** The logo square, falling back to the initial when there is no image. */
export function BrandLogo({
  name,
  logoUrl,
  className,
}: {
  name: string
  logoUrl: string | null
  className?: string
}) {
  const [broken, setBroken] = React.useState(false)

  // A URL that 404s must fall back rather than leave a broken-image glyph.
  React.useEffect(() => setBroken(false), [logoUrl])

  return (
    <span
      className={cn(
        'bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md border text-xs font-semibold uppercase',
        className,
      )}
      aria-hidden
    >
      {logoUrl && !broken ? (
        <img
          src={logoUrl}
          alt=""
          loading="lazy"
          onError={() => setBroken(true)}
          className="size-full object-contain"
        />
      ) : (
        (name.trim()[0] ?? '?')
      )}
    </span>
  )
}
