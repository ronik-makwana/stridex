#!/usr/bin/env node
// Phase 12 acceptance checks — product detail + related.
//   node scripts/verify/phase-12-api.mjs
// Read-only. Touches no rows.

const API = process.env.API ?? 'http://localhost:4000/api/storefront'
const SLUG = process.env.SLUG ?? 'puma-carina-street-casual'

let passed = 0
const failures = []
const ok = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { console.log(`  PASS  ${name}`); passed++ }
  else { console.log(`  FAIL  ${name}\n          got  ${g}\n          want ${w}`); failures.push(name) }
}
const group = (n) => console.log(`\n${n}`)
const call = async (path) => {
  const res = await fetch(`${API}${path}`)
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch {}
  return { status: res.status, json, text }
}

group('1 — the detail payload')
const detail = await call(`/products/${SLUG}`)
ok('returns 200', detail.status, 200)
const p = detail.json?.data
ok('has a title', typeof p?.title, 'string')
ok('breadcrumbs are root-first and end at the category', p?.breadcrumbs?.at(-1)?.id, p?.category?.id)
ok('media are sorted by sortOrder', p?.media?.map((m) => m.sortOrder), [...(p?.media ?? [])].map((m) => m.sortOrder).sort((a, b) => a - b))
ok('attributes resolve to display strings', p?.attributes?.every((a) => typeof a.value === 'string' && a.value.length > 0), true)
ok('options come in position order', p?.options?.map((o) => o.position), [...(p?.options ?? [])].map((o) => o.position).sort((a, b) => a - b))
ok('every variant carries one value per axis',
  p?.variants?.every((v) => v.optionValueIds.length === p.options.length), true)

group('2 — stock is a bucket, never a number')
const BUCKETS = ['IN_STOCK', 'LOW_STOCK', 'SOLD_OUT']
ok('product stock is a known bucket', BUCKETS.includes(p?.stock), true)
ok('every variant stock is a known bucket', p?.variants?.every((v) => BUCKETS.includes(v.stock)), true)
ok('maxQuantity never exceeds the per-item cap of 10', p?.variants?.every((v) => v.maxQuantity <= 10), true)
ok('a sold-out variant offers a maxQuantity of 0',
  p?.variants?.filter((v) => v.stock === 'SOLD_OUT').every((v) => v.maxQuantity === 0), true)

group('3 — nothing internal leaks')
const FORBIDDEN = ['reservedQuantity', 'reserved_quantity', 'lowStockThreshold', 'cost', 'passwordHash', 'DRAFT', 'ARCHIVED']
for (const key of FORBIDDEN) ok(`"${key}" is absent from the payload`, detail.text.includes(key), false)
ok('variants expose exactly the intended keys',
  Object.keys(p?.variants?.[0] ?? {}).sort(),
  ['compareAtPrice', 'discountPercent', 'id', 'maxQuantity', 'mediaId', 'optionValueIds', 'price', 'sku', 'stock'])

group('4 — money is a fixed-point string, never a float')
ok('price is a string', typeof p?.variants?.[0]?.price, 'string')
ok('prices carry two decimals', p?.variants?.every((v) => /^\d+\.\d{2}$/.test(v.price)), true)
ok('discountPercent is a floored integer or null',
  p?.variants?.every((v) => v.discountPercent === null || Number.isInteger(v.discountPercent)), true)
ok('a markdown is only claimed when compare-at exceeds price',
  p?.variants?.every((v) => v.discountPercent === null || Number(v.compareAtPrice) > Number(v.price)), true)

group('5 — option values are limited to what this product is made in')
const used = new Set(p?.variants?.flatMap((v) => v.optionValueIds))
ok('no option offers a value with no variant behind it',
  p?.options?.every((o) => o.values.every((v) => used.has(v.id))), true)
ok('option value ids are ordered by the axis order',
  p?.variants?.every((v) => {
    const pos = v.optionValueIds.map((id) => p.options.findIndex((o) => o.values.some((val) => val.id === id)))
    return pos.every((n, i) => i === 0 || pos[i - 1] <= n)
  }), true)

group('6 — 404 rules')
ok('an unknown slug is 404', (await call('/products/definitely-not-a-real-product')).status, 404)
ok('a malformed slug is 400, not a database round trip', (await call('/products/Not_A_Slug')).status, 400)

group('7 — related')
const related = await call(`/products/${SLUG}/related`)
ok('returns 200', related.status, 200)
const cards = related.json?.data ?? []
ok('returns at most 8', cards.length <= 8, true)
ok('excludes the product itself', cards.some((c) => c.slug === SLUG), false)
ok('excludes sold-out products', cards.some((c) => c.stock === 'SOLD_OUT'), false)
ok('contains no duplicates', new Set(cards.map((c) => c.id)).size, cards.length)
ok('cards expose exactly the intended keys',
  Object.keys(cards[0] ?? {}).sort(),
  ['brand', 'compareAtPrice', 'discountPercent', 'id', 'image', 'price', 'slug', 'stock', 'title'])
ok('related on an unknown slug is 404', (await call('/products/nope-not-real/related')).status, 404)

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) console.log(failures.map((f) => `  - ${f}`).join('\n'))
process.exit(failures.length ? 1 : 0)
