#!/usr/bin/env node
// Phase 13 collections: creates a manual and a dynamic collection, verifies the
// storefront renders both, and DELETES them. Nothing survives this script.
//   node scripts/verify/phase-13-collections.mjs
// Creates two collections, verifies the storefront renders them, deletes both.
// Nothing survives this script — Ronik enters catalog data through the admin.
import { execFileSync } from 'node:child_process'
const API = 'http://localhost:4000/api/storefront'
const REPO = '/Users/ronik-makwana/Desktop/StrideX'
const psql = (sql) => execFileSync('docker',
  ['compose','exec','-T','postgres','psql','-U','postgres','-d','shoe','-t','-A','-F','\t','-c',sql],
  { encoding:'utf8', cwd:REPO }).trim()
const get = async (p) => { const r = await fetch(`${API}${p}`); return { status:r.status, json: await r.json().catch(()=>null) } }
let pass=0; const fails=[]
const ok=(n,got,want)=>{const g=JSON.stringify(got),w=JSON.stringify(want)
  if(g===w){console.log(`  PASS  ${n}`);pass++}else{console.log(`  FAIL  ${n}\n          got  ${g}\n          want ${w}`);fails.push(n)}}

// ── manual collection, five products in a deliberate order ──────────────────
const picks = psql(`SELECT id, title FROM products WHERE status='ACTIVE' ORDER BY title LIMIT 5;`)
  .split('\n').map(l => { const [id,title]=l.split('\t'); return {id,title} })

psql(`INSERT INTO collections (name, slug, description, type, status, updated_at)
      VALUES ('ZZ Test Manual','zz-test-manual','A temporary collection','MANUAL','ACTIVE',now());`)
const manualId = psql(`SELECT id FROM collections WHERE slug='zz-test-manual';`)
// Reverse alphabetical positions, so "curator's order" is provably NOT any
// natural ordering the query might fall back to.
const curated = [...picks].reverse()
curated.forEach((p,i) => psql(
  `INSERT INTO collection_products (collection_id, product_id, position) VALUES ('${manualId}','${p.id}',${i});`))

console.log('manual collection')
const idx = await get('/collections')
ok('appears in the index', idx.json.data.some(c => c.slug==='zz-test-manual'), true)
const meta = await get('/collections/zz-test-manual')
ok('meta returns name and count', [meta.json.data.name, meta.json.data.productCount], ['ZZ Test Manual', 5])
ok('meta carries no products array', 'products' in meta.json.data, false)
ok('meta hides the rules engine', 'matchType' in meta.json.data || 'rules' in meta.json.data, false)

const grid = await get('/products?collection=zz-test-manual&sort=featured&limit=10')
ok('grid returns exactly the pinned products', grid.json.meta.total, 5)
ok("featured is the curator's drag order",
   grid.json.data.map(p=>p.title), curated.map(p=>p.title))
const byName = await get('/products?collection=zz-test-manual&sort=name_asc&limit=10')
ok('other sorts still work inside a collection',
   byName.json.data.map(p=>p.title), picks.map(p=>p.title))
const cf = await get('/products/facets?collection=zz-test-manual')
const brandTotal = (cf.json.data.facets.find(f=>f.name==='Brand')?.values ?? []).reduce((s,v)=>s+v.count,0)
ok('facets are scoped to the collection', brandTotal, 5)

// ── dynamic collection, driven by the rules engine ──────────────────────────
const nike = psql(`SELECT id FROM brands WHERE name='Nike' LIMIT 1;`)
const expected = Number(psql(
  `SELECT count(*) FROM products p WHERE p.status='ACTIVE' AND p.brand_id='${nike}'
     AND EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id=p.id AND v.status='ACTIVE');`))

psql(`INSERT INTO collections (name, slug, type, status, match_type, updated_at)
      VALUES ('ZZ Test Dynamic','zz-test-dynamic','DYNAMIC','ACTIVE','ALL',now());`)
const dynId = psql(`SELECT id FROM collections WHERE slug='zz-test-dynamic';`)
psql(`INSERT INTO collection_rules (collection_id, field, operator, value)
      VALUES ('${dynId}','brand','is','"${nike}"'::jsonb);`)

console.log('\ndynamic collection')
const dmeta = await get('/collections/zz-test-dynamic')
ok('rules engine decides the count', dmeta.json.data.productCount, expected)
const dgrid = await get('/products?collection=zz-test-dynamic&limit=50')
ok('grid matches that count', dgrid.json.meta.total, expected)
ok('every product really is the rule brand',
   dgrid.json.data.every(p => p.brand?.name === 'Nike'), true)
const t0 = Date.now()
await get('/products?collection=zz-test-dynamic&limit=24')
console.log(`  (rules engine resolved in ${Date.now()-t0}ms, uncached)`)

// A dynamic collection combined with a facet must still agree.
const um = (await get('/products/facets')).json.data.facets.find(f=>f.name==='Upper Material')
const val = um.values[0]
const combo = `collection=zz-test-dynamic&attr:${um.id}=${val.id}`
const cg = await get(`/products?${combo}&limit=50`)
const cfa = await get(`/products/facets?${combo}`)
const cnt = cfa.json.data.facets.find(f=>f.name==='Upper Material').values.find(v=>v.id===val.id)?.count ?? 0
ok('collection + attribute facet agree with the grid', cnt, cg.json.meta.total)

// ── draft and archived collections are invisible ────────────────────────────
console.log('\nvisibility')
psql(`UPDATE collections SET status='DRAFT' WHERE slug='zz-test-manual';`)
ok('a DRAFT collection is a 404', (await get('/collections/zz-test-manual')).status, 404)
ok('and drops out of the index', (await get('/collections')).json.data.some(c=>c.slug==='zz-test-manual'), false)
ok('and its grid 404s too', (await get('/products?collection=zz-test-manual')).status, 404)

// ── cleanup ─────────────────────────────────────────────────────────────────
psql(`DELETE FROM collections WHERE slug IN ('zz-test-manual','zz-test-dynamic');`)
const left = psql(`SELECT count(*) FROM collections WHERE slug LIKE 'zz-test-%';`)
console.log(`\ncleanup: ${left} test collections remain`)
console.log(`${pass} passed, ${fails.length} failed`)
process.exit(fails.length ? 1 : 0)
