import { usePageMeta } from '@/lib/use-page-meta'
import { Link } from 'react-router'
import { useHome } from '@/features/home/queries'
import { CategoryMarquee } from '@/components/category-marquee'
import { ProductRow } from '@/components/product-row'
import { Testimonials } from '@/components/testimonials'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * The front page, and the last thing built — deliberately. It is merchandising,
 * and every part of it is something that already existed: the grid's product
 * card, the collection tile from `/collections`, the category tree. Nothing new
 * was invented for it, which is how §18 says to know it is finished.
 *
 * A full-bleed hero over a rhythm of labelled bands: new arrivals, the three
 * departments, three curated collections, then what is marked down. Each band
 * has a way through to the page that owns it, so the home page is a route in
 * rather than a destination.
 */
export default function HomePage() {
  const { data, isPending } = useHome()

  usePageMeta({
    // The one page that is the brand rather than a section of it, so it keeps
    // the full line instead of taking the ` · StrideX` suffix.
    title: 'StrideX',
    description: 'Shoes for the long way round. Free delivery over ₹1999.',
  })

  return (
    <div>
      <Hero image={data?.hero.image ?? null} loading={isPending} />

      <div className="mx-auto max-w-[1400px] px-4 pb-20 sm:px-6 lg:px-10">
        {isPending ? (
          <div className="mt-16 grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-4">
            {[0, 1, 2, 3].map((card) => (
              <Skeleton key={card} className="aspect-[3/2] w-full" />
            ))}
          </div>
        ) : (
          <>
            <ProductRow
              title="New arrivals"
              products={data?.newArrivals ?? []}
              to="/collections/new-arrivals"
            />

            {/* The departments. Three tiles doing the job a nav does, for the
                half of visitors who never read a nav. */}
            <section className="mt-16" id="departments">
              <div className="grid gap-5 sm:grid-cols-3">
                {(data?.categories ?? []).map((category) => (
                  <Link
                    key={category.id}
                    to={`/categories/${category.slug}`}
                    className="group relative block aspect-[4/5] overflow-hidden sm:aspect-[3/4]"
                  >
                    {category.image ? (
                      <img
                        src={category.image}
                        alt=""
                        className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                        loading="lazy"
                      />
                    ) : (
                      <span className="bg-secondary absolute inset-0" />
                    )}
                    {/* A wash rather than a full overlay: the photograph is the
                        point, the word only has to be readable over it. */}
                    <span className="from-foreground/60 absolute inset-x-0 bottom-0 bg-gradient-to-t to-transparent p-5 pt-16">
                      <span className="text-background text-lg">{category.name}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          </>
        )}
      </div>

      {/* Full-bleed, so it sits outside the page container rather than fighting
          it with negative margins. */}
      {!isPending && (
        <CategoryMarquee
          title="Top categories"
          image={data?.topCategories.image ?? null}
          links={data?.topCategories.links ?? []}
        />
      )}

      <div className="mx-auto max-w-[1400px] px-4 pb-20 sm:px-6 lg:px-10">
        {!isPending && (
          <>
            {/* Curated, not rule-driven: somebody chose what is in these. */}
            {(data?.collections.length ?? 0) > 0 && (
              <section className="mt-16">
                <div className="flex items-baseline justify-between gap-4">
                  <h2 className="text-xs tracking-[0.14em] uppercase">Collections</h2>
                  <Link to="/collections" className="text-sm underline underline-offset-4">
                    All collections
                  </Link>
                </div>

                <div className="mt-6 grid gap-8 sm:grid-cols-3">
                  {data?.collections.map((collection) => (
                    <Link key={collection.id} to={`/collections/${collection.slug}`} className="group block">
                      <div className="bg-secondary relative aspect-[3/2] w-full overflow-hidden">
                        {collection.image && (
                          <img
                            src={collection.image}
                            alt=""
                            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                            loading="lazy"
                          />
                        )}
                      </div>
                      <h3 className="mt-3 text-base">{collection.name}</h3>
                      {collection.description && (
                        <p className="text-muted-foreground mt-1 line-clamp-2 text-sm">
                          {collection.description}
                        </p>
                      )}
                    </Link>
                  ))}
                </div>
              </section>
            )}

            <ProductRow title="On sale" products={data?.onSale ?? []} to="/collections/sale" />

            {/* Last, and made of real reviews. It disappears entirely until
                there are some. */}
            <Testimonials quotes={data?.testimonials ?? []} />
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Full-bleed, and the image is the newest photographed product rather than an
 * asset somebody has to remember to upload. It changes as the catalogue does —
 * the right behaviour for a shop with no art department.
 */
function Hero({
  image,
  loading,
}: {
  image: { url: string; altText: string | null } | null
  loading: boolean
}) {
  return (
    /*
     * One screen exactly, and the two subtractions are the reason it is a
     * calc rather than `h-svh`: the header is sticky *in flow* — its `h-16`
     * row plus a 1px border — so a hero of a full viewport would push its own
     * headline and buttons 65px below the fold, which is the one thing a hero
     * must not do.
     *
     * `svh` rather than `vh` for the same reason on a phone: `100vh` is
     * measured with the browser chrome retracted, and the call to action would
     * spend the first scroll hidden behind the address bar.
     */
    <section className="relative flex h-[calc(100svh-4rem-1px)] items-center overflow-hidden">
      {loading ? (
        <Skeleton className="absolute inset-0" />
      ) : image ? (
        <img
          src={image.url}
          alt=""
          /*
           * The zoom is for the source, not for taste. Catalogue photography is
           * square with white padding baked into the file: in a wide box
           * `object-cover` crops that away, but in a portrait one it has to
           * scale to the width, so the whole square — padding included — shows
           * as bands above and below. Scaling past cover crops it back off.
           *
           * It applies below `sm` only, because a desktop hero never sees the
           * padding and would just be losing resolution. The real fix is a
           * hero image chosen for the job; this is what makes the fallback
           * presentable until there is one.
           */
          className="absolute inset-0 h-full w-full scale-150 object-cover sm:scale-100"
          // The one image on the page worth loading before anything else.
          fetchPriority="high"
        />
      ) : (
        <span className="bg-secondary absolute inset-0" />
      )}

      {/*
        Dark from the left now that the type sits there, and clear by the middle
        so the right half of the photograph is left alone. A wash rather than a
        scrim: the picture is the hero, the gradient only has to make five words
        legible over whatever crop the viewport gives us.
      */}
      <span className="from-foreground/75 via-foreground/35 absolute inset-0 bg-gradient-to-r to-transparent" />

      <div className="relative mx-auto w-full max-w-[1400px] px-4 sm:px-6 lg:px-10">
        {/* Half the width at most: the text belongs on the left, and a headline
            that ran under the subject would be fighting it. */}
        <div className="max-w-xl lg:max-w-2xl">
          <p className="text-background/80 text-xs tracking-[0.18em] uppercase">New season</p>
          <h1 className="text-background mt-4 text-4xl leading-[1.05] sm:text-5xl lg:text-6xl">
            Built for the long way round.
          </h1>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg" variant="accent">
              <Link to="/collections/new-arrivals">Shop new arrivals</Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="bg-background/10 text-background border-background/40 hover:bg-background/20"
            >
              <Link to="/collections">Browse collections</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
