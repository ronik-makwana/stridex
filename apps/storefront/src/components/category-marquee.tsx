import { Link } from 'react-router'
import { cn } from '@/lib/utils'

/**
 * Places worth starting from, moving past a photograph.
 *
 * It is a marquee rather than a grid because there are forty-two of them: a
 * grid would be a wall of chips demanding to be read, while three drifting rows
 * are read the way a shelf is — glanced at until something catches. Rows run in
 * alternate directions so the eye has somewhere to rest, and everything pauses
 * on hover so a chip somebody is reaching for stops running away.
 *
 * Every chip is a real link. If the animation never starts — reduced motion,
 * an old browser, JavaScript still parsing — what remains is a list of links,
 * which is what it was all along.
 */
export type MarqueeLink = { id: string; label: string; to: string }

const ROWS = 3
/** Seconds for one full pass. The longest row is slowest, so all three drift alike. */
const DURATION = [46, 38, 42]

export function CategoryMarquee({
  title,
  image,
  links,
}: {
  title: string
  image: string | null
  links: MarqueeLink[]
}) {
  if (links.length === 0) return null

  // Dealt round-robin rather than sliced into thirds: the categories arrive
  // before the collections, and three contiguous slices would put every
  // collection in the bottom row.
  const rows: MarqueeLink[][] = Array.from({ length: ROWS }, () => [])
  links.forEach((link, index) => rows[index % ROWS]!.push(link))

  return (
    /*
     * A full screen, like the hero — and `svh` for the same reason: on a phone
     * `100vh` is measured with the browser chrome retracted, so the bottom row
     * of chips would spend the first scroll behind the address bar.
     *
     * No header subtraction here, unlike the hero: by the time this band is on
     * screen the sticky header is over the section above it, not stealing from
     * this one.
     */
    <section className="relative mt-16 flex h-svh items-center overflow-hidden">
      {image ? (
        <img
          src={image}
          alt=""
          /*
           * Scaled past cover below `sm`, for the reason the hero is: catalogue
           * photography is square with padding baked into the file, and a
           * portrait box has to scale it to the width — showing the padding as
           * bands. A wide box crops it away without help.
           */
          className="absolute inset-0 h-full w-full scale-150 object-cover sm:scale-100"
          loading="lazy"
        />
      ) : (
        <span className="bg-secondary absolute inset-0" />
      )}
      {/* Heavy enough that white type and translucent chips read over any
          photograph the catalogue happens to offer. */}
      <span className="bg-foreground/65 absolute inset-0" />

      {/* Centred in the screen rather than padded from the top: at this height
          the rows are the content, and hanging them under a heading would leave
          the bottom third empty. */}
      <div className="relative w-full">
        <h2 className="text-background text-center text-4xl sm:text-5xl lg:text-6xl">{title}</h2>

        <div className="mt-10 flex flex-col gap-4">
          {rows.map((row, index) => (
            <div key={index} className="group flex overflow-hidden">
              <div
                className={cn(
                  'shop-marquee flex w-max shrink-0 gap-3 group-hover:[animation-play-state:paused]',
                )}
                style={{
                  animation: `${index % 2 === 0 ? 'shop-marquee-left' : 'shop-marquee-right'} ${DURATION[index]}s linear infinite`,
                }}
              >
                {/* Twice, so the loop closes on itself. The copy is hidden from
                    screen readers — it is the same forty links again. */}
                {[0, 1].map((copy) => (
                  <div key={copy} className="flex gap-3" aria-hidden={copy === 1 || undefined}>
                    {row.map((link) => (
                      <Link
                        key={`${copy}-${link.id}`}
                        to={link.to}
                        tabIndex={copy === 1 ? -1 : undefined}
                        className="border-background/40 bg-background/10 text-background hover:bg-background/25 rounded-md border px-5 py-2.5 text-sm whitespace-nowrap backdrop-blur-[2px] transition-colors"
                      >
                        {link.label}
                      </Link>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
