import * as React from 'react'

const TAG_ID = 'ld-json'

/**
 * Publishes one JSON-LD block into the head for the current route.
 *
 * This is what puts a price, a stock state and a rating into a Google result
 * rather than a bare blue link. Googlebot executes JavaScript, so an injected
 * script is read — but it is read on a second pass, later than server-rendered
 * markup would be, and most social crawlers do not run JS at all. Prerendering
 * is what closes that gap; this is what makes it worth prerendering.
 *
 * A single tag with a fixed id, replaced on navigation rather than appended:
 * two Product blocks on one page is ambiguous markup, and a SPA that appends
 * would accumulate one per page visited.
 */
export function useJsonLd(data: object | null) {
  React.useEffect(() => {
    if (!data) return

    let tag = document.getElementById(TAG_ID) as HTMLScriptElement | null
    if (!tag) {
      tag = document.createElement('script')
      tag.id = TAG_ID
      tag.type = 'application/ld+json'
      document.head.appendChild(tag)
    }
    tag.textContent = JSON.stringify(data)

    // Removed on unmount, not left behind: a product's offer block sitting in
    // the head of the cart page describes something that is not on the page.
    return () => {
      document.getElementById(TAG_ID)?.remove()
    }
  }, [data])
}

/** schema.org wants a URL, not a word, for availability. */
const AVAILABILITY = {
  IN_STOCK: 'https://schema.org/InStock',
  LOW_STOCK: 'https://schema.org/LimitedAvailability',
  SOLD_OUT: 'https://schema.org/OutOfStock',
} as const

type ProductLdInput = {
  title: string
  slug: string
  description: string | null
  brand: { name: string } | null
  images: { url: string }[]
  variants: { sku: string; price: string; stock: keyof typeof AVAILABILITY }[]
  currency: string
  rating: { average: number; total: number } | null
}

/**
 * `Product` with an `AggregateOffer`, which is the shape for something sold in
 * several variants at one or more prices — a single `Offer` would have to pick
 * one of nine sizes and call it the price.
 *
 * `sku` is the product's, not a variant's, because the entity being described
 * is the product page. Per-variant offers are possible and are deliberately not
 * done here: nine near-identical offers is a lot of markup for a distinction no
 * search result surfaces.
 */
export function productJsonLd(product: ProductLdInput, siteUrl: string): object | null {
  const sellable = product.variants.filter((variant) => variant.stock !== 'SOLD_OUT')
  const prices = product.variants.map((variant) => Number(variant.price)).filter(Number.isFinite)
  if (prices.length === 0) return null

  const url = `${siteUrl}/products/${product.slug}`

  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.title,
    url,
    ...(product.description ? { description: product.description } : {}),
    ...(product.brand ? { brand: { '@type': 'Brand', name: product.brand.name } } : {}),
    ...(product.images.length > 0 ? { image: product.images.map((image) => image.url) } : {}),
    ...(product.variants[0] ? { sku: product.variants[0].sku } : {}),
    offers: {
      '@type': 'AggregateOffer',
      priceCurrency: product.currency,
      lowPrice: Math.min(...prices).toFixed(2),
      highPrice: Math.max(...prices).toFixed(2),
      offerCount: product.variants.length,
      availability: AVAILABILITY[sellable.length > 0 ? 'IN_STOCK' : 'SOLD_OUT'],
      url,
    },
    /**
     * Omitted entirely when nobody has reviewed it. Google requires an
     * aggregate rating to correspond to review content visible on the page,
     * and `"ratingValue": 0` over zero reviews is both meaningless and a
     * structured-data penalty waiting to happen.
     */
    ...(product.rating && product.rating.total > 0
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: product.rating.average,
            reviewCount: product.rating.total,
          },
        }
      : {}),
  }
}
