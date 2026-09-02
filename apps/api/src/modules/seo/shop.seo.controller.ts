import type { RequestHandler } from 'express'
import { prisma } from '../../lib/prisma.js'
import { env } from '../../config/env.js'

/**
 * `sitemap.xml`, generated rather than stored.
 *
 * A static file in `public/` would be a snapshot: this catalogue is 210
 * products that get added, archived and re-slugged, and a sitemap listing URLs
 * that 404 is worse for crawling than no sitemap at all.
 *
 * It is served from the API and must be **exposed at the site root** —
 * `https://shop.example.com/sitemap.xml` — because a sitemap may only list URLs
 * at or below its own path. In production that is one rewrite rule at the CDN
 * or nginx; the generator itself does not care where it is mounted.
 */

const escapeXml = (value: string) =>
  value.replace(
    /[<>&'"]/g,
    (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[char]!,
  )

type Entry = { path: string; lastmod?: Date | null; changefreq: string; priority: string }

export const sitemap: RequestHandler = async (_req, res) => {
  const site = env.STOREFRONT_URL.replace(/\/$/, '')

  const [products, categories, collections] = await Promise.all([
    // ACTIVE only. A draft in a sitemap is an invitation to crawl a 404.
    prisma.product.findMany({
      where: { status: 'ACTIVE' },
      select: { slug: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.category.findMany({ where: { status: 'ACTIVE' }, select: { slug: true, updatedAt: true } }),
    prisma.collection.findMany({ where: { status: 'ACTIVE' }, select: { slug: true, updatedAt: true } }),
  ])

  const entries: Entry[] = [
    { path: '/', changefreq: 'daily', priority: '1.0' },
    { path: '/collections', changefreq: 'weekly', priority: '0.6' },
    ...categories.map((row) => ({
      path: `/categories/${row.slug}`,
      lastmod: row.updatedAt,
      changefreq: 'weekly',
      priority: '0.8',
    })),
    ...collections.map((row) => ({
      path: `/collections/${row.slug}`,
      lastmod: row.updatedAt,
      changefreq: 'weekly',
      priority: '0.7',
    })),
    ...products.map((row) => ({
      path: `/products/${row.slug}`,
      lastmod: row.updatedAt,
      changefreq: 'weekly',
      priority: '0.9',
    })),
  ]

  /**
   * Cart, checkout, account and the auth screens are deliberately absent: they
   * are behind a session or personal to one customer, so a crawler that reached
   * them would index either a redirect or somebody's order history.
   */
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
  .map(
    (entry) => `  <url>
    <loc>${escapeXml(site + entry.path)}</loc>${
      entry.lastmod ? `\n    <lastmod>${entry.lastmod.toISOString().slice(0, 10)}</lastmod>` : ''
    }
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority}</priority>
  </url>`,
  )
  .join('\n')}
</urlset>
`

  res.type('application/xml')
  // An hour: long enough that a crawl does not re-run these three queries on
  // every hit, short enough that a new product is listed the same day.
  res.set('Cache-Control', 'public, max-age=3600')
  res.send(body)
}
