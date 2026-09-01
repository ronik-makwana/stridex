#!/usr/bin/env node
/*
 * Dev-only. Gives every brand a logo.
 *
 * Why this exists: the brands table draws a single grey initial when
 * `logo_url` is null, and 27 of 28 brands were null — a column of grey squares
 * that makes a populated catalogue look unconfigured. The upload path itself
 * was never the problem; it has worked since brands shipped. What was missing
 * was the files.
 *
 *   node scripts/dev/brand-logos.mjs                # only brands with no logo
 *   node scripts/dev/brand-logos.mjs --force        # replace what is there
 *   node scripts/dev/brand-logos.mjs --force nike   # just this one
 *
 * Two sources, because no single one covers a catalogue of global and Indian
 * footwear brands:
 *
 *   1. Wikimedia Commons, for the eleven that have a free-licensed logo file
 *      there. These are the real marks, and they are on Commons because a
 *      wordmark or a simple shape falls below the threshold of originality —
 *      which is what makes the *file* reusable. The mark itself is still the
 *      brand's trademark; a shop showing it next to that brand's products is
 *      the ordinary nominative use, and nothing here is a claim on it.
 *
 *   2. A generated wordmark for the other seventeen, drawn here as SVG rather
 *      than fetched. The alternatives were worse: Simple Icons covers eight of
 *      our brands and two of those are a different company with the same name,
 *      Clearbit's logo API is shut down, and Google's favicon service answers
 *      several of the Indian brands at 32px or not at all. A crisp wordmark
 *      beats a blurred favicon and cannot be the wrong company's logo.
 *
 * Like the collection script, it drives the admin API rather than the bucket,
 * so the folder, the key naming and the cleanup of a replaced object stay the
 * API's job. Any of these can be overwritten from the admin UI later, which is
 * the point: they are stand-ins that behave exactly like a real upload.
 */
import { readFileSync } from 'node:fs'

const API = process.env.API_URL ?? 'http://localhost:4000/api'

const envFile = new URL('../../apps/api/.env', import.meta.url)
const env = Object.fromEntries(
  readFileSync(envFile, 'utf8')
    .split('\n')
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const at = line.indexOf('=')
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()]
    }),
)

const EMAIL = process.env.ADMIN_EMAIL ?? env.SEED_ADMIN_EMAIL
const PASSWORD = process.env.ADMIN_PASSWORD ?? env.SEED_ADMIN_PASSWORD

/**
 * Brand slug → the file's name on Wikimedia Commons. Fetched through
 * `Special:FilePath`, which renders an SVG to a PNG of the width asked for —
 * no API key, no rate limit, and a transparent background that sits correctly
 * in the admin's logo square.
 *
 * Every one of these was looked at before it was listed. The lead image of a
 * brand's Wikipedia article is *not* a safe source: it is a photograph of the
 * headquarters for Asics, Nike, Skechers and Metro Brands, which is how a
 * picture of an office block ends up captioned as a logo.
 */
const COMMONS = {
  adidas: 'Adidas 2022 logo.svg',
  asics: 'Asics Logo.svg',
  bata: 'Bata.svg',
  converse: 'Converse logo.svg',
  fila: 'Fila logo.svg',
  'new-balance': 'New Balance logo.svg',
  nike: 'Logo NIKE.svg',
  reebok: 'Reebok 2019 logo.svg',
  skechers: 'Skechers.svg',
  'under-armour': 'Under armour logo.svg',
  vans: 'Vans (brand) logo.svg',
}

const LOGO_WIDTH = 512

/** XML text content: only these three can end a text node early. */
const escapeXml = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * A wordmark on a square, because that is the box it lands in: the table draws
 * the logo at 32px and the uploader at 64px, both square, both `object-contain`.
 * A wide strip of type would letterbox down to an unreadable line, so the name
 * wraps to fill the square instead.
 *
 * Transparent ground and near-black ink, to match the Commons files sitting
 * beside it — those are dark marks on transparency too, so the two sources
 * behave the same against whatever the admin paints behind them.
 */
function wordmark(name) {
  const words = name.toUpperCase().split(/\s+/)
  // One word to a line for the two-word names; anything longer balances.
  const lines =
    words.length <= 2 ? words : [words.slice(0, -1).join(' '), words[words.length - 1]]

  const BOX = 512
  // Small: the mark is drawn at 32px in the table, so every pixel of margin
  // inside the file costs legibility exactly where it is scarcest. The Commons
  // logos beside it run edge to edge.
  const INSET = 24
  const usable = BOX - INSET * 2
  const longest = Math.max(...lines.map((line) => line.length))

  /*
   * 0.66em per character is the average advance width of a bold grotesque plus
   * the letter-spacing added below — near enough to fit type inside a box
   * without measuring it, which is not something a script can do without a
   * font engine. The height cap is what stops a two-line name from overflowing
   * once the width cap has been met.
   */
  const size = Math.min(usable / (0.66 * longest), usable / (lines.length * 1.18), 150)
  const leading = size * 1.18
  const top = BOX / 2 - ((lines.length - 1) * leading) / 2

  const text = lines
    .map(
      (line, index) =>
        `<text x="${BOX / 2}" y="${(top + index * leading).toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-size="${size.toFixed(1)}" letter-spacing="${(size * 0.03).toFixed(2)}">${escapeXml(line)}</text>`,
    )
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BOX} ${BOX}" width="${BOX}" height="${BOX}" role="img" aria-label="${escapeXml(name)}">
<g fill="#111827" font-family="ui-sans-serif, system-ui, 'Helvetica Neue', Arial, sans-serif" font-weight="700">${text}</g>
</svg>`
}

const args = process.argv.slice(2)
const force = args.includes('--force')
const only = new Set(args.filter((arg) => !arg.startsWith('--')))

const call = async (method, path, { token, body } = {}) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

const login = await call('POST', '/admin/auth/login', {
  body: { email: EMAIL, password: PASSWORD },
})
if (login.status !== 200) {
  console.error(`cannot log in as ${EMAIL}:`, login.status, login.body)
  process.exit(1)
}
const token = login.body.data.accessToken

const list = await call('GET', '/admin/brands?limit=100', { token })
if (list.status !== 200) {
  console.error('cannot list brands:', list.status, list.body)
  process.exit(1)
}

const brands = list.body.data.filter((brand) => {
  if (only.size > 0 && !only.has(brand.slug)) return false
  return force || !brand.logoUrl
})

if (brands.length === 0) {
  console.log('every brand already has a logo — pass --force to replace them.')
  process.exit(0)
}

/** The Commons file, rendered to a PNG of the width we want. */
async function fromCommons(file) {
  const url = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=${LOGO_WIDTH}`
  const res = await fetch(url, { headers: { 'user-agent': 'StrideX-dev/1.0 (local demo catalogue)' } })
  if (!res.ok) return null
  return { bytes: Buffer.from(await res.arrayBuffer()), type: 'image/png', extension: 'png' }
}

let done = 0
for (const brand of brands) {
  const file = COMMONS[brand.slug]
  let asset = file ? await fromCommons(file) : null

  // A Commons file that has been renamed or deleted since must not take the
  // brand down with it — the wordmark is always available.
  if (file && !asset) console.error(`  !!  ${brand.slug} — Commons miss on "${file}", drawing a wordmark`)
  const source = asset ? `commons: ${file}` : 'wordmark'
  asset ??= {
    bytes: Buffer.from(wordmark(brand.name), 'utf8'),
    type: 'image/svg+xml',
    extension: 'svg',
  }

  const form = new FormData()
  form.append('file', new Blob([asset.bytes], { type: asset.type }), `${brand.slug}.${asset.extension}`)

  const upload = await fetch(`${API}/admin/uploads/brands`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  })
  const stored = await upload.json()
  if (upload.status !== 201) {
    console.error(` FAIL  ${brand.slug} — upload ${upload.status}`, stored)
    continue
  }

  /*
   * Only `logoUrl` goes up. Unlike the collection schema, `logoUrlSchema` puts
   * its transform on the empty-string branch of a union, so an absent field
   * stays undefined and the service's "leave it alone" guard holds — nothing
   * else on the brand is touched by this.
   */
  const patch = await call('PATCH', `/admin/brands/${brand.id}`, {
    token,
    body: { logoUrl: stored.data.url },
  })
  if (patch.status !== 200) {
    console.error(` FAIL  ${brand.slug} — patch ${patch.status}`, patch.body)
    continue
  }

  done++
  console.log(
    `  ok  ${brand.name.padEnd(14)} ${(stored.data.size / 1024).toFixed(0).padStart(3)}KB  ${source}`,
  )
}

console.log(`\n${done}/${brands.length} brands given a logo.`)
process.exit(done === brands.length ? 0 : 1)
