#!/usr/bin/env node
/*
 * Dev-only. Gives every collection a cover photograph.
 *
 * Why this exists: a collection carries an `image_url`, but nothing has ever
 * filled one in — there is no art department behind a demo catalogue, so the
 * storefront falls back to borrowing a product photo for the tile. That
 * fallback is a safety net, not a look: three tiles of the same white-background
 * catalogue shot read as a page that failed to load rather than as
 * merchandising. This puts a real editorial photograph on each one.
 *
 *   node scripts/dev/collection-images.mjs           # only the ones with no image
 *   node scripts/dev/collection-images.mjs --force   # replace what is there
 *   node scripts/dev/collection-images.mjs sale new-arrivals   # just these slugs
 *
 * It goes through the admin API rather than writing the bucket and the row
 * itself, so it takes exactly the path the admin form takes: POST the file to
 * /admin/uploads/collections, then PATCH the collection with the URL that comes
 * back. That means the bucket policy, the key naming and the cleanup of the
 * replaced object are all the API's job, and this script cannot invent a state
 * the admin UI could not produce.
 *
 * The photographs are Unsplash, under the Unsplash licence, chosen per
 * collection and credited below. They are stand-in art for a demo shop; a real
 * one replaces them with its own shoot from the admin UI, which is why nothing
 * here writes a source URL into the database — once uploaded, the image is just
 * an object in our bucket like any other.
 */
import { readFileSync } from 'node:fs'

const API = process.env.API_URL ?? 'http://localhost:4000/api'

/**
 * The admin credentials the seed creates. Read from the API's own .env so this
 * keeps working when somebody changes them there.
 */
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
 * One photograph per collection, keyed by slug.
 *
 * `photo` is the Unsplash photo id — the tail of `unsplash.com/photos/<id>` —
 * and `by` is the photographer, kept here because the licence asks for credit
 * and a file in a bucket cannot carry it.
 *
 * A slug missing from this map is left alone rather than given a random shoe:
 * a tile with no image falls back to a product photo, which is a better wrong
 * answer than a picture of the wrong thing.
 */
const COVERS = {
  'back-to-campus': { photo: '1516478177764-9fe5bd7e9717', by: 'Mohammad Metri' },
  'canvas-classics': { photo: '1607522370275-f14206abe5d3', by: 'Domino Studio' },
  'ethnic-footwear': { photo: '1562273138-f46be4ebdf33', by: 'Tamara Bellis' },
  'festive-wedding': { photo: '1543163521-1bf539c55dd2', by: 'Jeff Tumale' },
  'gifting-under-2-000': { photo: '1549465220-1a8b9238cd48', by: 'Kira auf der Heide' },
  homegrown: { photo: '1553051021-9f94520a6cad', by: 'Clem Onojeghuo' },
  'kids-shop': { photo: '1519457431-44ccd64a579b', by: 'Vitolda Klein' },
  'limited-edition': { photo: '1520256862855-398228c41684', by: 'Malvestida' },
  'monsoon-ready': { photo: '1503919545889-aef636e10ad4', by: 'Daiga Ellaby' },
  'new-arrivals': { photo: '1595950653106-6c9ebd614d3a', by: 'Sandro Schuh' },
  'office-formals': { photo: '1533867617858-e7b97e060509', by: 'Andres Jasso' },
  'performance-knits-mesh': { photo: '1606107557195-0e29a4b5b4aa', by: 'Nike' },
  'premium-leather': { photo: '1449505278894-297fdb3edbc1', by: 'Nathan Dumlao' },
  sale: { photo: '1525966222134-fcfa99b8ae77', by: 'Erik Mclean' },
  'slip-on-shop': { photo: '1603487742131-4160ec999306', by: 'Sincerely Media' },
  'stridex-picks': { photo: '1560769629-975ec94e6a86', by: 'Grailify' },
  'suede-season': { photo: '1560343090-f0409e92791a', by: 'Irene Kredenets' },
  'the-leather-edit': { photo: '1520639888713-7851133b1ed0', by: 'Ryan Plomp' },
  'the-premium-shelf': { photo: '1610398752800-146f269dfcc8', by: 'Tamara Bellis' },
  'trail-outdoor': { photo: '1542841791-1925b02a2bbb', by: 'Josh Nuttall' },
  'under-1-500': { photo: '1608231387042-66d1773070a5', by: 'Cristian Escobar' },
}

/**
 * 3:2, because that is the aspect the home page tile and the collections grid
 * both cut to — cropping here rather than in CSS means the browser downloads
 * the pixels it will actually show. `crop=entropy` keeps the shoe in frame
 * instead of trusting the centre of the original.
 */
const WIDTH = 1600
const RENDITION = `w=${WIDTH}&h=${Math.round((WIDTH * 2) / 3)}&fit=crop&crop=entropy&q=75&fm=jpg`

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

const list = await call('GET', '/admin/collections?limit=100', { token })
if (list.status !== 200) {
  console.error('cannot list collections:', list.status, list.body)
  process.exit(1)
}

const collections = list.body.data.filter((collection) => {
  if (only.size > 0 && !only.has(collection.slug)) return false
  if (!COVERS[collection.slug]) return false
  return force || !collection.imageUrl
})

const unmapped = list.body.data
  .filter((collection) => !COVERS[collection.slug])
  .map((collection) => collection.slug)
if (unmapped.length > 0) console.log(`no photograph chosen for: ${unmapped.join(', ')}\n`)

if (collections.length === 0) {
  console.log('every collection already has an image — pass --force to replace them.')
  process.exit(0)
}

let uploaded = 0
for (const collection of collections) {
  const cover = COVERS[collection.slug]
  const source = `https://images.unsplash.com/photo-${cover.photo}?${RENDITION}`

  const download = await fetch(source)
  if (!download.ok) {
    console.error(` FAIL  ${collection.slug} — unsplash returned ${download.status}`)
    continue
  }
  const bytes = Buffer.from(await download.arrayBuffer())

  // Multipart, the same field name the admin form posts under.
  const form = new FormData()
  form.append('file', new Blob([bytes], { type: 'image/jpeg' }), `${collection.slug}.jpg`)

  const upload = await fetch(`${API}/admin/uploads/collections`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  })
  const stored = await upload.json()
  if (upload.status !== 201) {
    console.error(` FAIL  ${collection.slug} — upload ${upload.status}`, stored)
    continue
  }

  /*
   * The description goes back with the image on purpose. `updateCollection`
   * treats an absent nullable field as "clear it" once zod has defaulted it to
   * null, so a PATCH carrying only `imageUrl` would quietly wipe the copy
   * underneath the tile. Sending what is already there makes this a no-op
   * either way.
   */
  const patch = await call('PATCH', `/admin/collections/${collection.id}`, {
    token,
    body: { imageUrl: stored.data.url, description: collection.description ?? null },
  })
  if (patch.status !== 200) {
    console.error(` FAIL  ${collection.slug} — patch ${patch.status}`, patch.body)
    continue
  }

  uploaded++
  console.log(
    `  ok  ${collection.name.padEnd(26)} ${(stored.data.size / 1024).toFixed(0).padStart(4)}KB  ${stored.data.key}  © ${cover.by}`,
  )
}

console.log(`\n${uploaded}/${collections.length} collections photographed.`)
process.exit(uploaded === collections.length ? 0 : 1)
