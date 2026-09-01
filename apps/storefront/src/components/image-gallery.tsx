import * as React from 'react'
import { cn } from '@/lib/utils'
import type { ProductImage } from '@/types/api'

/**
 * Cover image with the thumbnail strip *underneath* it — not beside it. Settled
 * with the design direction: a side rail steals width from the image on the one
 * screen where the picture is the product.
 *
 * The strip is hidden entirely when there is one image. 46 products in the
 * catalogue have exactly one, and a lone thumbnail duplicating the picture
 * directly above it reads as a bug rather than a control.
 *
 * There is no lightbox and no overflow tile: no product has more than five
 * images, so the strip always fits.
 */
export function ImageGallery({
  images,
  title,
  /** Variant-driven image swap. Null across the catalogue today — see below. */
  activeMediaId,
}: {
  images: ProductImage[]
  title: string
  activeMediaId?: string | null
}) {
  const [index, setIndex] = React.useState(0)

  // Reset when the product changes, or navigating between two products leaves
  // the strip pointing at an index the new one may not have.
  React.useEffect(() => setIndex(0), [title])

  /*
   * "Picking a colour swaps the gallery" works through this. Every variant in
   * the catalogue currently has `mediaId: null`, because nothing in admin
   * assigns media to a variant yet — so this is inert today and starts working
   * the moment that lands, with no change here.
   */
  React.useEffect(() => {
    if (!activeMediaId) return
    const found = images.findIndex((image) => image.id === activeMediaId)
    if (found >= 0) setIndex(found)
  }, [activeMediaId, images])

  if (images.length === 0) {
    return (
      <div className="bg-secondary aspect-[3/2] w-full" role="img" aria-label={`${title} — no image`} />
    )
  }

  const active = images[Math.min(index, images.length - 1)]!

  return (
    <div>
      {/*
        3:2, not 1:1.

        Every image in the catalogue is a landscape photograph letterboxed onto
        a square white canvas — the file is 1000x1000, the picture inside it is
        1000x667. A square frame therefore renders correctly and still shows a
        band of white above and below the photo, which against a white page
        reads as a mysterious gap rather than as part of the image.

        Matching the frame to the content's own ratio lets `object-cover` crop
        those bands away exactly. The real fix is to re-process the source
        images so the photo fills the file; until then this is where the crop
        happens, and it is one constant to change afterwards.
      */}
      <div className="bg-secondary relative aspect-[3/2] w-full overflow-hidden">
        <img
          src={active.url}
          // Falls back to the title only when the admin left alt blank. An
          // empty alt on a product image is a missing description, not a
          // decorative flourish.
          alt={active.altText ?? title}
          /*
           * `absolute inset-0` rather than `h-full w-full`.
           *
           * Tailwind's preflight sets `img { height: auto }`, and a source that
           * is not square then renders at its intrinsic ratio inside the square
           * frame — leaving a band of `bg-secondary` above and below the
           * picture that reads, against a white page, as a mysterious gap
           * between the heading and the image. Absolute positioning takes the
           * image out of that negotiation entirely: it fills the frame at every
           * source ratio, and `object-cover` decides what gets cropped.
           */
          className="absolute inset-0 h-full w-full object-cover"
          // The cover is the largest thing above the fold, so it is the one
          // image on the page that must not be lazy.
          loading="eager"
          fetchPriority="high"
        />
      </div>

      {images.length > 1 && (
        <div
          /*
           * Always five columns, never `flex` with fixed-width thumbs.
           *
           * Five is the catalogue's real ceiling, so a five-image product fills
           * the strip edge to edge and lines up exactly with the image above it.
           * Fewer images leave the trailing cells empty rather than stretching
           * the thumbs — a two-image product with 50%-wide thumbnails looks
           * like a second gallery, and thumbnail size would then change from
           * product to product for no reason the customer can see.
           */
          className="mt-4 grid grid-cols-5 gap-2"
          role="group"
          aria-label="Product images"
        >
          {images.map((image, i) => (
            <button
              key={image.id}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Image ${i + 1} of ${images.length}`}
              aria-current={i === index}
              className="group cursor-pointer"
            >
              <span className="bg-secondary relative block aspect-[3/2] overflow-hidden">
                <img
                  src={image.url}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                  loading="lazy"
                />
              </span>
              {/*
                The selected thumbnail is marked with a rule beneath it, not a
                box around it. A border box on a square image reads as a second
                frame and fights the grid; an underline is the editorial move.
              */}
              <span
                className={cn(
                  'mt-1.5 block h-px w-full transition-colors',
                  i === index ? 'bg-foreground' : 'bg-transparent group-hover:bg-border',
                )}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
