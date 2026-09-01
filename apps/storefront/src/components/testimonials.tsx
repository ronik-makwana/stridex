import { Stars } from '@/components/star-rating'
import type { HomePayload } from '@/types/api'

/**
 * Quotes a merchandiser chose to publish — **not** product reviews.
 *
 * The two look alike and are not: a review is one customer's opinion of one
 * product, tied to a purchase and belonging on that product's page, where the
 * two-star ones sit beside it. A testimonial is front-page copy with a name on
 * it, and it can come from a press cutting or an email as easily as from the
 * review form.
 *
 * Renders nothing until there is something to say. A heading over one lonely
 * quote reads worse than silence.
 */
export function Testimonials({ quotes }: { quotes: HomePayload['testimonials'] }) {
  if (quotes.length === 0) return null

  return (
    <section className="mt-16 border-t pt-14">
      <h2 className="text-xs tracking-[0.14em] uppercase">What customers say</h2>

      <div className="mt-8 grid gap-10 sm:grid-cols-2 lg:grid-cols-3">
        {quotes.map((quote) => (
          <figure key={quote.id} className="flex flex-col">
            {/* Optional, because an invented number of stars is worse than none. */}
            {quote.rating !== null && <Stars value={quote.rating} size={14} />}

            {/* The words carry the section, so they are set at reading size
                rather than shrunk to fit a card. */}
            <blockquote className="mt-4 flex-1 text-lg leading-snug">“{quote.quote}”</blockquote>

            <figcaption className="mt-4 flex items-center gap-3">
              {quote.imageUrl && (
                <img
                  src={quote.imageUrl}
                  alt=""
                  className="size-10 shrink-0 rounded-full object-cover"
                  loading="lazy"
                />
              )}
              <span className="text-sm">
                {quote.authorName}
                {quote.authorRole && (
                  <span className="text-muted-foreground block text-xs">{quote.authorRole}</span>
                )}
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  )
}
